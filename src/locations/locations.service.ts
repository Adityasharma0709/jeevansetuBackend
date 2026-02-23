import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLocationDto) {
    if (dto.projectId != null) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });

      if (!project) {
        throw new NotFoundException('Project not found');
      }
    }

    return this.prisma.location.create({ data: dto });
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
}
