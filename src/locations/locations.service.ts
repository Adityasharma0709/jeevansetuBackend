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

  private async assertProjectsExist(projectIds: number[]) {
    if (projectIds.length === 0) return;

    const existing = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, status: true },
    });

    const existingIds = new Set(existing.map((p) => p.id));
    const missing = projectIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Project not found: ${missing.join(', ')}`);
    }

    const inactive = existing
      .filter((p) => (p?.status ?? '').toString().toUpperCase() !== 'ACTIVE')
      .map((p) => p.id);
    if (inactive.length > 0) {
      throw new BadRequestException(`Project is deactivated: ${inactive.join(', ')}`);
    }
  }

  private normalizeProjectIds(dto: {
    projectId?: number;
    projectIds?: number[];
  }): number[] {
    if (Array.isArray(dto.projectIds) && dto.projectIds.length > 0) {
      return dto.projectIds;
    }

    if (dto.projectId != null) return [dto.projectId];
    return [];
  }

  private toLocationResponse(location: any) {
    const projectIds = Array.isArray(location?.projects)
      ? location.projects.map((p: any) => p.id)
      : [];
    return { ...location, projectIds };
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
      FROM "Location"
      WHERE UPPER("locationCode") ~ ${numericPattern}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const numeric = String(nextNumber).padStart(LOCATION_CODE_MIN_DIGITS, '0');
    return `${prefix}${numeric}`;
  }

  async create(dto: CreateLocationDto) {
    const projectIds = this.normalizeProjectIds(dto);
    await this.assertProjectsExist(projectIds);

    const providedCode = dto.locationCode?.trim();
    const normalizedCode = providedCode ? providedCode.toUpperCase() : undefined;

    if (normalizedCode) {
      const existing = await this.prisma.location.findFirst({
        where: { locationCode: normalizedCode },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('Location code already exists');
      }

      const { projectId: _projectId, projectIds: _projectIds, ...rest } = dto;

      return this.toLocationResponse(
        await this.prisma.location.create({
          data: {
            ...rest,
            locationCode: normalizedCode,
            district: rest.district ?? null,
            block: rest.block ?? null,
            village: rest.village ?? null,
            ...(projectIds.length > 0
              ? {
                  projects: {
                    connect: projectIds.map((id) => ({ id })),
                  },
                }
              : {}),
          },
          include: { projects: { select: { id: true, name: true } } },
        }),
      );
    }

    const {
      locationCode: _locationCode,
      projectId: _projectId,
      projectIds: _projectIds,
      ...rest
    } = dto;

    for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
      try {
        return this.toLocationResponse(
          await this.prisma.$transaction(async (tx) => {
            const locationCode = await this.generateNextLocationCode(tx);
            return tx.location.create({
              data: {
                ...rest,
                locationCode,
                district: rest.district ?? null,
                block: rest.block ?? null,
                village: rest.village ?? null,
                ...(projectIds.length > 0
                  ? {
                      projects: {
                        connect: projectIds.map((id) => ({ id })),
                      },
                    }
                  : {}),
              },
              include: { projects: { select: { id: true, name: true } } },
            });
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

        this.handleLocationPrismaError(error);
      }
    }

    throw new ConflictException('Could not generate a unique location code');
  }
  async updateStatus(id: number, status: string) {
    return this.toLocationResponse(
      await this.prisma.location.update({
        where: { id },
        data: { status },
        include: { projects: { select: { id: true, name: true } } },
      }),
    );
  }

  findAll(projectId?: number) {
    return this.prisma.location
      .findMany({
        where: projectId ? { projects: { some: { id: projectId } } } : {},
        include: { projects: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      .then((rows) => rows.map((r) => this.toLocationResponse(r)));
  }

  findOne(id: number) {
    return this.prisma.location
      .findUnique({
        where: { id },
        include: { projects: { select: { id: true, name: true } } },
      })
      .then((row) => (row ? this.toLocationResponse(row) : row));
  }

  update(id: number, dto: UpdateLocationDto) {
    const shouldSetProjects = Array.isArray(dto.projectIds);
    const projectIds = shouldSetProjects ? dto.projectIds ?? [] : this.normalizeProjectIds(dto);

    return this.assertProjectsExist(projectIds).then(async () => {
      const isProjectAssignment = shouldSetProjects || dto.projectId != null;
      if (isProjectAssignment) {
        const location = await this.prisma.location.findUnique({
          where: { id },
          select: { id: true, status: true },
        });
        if (!location) throw new NotFoundException('Location not found');
        if ((location.status ?? '').toString().toUpperCase() !== 'ACTIVE') {
          throw new BadRequestException('Location is deactivated');
        }
      }

      const {
        projectId: _projectId,
        projectIds: _projectIds,
        locationCode,
        ...rest
      } = dto;

      const normalizedLocationCode = locationCode
        ? locationCode.trim().toUpperCase()
        : undefined;

      if (normalizedLocationCode) {
        const existing = await this.prisma.location.findFirst({
          where: {
            locationCode: normalizedLocationCode,
            NOT: { id },
          },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException('Location code already exists');
        }
      }

      if (shouldSetProjects) {
        return this.toLocationResponse(
          await this.prisma.location.update({
            where: { id },
            data: {
              ...rest,
              ...(normalizedLocationCode
                ? { locationCode: normalizedLocationCode }
                : {}),
              projects: {
                set: projectIds.map((pid) => ({ id: pid })),
              },
            },
            include: { projects: { select: { id: true, name: true } } },
          }),
        );
      }

      if (dto.projectId != null) {
        const alreadyLinked = await this.prisma.location.count({
          where: { id, projects: { some: { id: dto.projectId } } },
        });

        return this.toLocationResponse(
          await this.prisma.location.update({
            where: { id },
            data: {
              ...rest,
              ...(normalizedLocationCode
                ? { locationCode: normalizedLocationCode }
                : {}),
              ...(alreadyLinked
                ? {}
                : {
                    projects: {
                      connect: { id: dto.projectId },
                    },
                  }),
            },
            include: { projects: { select: { id: true, name: true } } },
          }),
        );
      }

      return this.toLocationResponse(
        await this.prisma.location.update({
          where: { id },
          data: {
            ...rest,
            ...(normalizedLocationCode ? { locationCode: normalizedLocationCode } : {}),
          },
          include: { projects: { select: { id: true, name: true } } },
        }),
      );
    });
  }

  disable(id: number) {
    return this.prisma.location
      .update({
        where: { id },
        data: { status: 'INACTIVE' },
        include: { projects: { select: { id: true, name: true } } },
      })
      .then((row) => this.toLocationResponse(row));
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

  private handleLocationPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Location not found');
      }

      if (error.code === 'P2002') {
        throw new ConflictException('Location code already exists');
      }
    }

    throw error;
  }
}
