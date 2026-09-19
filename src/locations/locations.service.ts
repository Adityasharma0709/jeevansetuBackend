import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { LocationQueryDto } from './dto/location-query.dto';
import { transformAwc, transformSchool, transformHealthCenter } from './transformers/location.transformer';

const LOCATION_CODE_PREFIX = 'AWC';
const LOCATION_CODE_MIN_DIGITS = 1;
const LOCATION_CODE_MAX_RETRIES = 5;

@Injectable()
export class LocationsService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSequencesExist();
  }

  private async ensureSequencesExist() {
    try {
      const items = [
        { seqName: 'awc_location_code_seq', tableName: 'Awc', prefix: LOCATION_CODE_PREFIX },
        { seqName: 'school_location_code_seq', tableName: 'School', prefix: 'SCH' },
        { seqName: 'health_center_location_code_seq', tableName: 'HealthCenter', prefix: 'HC' },
      ];

      for (const item of items) {
        await this.prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = '${item.seqName}') THEN
              CREATE SEQUENCE ${item.seqName};
              PERFORM setval(
                '${item.seqName}',
                COALESCE((
                  SELECT MAX(
                    CAST(regexp_replace(UPPER("locationCode"), '^${item.prefix}', '') AS INTEGER)
                  ) FROM "${item.tableName}"
                  WHERE UPPER("locationCode") ~ '^${item.prefix}[0-9]+$'
                ), 0) + 1,
                false
              );
            END IF;
          END $$;
        `);
      }
    } catch (error) {
      console.warn('Failed to ensure PostgreSQL location sequences exist:', error);
    }
  }

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

  private formatLocationResponse(entity: any) {
    if (!entity) return null;
    const blockName = entity.block && typeof entity.block === 'object'
      ? entity.block.name
      : (typeof entity.block === 'string' ? entity.block : null);

    const villageName = entity.village && typeof entity.village === 'object'
      ? entity.village.name
      : (typeof entity.village === 'string' ? entity.village : null);

    const stateName = entity.state && typeof entity.state === 'object'
      ? entity.state.name
      : (typeof entity.state === 'string' ? entity.state : null);

    const districtName = entity.district && typeof entity.district === 'object'
      ? entity.district.name
      : (typeof entity.district === 'string' ? entity.district : null);

    return {
      ...entity,
      stateName: stateName ?? null,
      districtName: districtName ?? null,
      blockName: blockName ?? null,
      villageName: villageName ?? null,
    };
  }

  private toAwcResponse(awc: any) {
    return transformAwc(awc);
  }

  private async resolveBlockAndVillageIds(
    tx: Prisma.TransactionClient,
    districtId?: number,
    blockInput?: any,
    villageInput?: any,
    explicitBlockId?: number,
    explicitVillageId?: number,
  ) {
    let blockId: number | undefined = explicitBlockId;
    let villageId: number | undefined = explicitVillageId;

    if (!blockId && blockInput !== undefined && blockInput !== null) {
      if (typeof blockInput === 'number' && !isNaN(blockInput)) {
        blockId = blockInput;
      } else if (typeof blockInput === 'object' && blockInput?.id) {
        blockId = Number(blockInput.id);
      } else if (typeof blockInput === 'string' || typeof blockInput === 'number') {
        const strVal = String(blockInput).trim();
        if (/^\d+$/.test(strVal)) {
          blockId = parseInt(strVal, 10);
        } else if (strVal && districtId) {
          const upperName = strVal.toUpperCase();
          let block = await tx.block.findFirst({
            where: { name: { equals: upperName, mode: 'insensitive' }, districtId },
          });
          if (!block) {
            block = await tx.block.create({ data: { name: upperName, districtId } });
          }
          blockId = block.id;
        }
      }
    }

    if (!villageId && villageInput !== undefined && villageInput !== null) {
      if (typeof villageInput === 'number' && !isNaN(villageInput)) {
        villageId = villageInput;
      } else if (typeof villageInput === 'object' && villageInput?.id) {
        villageId = Number(villageInput.id);
      } else if (typeof villageInput === 'string' || typeof villageInput === 'number') {
        const strVal = String(villageInput).trim();
        if (/^\d+$/.test(strVal)) {
          villageId = parseInt(strVal, 10);
        } else if (strVal && blockId) {
          const upperName = strVal.toUpperCase();
          let village = await tx.village.findFirst({
            where: { name: { equals: upperName, mode: 'insensitive' }, blockId },
          });
          if (!village) {
            village = await tx.village.create({ data: { name: upperName, blockId } });
          }
          villageId = village.id;
        }
      }
    }

    return { blockId, villageId };
  }


  private async getNextSequenceValue(
    tx: Prisma.TransactionClient,
    seqName: string,
    tableName: string,
    prefix: string,
  ): Promise<number> {
    try {
      const result = await tx.$queryRawUnsafe<Array<{ nextval: bigint | number | string }>>(
        `SELECT nextval('${seqName}') AS nextval`
      );
      return Number(result[0].nextval);
    } catch {
      const rows = await tx.$queryRawUnsafe<Array<{ max: number | null }>>(`
        SELECT MAX(
          CAST(regexp_replace(UPPER("locationCode"), '^${prefix}', '') AS INTEGER)
        ) AS max
        FROM "${tableName}"
        WHERE UPPER("locationCode") ~ '^${prefix}[0-9]+$'
      `);
      return (rows[0]?.max ?? 0) + 1;
    }
  }

  private async generateNextLocationCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = LOCATION_CODE_PREFIX;
    const nextNumber = await this.getNextSequenceValue(
      tx,
      'awc_location_code_seq',
      'Awc',
      prefix,
    );
    const numeric = String(nextNumber).padStart(LOCATION_CODE_MIN_DIGITS, '0');
    return `${prefix}${numeric}`;
  }

  async create(dto: CreateLocationDto) {
    if (dto.projectId) {
      await this.assertProjectExists(dto.projectId);
    }

    const providedCode = dto.locationCode?.trim();
    const normalizedCode = providedCode ? providedCode.toUpperCase() : undefined;

    return this.prisma.$transaction(async (tx) => {
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        dto.districtId,
        dto.block,
        dto.village,
        dto.blockId,
        dto.villageId,
      );

      const { block, village, awcName, name, blockId: rawBlockId, villageId: rawVillageId, ...restDto } = dto as any;
      const finalAwcName = name || awcName;
      const awcData = { ...restDto, awcName: finalAwcName, blockId, villageId };

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

  async findAll(
    projectId?: number,
    stateId?: number,
    districtId?: number,
    blockId?: number,
    villageId?: number,
  ) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (stateId) where.stateId = stateId;
    if (districtId) where.districtId = districtId;
    if (blockId) where.blockId = blockId;
    if (villageId) where.villageId = villageId;

    const rows = await this.prisma.awc.findMany({
      where,
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
        dto.blockId,
        dto.villageId,
      );

      const { block, village, awcName, locationCode, blockId: rawBlockId, villageId: rawVillageId, ...restDto } = dto as any;
      
      const updateData: any = {
        ...restDto,
      };

      const nameToUpdate = (dto as any).name || awcName;
      if (nameToUpdate?.trim()) updateData.awcName = nameToUpdate.trim();
      if (normalizedCode) updateData.locationCode = normalizedCode;
      if (dto.block !== undefined || dto.blockId !== undefined) updateData.blockId = blockId;
      if (dto.village !== undefined || dto.villageId !== undefined) updateData.villageId = villageId;

      try {
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
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('AWC code already exists');
        }
        throw error;
      }
    });
  }

  async updateStatus(id: number, status: string) {
    return this.toAwcResponse(
      await this.prisma.awc.update({
        where: { id },
        data: { status },
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

  async disable(id: number) {
    return this.toAwcResponse(
      await this.prisma.awc.update({
        where: { id },
        data: { status: 'INACTIVE' },
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

  // ===================================
  // NEW SCHOOL & HEALTH CENTER SERVICES
  // ===================================

  private toSchoolResponse(school: any) {
    return transformSchool(school);
  }

  private toHealthCenterResponse(hc: any) {
    return transformHealthCenter(hc);
  }

  private async generateNextSchoolCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = 'SCH';
    const nextNumber = await this.getNextSequenceValue(
      tx,
      'school_location_code_seq',
      'School',
      prefix,
    );
    const numeric = String(nextNumber).padStart(1, '0');
    return `${prefix}${numeric}`;
  }

  private async generateNextHealthCenterCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = 'HC';
    const nextNumber = await this.getNextSequenceValue(
      tx,
      'health_center_location_code_seq',
      'HealthCenter',
      prefix,
    );
    const numeric = String(nextNumber).padStart(1, '0');
    return `${prefix}${numeric}`;
  }

  async createBlock(districtId: number, name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Block name cannot be empty');
    }
    const upperName = name.trim().toUpperCase();
    const existing = await this.prisma.block.findFirst({
      where: { name: { equals: upperName, mode: 'insensitive' }, districtId },
    });
    if (existing) {
      throw new ConflictException('Block name already exists in this district');
    }
    return this.prisma.block.create({
      data: { name: upperName, districtId },
    });
  }

  async createVillage(blockId: number, name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Village name cannot be empty');
    }
    const upperName = name.trim().toUpperCase();
    const existing = await this.prisma.village.findFirst({
      where: { name: { equals: upperName, mode: 'insensitive' }, blockId },
    });
    if (existing) {
      throw new ConflictException('Village name already exists in this block');
    }
    return this.prisma.village.create({
      data: { name: upperName, blockId },
    });
  }

  async createInstitution(dto: CreateInstitutionDto) {
    await this.assertProjectExists(dto.projectId);

    const providedCode = dto.locationCode?.trim();
    const normalizedCode = providedCode ? providedCode.toUpperCase() : undefined;

    return this.prisma.$transaction(async (tx) => {
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        dto.districtId,
        dto.block,
        dto.village,
        dto.blockId,
        dto.villageId,
      );

      const commonData = {
        projectId: dto.projectId,
        stateId: dto.stateId,
        districtId: dto.districtId,
        blockId,
        villageId,
        status: 'ACTIVE',
      };

      if (dto.type === 'AWC') {
        for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
          try {
            const code = normalizedCode || (await this.generateNextLocationCode(tx));
            if (normalizedCode) {
              const existing = await tx.awc.findFirst({ where: { locationCode: code } });
              if (existing) throw new ConflictException('AWC code already exists');
            }
            return await this.toAwcResponse(
              await tx.awc.create({
                data: {
                  ...commonData,
                  locationCode: code,
                  awcName: dto.awcName || dto.name || '',
                },
                include: {
                  project: { select: { id: true, name: true } },
                  state: { select: { name: true } },
                  district: { select: { name: true } },
                  block: { select: { name: true } },
                  village: { select: { name: true } },
                },
              }),
            );
          } catch (error) {
            if (normalizedCode || !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
              throw error;
            }
          }
        }
        throw new InternalServerErrorException('Failed to generate unique AWC code');
      } else if (dto.type === 'SCHOOL') {
        for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
          try {
            const code = normalizedCode || (await this.generateNextSchoolCode(tx));
            if (normalizedCode) {
              const existing = await tx.school.findFirst({ where: { locationCode: code } });
              if (existing) throw new ConflictException('School code already exists');
            }
            return await this.toSchoolResponse(
              await tx.school.create({
                data: {
                  ...commonData,
                  locationCode: code,
                  name: dto.schoolName || dto.name || '',
                },
                include: {
                  project: { select: { id: true, name: true } },
                  state: { select: { name: true } },
                  district: { select: { name: true } },
                  block: { select: { name: true } },
                  village: { select: { name: true } },
                },
              }),
            );
          } catch (error) {
            if (normalizedCode || !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
              throw error;
            }
          }
        }
        throw new InternalServerErrorException('Failed to generate unique School code');
      } else if (dto.type === 'HEALTH_CENTER') {
        for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
          try {
            const code = normalizedCode || (await this.generateNextHealthCenterCode(tx));
            if (normalizedCode) {
              const existing = await tx.healthCenter.findFirst({ where: { locationCode: code } });
              if (existing) throw new ConflictException('Health Center code already exists');
            }
            return await this.toHealthCenterResponse(
              await tx.healthCenter.create({
                data: {
                  ...commonData,
                  locationCode: code,
                  name: dto.healthCenterName || dto.name || '',
                },
                include: {
                  project: { select: { id: true, name: true } },
                  state: { select: { name: true } },
                  district: { select: { name: true } },
                  block: { select: { name: true } },
                  village: { select: { name: true } },
                },
              }),
            );
          } catch (error) {
            if (normalizedCode || !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
              throw error;
            }
          }
        }
        throw new InternalServerErrorException('Failed to generate unique Health Center code');
      }

      throw new BadRequestException('Invalid institution type');
    });
  }

  // =========================
  // SCHOOLS CRUD
  // =========================

  async findAllSchools(
    projectId?: number,
    stateId?: number,
    districtId?: number,
    blockId?: number,
    villageId?: number,
  ) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (stateId) where.stateId = stateId;
    if (districtId) where.districtId = districtId;
    if (blockId) where.blockId = blockId;
    if (villageId) where.villageId = villageId;

    const rows = await this.prisma.school.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSchoolResponse(r));
  }

  async updateSchool(id: number, dto: UpdateLocationDto) {
    if (dto.projectId) {
      await this.assertProjectExists(dto.projectId);
    }

    const school = await this.prisma.school.findUnique({
      where: { id },
      select: { id: true, districtId: true },
    });
    if (!school) throw new NotFoundException('School not found');

    const normalizedCode = dto.locationCode?.trim().toUpperCase();
    if (normalizedCode) {
      const existing = await this.prisma.school.findFirst({
        where: {
          locationCode: normalizedCode,
          NOT: { id },
        },
        select: { id: true },
      });
      if (existing) throw new ConflictException('School code already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const districtId = dto.districtId !== undefined ? dto.districtId : school.districtId;
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        districtId || undefined,
        dto.block,
        dto.village,
      );

      const nameToUpdate = (dto as any).name || dto.awcName;
      const updateData: any = {};

      if (nameToUpdate?.trim()) updateData.name = nameToUpdate.trim();
      if (normalizedCode) updateData.locationCode = normalizedCode;
      if (dto.stateId !== undefined) updateData.stateId = dto.stateId;
      if (dto.districtId !== undefined) updateData.districtId = districtId;
      if (dto.projectId !== undefined) updateData.projectId = dto.projectId;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.block !== undefined) updateData.blockId = blockId;
      if (dto.village !== undefined) updateData.villageId = villageId;

      try {
        return this.toSchoolResponse(
          await tx.school.update({
            where: { id },
            data: updateData,
            include: {
              project: { select: { id: true, name: true } },
              state: { select: { name: true } },
              district: { select: { name: true } },
              block: { select: { name: true } },
              village: { select: { name: true } },
            },
          }),
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('School code already exists');
        }
        throw error;
      }
    });
  }

  async updateSchoolStatus(id: number, status: string) {
    return this.toSchoolResponse(
      await this.prisma.school.update({
        where: { id },
        data: { status },
        include: { project: { select: { id: true, name: true } } },
      }),
    );
  }

  // =========================
  // HEALTH CENTERS CRUD
  // =========================

  async findAllHealthCenters(
    projectId?: number,
    stateId?: number,
    districtId?: number,
    blockId?: number,
    villageId?: number,
  ) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (stateId) where.stateId = stateId;
    if (districtId) where.districtId = districtId;
    if (blockId) where.blockId = blockId;
    if (villageId) where.villageId = villageId;

    const rows = await this.prisma.healthCenter.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toHealthCenterResponse(r));
  }

  async updateHealthCenter(id: number, dto: UpdateLocationDto) {
    if (dto.projectId) {
      await this.assertProjectExists(dto.projectId);
    }

    const hc = await this.prisma.healthCenter.findUnique({
      where: { id },
      select: { id: true, districtId: true },
    });
    if (!hc) throw new NotFoundException('Health Center not found');

    const normalizedCode = dto.locationCode?.trim().toUpperCase();
    if (normalizedCode) {
      const existing = await this.prisma.healthCenter.findFirst({
        where: {
          locationCode: normalizedCode,
          NOT: { id },
        },
        select: { id: true },
      });
      if (existing) throw new ConflictException('Health Center code already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const districtId = dto.districtId !== undefined ? dto.districtId : hc.districtId;
      const { blockId, villageId } = await this.resolveBlockAndVillageIds(
        tx,
        districtId || undefined,
        dto.block,
        dto.village,
      );

      const nameToUpdate = (dto as any).name || dto.awcName;
      const updateData: any = {};

      if (nameToUpdate?.trim()) updateData.name = nameToUpdate.trim();
      if (normalizedCode) updateData.locationCode = normalizedCode;
      if (dto.stateId !== undefined) updateData.stateId = dto.stateId;
      if (dto.districtId !== undefined) updateData.districtId = districtId;
      if (dto.projectId !== undefined) updateData.projectId = dto.projectId;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.block !== undefined) updateData.blockId = blockId;
      if (dto.village !== undefined) updateData.villageId = villageId;

      try {
        return this.toHealthCenterResponse(
          await tx.healthCenter.update({
            where: { id },
            data: updateData,
            include: {
              project: { select: { id: true, name: true } },
              state: { select: { name: true } },
              district: { select: { name: true } },
              block: { select: { name: true } },
              village: { select: { name: true } },
            },
          }),
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Health Center code already exists');
        }
        throw error;
      }
    });
  }

  async updateHealthCenterStatus(id: number, status: string) {
    return this.toHealthCenterResponse(
      await this.prisma.healthCenter.update({
        where: { id },
        data: { status },
        include: {
          project: { select: { id: true, name: true } },
          state: { select: { name: true } },
          district: { select: { name: true } },
          block: { select: { name: true } },
          village: { select: { name: true } },
        },
      }),
    );
  }

  async findOneSchool(id: number) {
    const row = await this.prisma.school.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('School not found');
    return this.toSchoolResponse(row);
  }

  async findOneHealthCenter(id: number) {
    const row = await this.prisma.healthCenter.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        state: { select: { name: true } },
        district: { select: { name: true } },
        block: { select: { name: true } },
        village: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('Health Center not found');
    return this.toHealthCenterResponse(row);
  }

  // ===================================
  // UNIFIED INSTITUTION METHODS
  // ===================================

  async findAllInstitutions(query: LocationQueryDto) {
    const where: any = {};
    if (query.projectId) where.projectId = query.projectId;
    if (query.stateId) where.stateId = query.stateId;
    if (query.districtId) where.districtId = query.districtId;
    if (query.blockId) where.blockId = query.blockId;
    if (query.villageId) where.villageId = query.villageId;
    if (query.status) where.status = query.status;

    const includes = {
      project: { select: { id: true, name: true } },
      state: { select: { name: true } },
      district: { select: { name: true } },
      block: { select: { name: true } },
      village: { select: { name: true } },
    };

    let awcs: any[] = [];
    let schools: any[] = [];
    let healthCenters: any[] = [];

    if (!query.type || query.type === 'AWC') {
      awcs = await this.prisma.awc.findMany({
        where,
        include: includes,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!query.type || query.type === 'SCHOOL') {
      schools = await this.prisma.school.findMany({
        where,
        include: includes,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!query.type || query.type === 'HEALTH_CENTER') {
      healthCenters = await this.prisma.healthCenter.findMany({
        where,
        include: includes,
        orderBy: { createdAt: 'desc' },
      });
    }

    const transformedAwcs = awcs.map(a => transformAwc(a));
    const transformedSchools = schools.map(s => transformSchool(s));
    const transformedHealthCenters = healthCenters.map(hc => transformHealthCenter(hc));

    let result = [...transformedAwcs, ...transformedSchools, ...transformedHealthCenters];

    if (query.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      result = result.filter(item => 
        (item.name?.toLowerCase() || '').includes(q) ||
        (item.awcName?.toLowerCase() || '').includes(q) ||
        (item.schoolName?.toLowerCase() || '').includes(q) ||
        (item.healthCenterName?.toLowerCase() || '').includes(q) ||
        (item.locationCode?.toLowerCase() || '').includes(q) ||
        (item.villageName?.toLowerCase() || '').includes(q) ||
        (item.blockName?.toLowerCase() || '').includes(q) ||
        (item.districtName?.toLowerCase() || '').includes(q) ||
        (item.stateName?.toLowerCase() || '').includes(q)
      );
    }

    return result;
  }

  async findInstitutionByTypeAndId(type: string, id: number) {
    const t = type.toUpperCase();
    if (t === 'AWC') return this.findOne(id);
    if (t === 'SCHOOL') return this.findOneSchool(id);
    if (t === 'HEALTH_CENTER' || t === 'HEALTHCENTER') return this.findOneHealthCenter(id);
    throw new BadRequestException(`Invalid institution type: ${type}`);
  }

  async updateInstitutionByTypeAndId(type: string, id: number, dto: UpdateLocationDto) {
    const t = type.toUpperCase();
    if (t === 'AWC') return this.update(id, dto);
    if (t === 'SCHOOL') return this.updateSchool(id, dto);
    if (t === 'HEALTH_CENTER' || t === 'HEALTHCENTER') return this.updateHealthCenter(id, dto);
    throw new BadRequestException(`Invalid institution type: ${type}`);
  }

  async updateInstitutionStatusByTypeAndId(type: string, id: number, status: string) {
    const t = type.toUpperCase();
    if (t === 'AWC') return this.updateStatus(id, status);
    if (t === 'SCHOOL') return this.updateSchoolStatus(id, status);
    if (t === 'HEALTH_CENTER' || t === 'HEALTHCENTER') return this.updateHealthCenterStatus(id, status);
    throw new BadRequestException(`Invalid institution type: ${type}`);
  }
}
