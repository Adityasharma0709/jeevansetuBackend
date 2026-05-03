import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const LOCATION_CODE_PREFIX = 'AWC';
const LOCATION_CODE_MIN_DIGITS = 1;
const LOCATION_CODE_MAX_RETRIES = 5;

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  private async assertProjectExists(projectId: number) {
    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }

    if ((existing?.status ?? '').toString().toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException(`Project is deactivated: ${projectId}`);
    }
  }

  private toAwcResponse(awc: any) {
    if (!awc) return null;
    return {
      ...awc,
      stateName: awc.state?.name,
      districtName: awc.district?.name,
      block: awc.block?.name,
      village: awc.village?.name,
    };
  }

  private async resolveBlockAndVillageIds(
    tx: Prisma.TransactionClient,
    districtId?: number,
    blockName?: string,
    villageName?: string,
  ) {
    let blockId: number | undefined = undefined;
    let villageId: number | undefined = undefined;

    if (blockName && districtId) {
      const name = blockName.trim().toUpperCase();
      let block = await tx.block.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, districtId },
      });
      if (!block) {
        block = await tx.block.create({ data: { name, districtId } });
      }
      blockId = block.id;
    }

    if (villageName && blockId) {
      const name = villageName.trim().toUpperCase();
      let village = await tx.village.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, blockId },
      });
      if (!village) {
        village = await tx.village.create({ data: { name, blockId } });
      }
      villageId = village.id;
    }

    return { blockId, villageId };
  }


  private async generateNextLocationCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = LOCATION_CODE_PREFIX;
    const prefixPattern = `^${prefix}`;
    const numericPattern = `^${prefix}[0-9]+$`;

    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(
        CAST(
          regexp_replace(UPPER("locationCode"), ${prefixPattern}, '')
          AS INTEGER
        )
      ) AS max
      FROM "Awc"
      WHERE UPPER("locationCode") ~ ${numericPattern}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const numeric = String(nextNumber).padStart(LOCATION_CODE_MIN_DIGITS, '0');
    return `${prefix}${numeric}`;
  }

  async create(dto: CreateLocationDto) {
    await this.assertProjectExists(dto.projectId);

    const providedCode = dto.locationCode?.trim();
    const normalizedCode = providedCode ? providedCode.toUpperCase() : undefined;

    return this.prisma.$transaction(async (tx) => {
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        dto.districtId,
        dto.block,
        dto.village,
      );

      const { block, village, ...restDto } = dto;
      const awcData = { ...restDto, blockId, villageId };

      if (normalizedCode) {
        const existing = await tx.awc.findFirst({
          where: { locationCode: normalizedCode },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException('AWC code already exists');
        }

        return this.toAwcResponse(
          await tx.awc.create({
            data: {
              ...awcData,
              locationCode: normalizedCode,
            },
            include: { 
              project: { select: { id: true, name: true } },
              state: { select: { name: true } },
              district: { select: { name: true } },
              block: { select: { name: true } },
              village: { select: { name: true } }
            },
          }),
        );
      }

      for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
        try {
          const locationCode = await this.generateNextLocationCode(tx);
          return this.toAwcResponse(
            await tx.awc.create({
              data: {
                ...awcData,
                locationCode,
              },
              include: { 
                project: { select: { id: true, name: true } },
                state: { select: { name: true } },
                district: { select: { name: true } },
                block: { select: { name: true } },
                village: { select: { name: true } }
              },
            }),
          );
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
              const target = error.meta?.target;
              const isLocationCodeConflict = Array.isArray(target)
                ? target.includes('locationCode')
                : typeof target === 'string'
                  ? target.includes('locationCode')
                  : false;

              if (isLocationCodeConflict) {
                continue;
              }
            }
          }
          this.handleAwcPrismaError(error);
        }
      }

      throw new ConflictException('Could not generate a unique AWC code');
    });
  }

  async findAll(projectId?: number) {
    const rows = await this.prisma.awc.findMany({
      where: projectId ? { projectId } : {},
      include: { 
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toAwcResponse(r));
  }

  async findOne(id: number) {
    const row = await this.prisma.awc.findUnique({
      where: { id },
      include: { 
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } }
      },
    });
    return this.toAwcResponse(row);
  }

  async update(id: number, dto: UpdateLocationDto) {
    if (dto.projectId) {
      await this.assertProjectExists(dto.projectId);
    }

    const awc = await this.prisma.awc.findUnique({
      where: { id },
      select: { id: true, status: true, districtId: true },
    });
    if (!awc) throw new NotFoundException('AWC not found');

    const normalizedCode = dto.locationCode?.trim().toUpperCase();
    if (normalizedCode) {
      const existing = await this.prisma.awc.findFirst({
        where: {
          locationCode: normalizedCode,
          NOT: { id },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('AWC code already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const districtId = dto.districtId !== undefined ? dto.districtId : awc.districtId;
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        districtId || undefined,
        dto.block,
        dto.village,
      );

      const { block, village, ...restDto } = dto;
      
      const updateData: any = {
        ...restDto,
        locationCode: normalizedCode ? normalizedCode : undefined,
      };

      if (dto.block !== undefined) updateData.blockId = blockId;
      if (dto.village !== undefined) updateData.villageId = villageId;

      return this.toAwcResponse(
        await tx.awc.update({
          where: { id },
          data: updateData,
          include: { 
            project: { select: { id: true, name: true } },
            state: { select: { name: true } },
            district: { select: { name: true } },
            block: { select: { name: true } },
            village: { select: { name: true } }
          },
        }),
      );
    });
  }

  async updateStatus(id: number, status: string) {
    return this.toAwcResponse(
      await this.prisma.awc.update({
        where: { id },
        data: { status },
        include: { project: { select: { id: true, name: true } } },
      }),
    );
  }

  async disable(id: number) {
    return this.toAwcResponse(
      await this.prisma.awc.update({
        where: { id },
        data: { status: 'INACTIVE' },
        include: { project: { select: { id: true, name: true } } },
      }),
    );
  }

  async assignStatesToProject(projectId: number, stateIds: number[]) {
    await this.assertProjectExists(projectId);

    return this.prisma.$transaction(async (tx) => {
      // Clear existing if any (optional, or just add new ones)
      // For now, let's just add ones that don't exist
      const existing = await tx.projectState.findMany({
        where: { projectId },
        select: { stateId: true },
      });
      const existingIds = new Set(existing.map((e) => e.stateId));
      
      const toAdd = stateIds.filter(id => !existingIds.has(id));
      
      if (toAdd.length === 0) return { message: 'All selected states already assigned' };

      const created = await tx.projectState.createMany({
        data: toAdd.map(stateId => ({ projectId, stateId })),
      });

      return {
        count: created.count,
        message: `Successfully mapped ${created.count} states to project`,
      };
    });
  }

  async assignAllStatesToProject(projectId: number) {
    await this.assertProjectExists(projectId);

    const states = await this.prisma.state.findMany({
      select: { id: true },
    });

    return this.assignStatesToProject(projectId, states.map(s => s.id));
  }

  async getProjectStates(projectId: number) {
    const mappings = await this.prisma.projectState.findMany({
      where: { projectId },
      include: { state: true },
      orderBy: { state: { name: 'asc' } },
    });
    return mappings.map(m => m.state);
  }

  async getStates() {
    return this.prisma.state.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getDistricts(stateId: number) {
    return this.prisma.district.findMany({
      where: { stateId },
      orderBy: { name: 'asc' },
    });
  }

  
  async getBlocks(districtId: number) {
    return this.prisma.block.findMany({
      where: { districtId },
      orderBy: { name: 'asc' },
    });
  }

  async getVillages(blockId: number) {
    return this.prisma.village.findMany({
      where: { blockId },
      orderBy: { name: 'asc' },
    });
  }

  async getVillagesByBlockName(districtId: number, blockName: string) {
    const block = await this.prisma.block.findFirst({
      where: { districtId, name: { equals: blockName.trim(), mode: 'insensitive' } }
    });
    if (!block) return [];
    return this.prisma.village.findMany({
      where: { blockId: block.id },
      orderBy: { name: 'asc' }
    });
  }

  private handleAwcPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('AWC not found');
      }

      if (error.code === 'P2002') {
        throw new ConflictException('AWC code already exists');
      }
    }

    throw error;
  }
}
