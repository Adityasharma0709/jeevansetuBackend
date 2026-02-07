import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  create(dto) {
    return this.prisma.project.create({ data: dto });
  }

  findAll(search?: string) {
    if (!search) {
      return this.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prisma.project.findMany({
      where: {
        OR: [
          {
            projectCode: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: number, status: string) {
  return this.prisma.project.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      projectCode: true,
      name: true,
      status: true,
      updatedAt: true,
    },
  });
}

  findOne(id: number) {
    return this.prisma.project.findUnique({ where: { id } });
  }

  update(id: number, dto) {
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  disable(id: number) {
    return this.prisma.project.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }
}
