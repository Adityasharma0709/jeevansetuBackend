import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AssignUserDto } from 'src/projects/dto/assign-user.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { AssignProjectDto } from './dto/assign-project.dto';

const ADMIN_CODE_PREFIX = 'AC';
const ADMIN_CODE_MIN_DIGITS = 3;
const ADMIN_CODE_MAX_RETRIES = 5;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  private async ensureLocationLinkedToProject(
    projectId: number,
    locationId: number,
  ) {
    const linked = await this.prisma.project.count({
      where: { id: projectId, locations: { some: { id: locationId } } },
    });

    if (linked > 0) return;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { locations: { connect: { id: locationId } } },
    });
  }

  private async generateNextAdminUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const prefix = ADMIN_CODE_PREFIX;
    const prefixPattern = `^${prefix}`;
    const numericPattern = `^${prefix}[0-9]+$`;

    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(regexp_replace("usercode", ${prefixPattern}, '') AS INTEGER)) AS max
      FROM "User"
      WHERE "usercode" ~ ${numericPattern}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const numeric = String(nextNumber).padStart(ADMIN_CODE_MIN_DIGITS, '0');
    return `${prefix}${numeric}`;
  }

  async createAdmin(dto: CreateAdminDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (exists) {
      throw new BadRequestException('Email already exists');
    }

    const hash = await bcrypt.hash(dto.password, 10);

    for (let attempt = 0; attempt < ADMIN_CODE_MAX_RETRIES; attempt++) {
      try {
        const user = await this.prisma.$transaction(async (tx) => {
          const usercode = await this.generateNextAdminUserCode(tx);

          const user = await tx.user.create({
            data: {
              name: dto.name,
              email: dto.email,
              password: hash,
              status: 'ACTIVE',
              usercode,
            },
          });

          const role = await tx.role.findUnique({
            where: { name: 'ADMIN' },
          });

          if (!role) {
            throw new BadRequestException('ADMIN role does not exist');
          }

          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: role.id,
            },
          });

          return user;
        });

        const { password, ...safeUser } = user;
        return {
          message: 'Admin created successfully',
          safeUser,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            const target = error.meta?.target;
            const isUsercodeConflict = Array.isArray(target)
              ? target.includes('usercode')
              : typeof target === 'string'
                ? target.includes('usercode')
                : false;

            if (isUsercodeConflict) {
              continue;
            }
          }
        }
        throw error;
      }
    }

    throw new ConflictException('Could not generate a unique admin user code');
  }
  async updateAdminStatus(id: number, status: string) {
    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  async updateAdmin(id: number, dto: UpdateAdminDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateAdmin(id: number) {
    return this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  async getAllAdmins() {
    return this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              name: 'ADMIN',
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAdminById(id: number) {
    const admin = await this.prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: { name: 'ADMIN' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        status: true,
        createdAt: true,
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return admin;
  }

  async searchAdminByName(name: string) {
    return this.prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
        roles: {
          some: {
            role: { name: 'ADMIN' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async assignUser(dto: AssignUserDto) {
    // check user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('User not found');

    // check project exists
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException('Project not found');

    // check location exists
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location) throw new NotFoundException('Location not found');

    await this.ensureLocationLinkedToProject(dto.projectId, dto.locationId);

    // check duplicate assignment
    const exists = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: dto.userId,
        projectId: dto.projectId,
        locationId: dto.locationId,
      },
    });

    if (exists) {
      throw new BadRequestException('Already assigned');
    }

    return this.prisma.userProjectLocation.create({
      data: dto,
    });
  }

  async createManager(dto: CreateManagerDto, adminUser: any) {
    const adminId = adminUser?.userId ?? adminUser?.id;
    if (!adminId) {
      throw new ForbiddenException('Admin identity not found in token');
    }

    // 1. Check admin assignment if project/location provided
    if (dto.projectId && dto.locationId) {
      const allowed = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: adminId,
          projectId: dto.projectId,
          locationId: dto.locationId,
        },
      });

      if (!allowed) {
        throw new ForbiddenException(
          'You are not assigned to this project/location',
        );
      }
    }

    // 2. Check email
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new BadRequestException('Email exists');

    // 3. Create user
    const hash = await bcrypt.hash(dto.password, 10);

    const manager = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        status: 'ACTIVE',
        createdByAdminId: adminId,
      },
    });

    const role = await this.prisma.role.findUnique({
      where: { name: 'MANAGER' },
    });

    if (!role) {
      throw new BadRequestException('MANAGER role does not exist');
    }

    await this.prisma.userRole.create({
      data: {
        userId: manager.id,
        roleId: role.id,
      },
    });

    const { password, ...safeUser } = manager;
    return {
      message: 'Manager created successfully',
      user: safeUser,
    };
  }

  async updateManager(
    managerId: number,
    dto: UpdateManagerDto,
    loggedUser: any,
  ) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      include: {
        roles: { include: { role: true } },
      },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    const isManager = manager.roles.some((r) => r.role.name === 'MANAGER');

    if (!isManager) {
      throw new BadRequestException('User is not a Manager');
    }

    // 🔥 CASE 1: MANAGER updating self
    if (loggedUser.roles?.includes('MANAGER') && (loggedUser.userId || loggedUser.id) !== managerId) {
      throw new ForbiddenException('You can update only your own profile');
    }

    // 🔥 CASE 2: ADMIN updating manager
    if (loggedUser.roles?.includes('ADMIN')) {
      const allowed = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: loggedUser.userId || loggedUser.id,
          projectId: {
            in: (
              await this.prisma.userProjectLocation.findMany({
                where: { userId: managerId },
                select: { projectId: true },
              })
            ).map((p) => p.projectId),
          },
        },
      });

      if (!allowed) {
        throw new ForbiddenException('You cannot modify this manager');
      }
    }

    // Hash password if updating
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id: managerId },
      data: dto,
    });

    const { password, ...safe } = updated;

    return {
      message: 'Profile updated successfully',
      user: safe,
    };
  }

  async assignProjectLocation(dto: AssignProjectDto, loggedUser: any) {
    // 1. RBAC Check
    if (!loggedUser.roles?.includes('SUPER_ADMIN')) {
      const loggedUserId = loggedUser.userId || loggedUser.id;
      const isAdmin = loggedUser.roles?.includes('ADMIN');

      const isAssigned = await this.prisma.userProjectLocation.findFirst({
        where: isAdmin
          ? {
              // Admins get project-wide access once assigned to the project
              userId: loggedUserId,
              projectId: dto.projectId,
            }
          : {
              // Managers are scoped to project + location
              userId: loggedUserId,
              projectId: dto.projectId,
              locationId: dto.locationId,
            },
      });

      if (!isAssigned) {
        throw new ForbiddenException(
          isAdmin
            ? 'You are not assigned to this project'
            : 'You are not assigned to this project & location',
        );
      }

      if (loggedUser.roles?.includes('MANAGER')) {
        // MANAGER can only assign to OUTREACH role
        const targetUser = await this.prisma.user.findUnique({
          where: { id: dto.userId },
          include: { roles: { include: { role: true } } },
        });

        if (!targetUser) throw new NotFoundException('Target user not found');

        const isOutreach = targetUser.roles.some(
          (ur) => ur.role.name === 'OUTREACH',
        );
        if (!isOutreach) {
          throw new ForbiddenException(
            'Managers can only assign projects to Outreach workers',
          );
        }
      }
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      include: { roles: { include: { role: true } } },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const targetRoleNames = targetUser.roles?.map((r) => r.role.name) ?? [];
    const isTargetAdmin = targetRoleNames.includes('ADMIN');

    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
      select: { id: true },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    await this.ensureLocationLinkedToProject(dto.projectId, dto.locationId);

    // 2. Check duplicate
    const exists = await this.prisma.userProjectLocation.findFirst({
      where: isTargetAdmin
        ? {
            userId: dto.userId,
            projectId: dto.projectId,
          }
        : {
            userId: dto.userId,
            projectId: dto.projectId,
            locationId: dto.locationId,
          },
    });

    if (exists) {
      throw new ConflictException(
        isTargetAdmin
          ? 'User already assigned to this project'
          : 'User already assigned to this project & location',
      );
    }

    return this.prisma.userProjectLocation.create({
      data: {
        userId: dto.userId,
        projectId: dto.projectId,
        locationId: dto.locationId,
      },
    });
  }
  //super-admin dashboard
  async superAdminDashboard() {

    const totalProjects = await this.prisma.project.count();
    const totalLocations = await this.prisma.location.count();

    const beneficiariesPerProject =
      await this.prisma.project.findMany({
        select: {
          id: true,
          name: true,
          projectCode: true,
          _count: {
            select: { beneficiaries: true }
          }
        }
      });

    return {
      totalProjects,
      totalLocations,
      beneficiariesPerProject
    };
  }

  async findUsersByRole(roleName: string, search?: string, loggedUser?: any) {
    const whereClause: any = {
      roles: {
        some: {
          role: {
            name: roleName,
          },
        },
      },
    };

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Scoping for ADMIN viewing MANAGER
    if (roleName === 'MANAGER' && loggedUser?.roles?.includes('ADMIN')) {
      whereClause.createdByAdminId = loggedUser.userId || loggedUser.id;
    }

    return this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateProfile(userId: number, dto: any) {
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }
    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete dto.email;
    delete dto.status;
    delete dto.roles;
    delete dto.mobile; // mobile field doesn't exist in User model

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
      }
    });
  }
}
