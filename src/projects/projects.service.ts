import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const PROJECT_CODE_PREFIX = 'PR';
const PROJECT_CODE_MIN_DIGITS = 2;
const PROJECT_CODE_MAX_LENGTH = 4;
const PROJECT_CODE_MAX_RETRIES = 5;

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) { }

  private async generateNextProjectCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = PROJECT_CODE_PREFIX;
    const prefixPattern = `^${prefix}`;
    const numericPattern = `^${prefix}[0-9]+$`;

    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(regexp_replace("projectCode", ${prefixPattern}, '') AS INTEGER)) AS max
      FROM "Project"
      WHERE "projectCode" ~ ${numericPattern}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const numeric = String(nextNumber).padStart(PROJECT_CODE_MIN_DIGITS, '0');
    const code = `${prefix}${numeric}`;

    if (code.length > PROJECT_CODE_MAX_LENGTH) {
      throw new ConflictException(
        `Auto project code limit exceeded (generated: ${code}). Increase Project.projectCode length to allow more projects.`,
      );
    }

    return code;
  }

  async create(dto: CreateProjectDto) {
    const providedCode = dto.projectCode?.trim();

    if (providedCode) {
      try {
        return await this.prisma.project.create({
          data: {
            ...dto,
            projectCode: providedCode.toUpperCase(),
          },
        });
      } catch (error) {
        this.handleProjectPrismaError(error);
      }
    }

    const { projectCode: _projectCode, ...rest } = dto;

    for (let attempt = 0; attempt < PROJECT_CODE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const projectCode = await this.generateNextProjectCode(tx);
          return tx.project.create({
            data: {
              ...rest,
              projectCode,
            },
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            const target = error.meta?.target;
            const isProjectCodeConflict = Array.isArray(target)
              ? target.includes('projectCode')
              : typeof target === 'string'
                ? target.includes('projectCode')
                : false;

            if (isProjectCodeConflict) {
              continue;
            }
          }
        }

        this.handleProjectPrismaError(error);
      }
    }

    throw new ConflictException('Could not generate a unique project code');
  }

  async findAssignedToUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        roles: {
          select: {
            role: { select: { name: true } },
          },
        },
      },
    });

    const roleNames = user?.roles?.map((r) => r.role.name) ?? [];
    const isAdmin = roleNames.includes('ADMIN');

    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      include: {
        project: true,
        awc: true,
      },
      orderBy: { project: { createdAt: 'desc' } },
    });

    if (isAdmin) {
      const projectIds = Array.from(new Set(assignments.map((a) => a.projectId)));
      if (projectIds.length === 0) return [];

      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        include: { awcs: true },
        orderBy: { createdAt: 'desc' },
      });

      return projects.map((p) => ({
        ...p,
        awcs: p.awcs,
      }));
    }

    const projectMap = new Map();
    for (const a of assignments) {
      if (!projectMap.has(a.projectId)) {
        projectMap.set(a.projectId, {
          ...a.project,
          awcs: [],
        });
      }
      if (a.awc) {
        projectMap.get(a.projectId).awcs.push(a.awc);
      }
    }

    return Array.from(projectMap.values());
  }

  findAll(search?: string) {
    if (!search) {
      return this.prisma.project.findMany({
        include: { awcs: true },
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
      include: { awcs: true },
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
