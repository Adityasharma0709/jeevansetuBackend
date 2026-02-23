import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) { }

  async create(dto: CreateProjectDto) {
    try {
      return await this.prisma.project.create({ data: dto });
    } catch (error) {
      this.handleProjectPrismaError(error);
    }
  }

  async findAssignedToUser(userId: number) {
    return this.prisma.project.findMany({
      where: {
        assignments: {
          some: {
            userId,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    try {
      return await this.prisma.project.update({
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
    } catch (error) {
      this.handleProjectPrismaError(error);
    }
  }

  findOne(id: number) {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async update(id: number, dto: UpdateProjectDto) {
    try {
      return await this.prisma.project.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      this.handleProjectPrismaError(error);
    }
  }

  async disable(id: number) {
    try {
      return await this.prisma.project.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
    } catch (error) {
      this.handleProjectPrismaError(error);
    }
  }

  private handleProjectPrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Project not found');
      }

      if (error.code === 'P2002') {
        throw new ConflictException('Project code already exists');
      }
    }

    throw error;
  }
}
