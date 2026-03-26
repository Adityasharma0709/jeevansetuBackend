import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const LOCATION_CODE_PREFIX = 'LC';
const LOCATION_CODE_MIN_DIGITS = 2; // LC01 => minimum total length 4
const LOCATION_CODE_MAX_RETRIES = 5;

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

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
    if (dto.projectId != null) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });

      if (!project) {
        throw new NotFoundException('Project not found');
      }
    }

    const providedCode = dto.locationCode?.trim();
    if (providedCode) {
      try {
        return await this.prisma.location.create({
          data: {
            ...dto,
            locationCode: providedCode.toUpperCase(),
          },
        });
      } catch (error) {
        this.handleLocationPrismaError(error);
      }
    }

    const { locationCode: _locationCode, ...rest } = dto;

    for (let attempt = 0; attempt < LOCATION_CODE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const locationCode = await this.generateNextLocationCode(tx);
          return tx.location.create({
            data: {
              ...rest,
              locationCode,
            },
          });
        });
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
  return this.prisma.location.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      locationCode: true,
      projectId: true,
      state: true,
      district: true,
      block: true,
      village: true,
      status: true,
      updatedAt: true,
    },
  });
}

  findAll(projectId?: number) {
    return this.prisma.location.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: number) {
    return this.prisma.location.findUnique({ where: { id } });
  }

  update(id: number, dto: UpdateLocationDto) {
    return this.prisma.location.update({
      where: { id },
      data: dto,
    });
  }

  disable(id: number) {
    return this.prisma.location.update({
      where: { id },
      data: { status: 'INACTIVE' },
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
