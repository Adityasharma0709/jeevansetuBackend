import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnauthorizedException,
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

const MANAGER_CODE_PREFIX = 'MC';
const MANAGER_CODE_MIN_DIGITS = 2;
const MANAGER_CODE_MAX_RETRIES = 5;

const OUTREACH_CODE_PREFIX = 'OW';
const OUTREACH_CODE_MIN_DIGITS = 2;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  private assertIsActive(status: string | null | undefined, label: string) {
    if ((status ?? '').toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException(`${label} is deactivated`);
    }
  }

  private async ensureLocationLinkedToProject(
    projectId: number,
    locationId: number,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const linked = await tx.project.count({
      where: { id: projectId, awcs: { some: { id: locationId } } },
    });

    if (linked > 0) return;

    await tx.project.update({
      where: { id: projectId },
      data: { awcs: { connect: { id: locationId } } },
    });
  }

  private async generateNextAdminUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNextUserCode(ADMIN_CODE_PREFIX, ADMIN_CODE_MIN_DIGITS, tx);
  }

  private async generateNextManagerUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNextUserCode(MANAGER_CODE_PREFIX, MANAGER_CODE_MIN_DIGITS, tx);
  }

  private async generateNextOutreachUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNextUserCode(OUTREACH_CODE_PREFIX, OUTREACH_CODE_MIN_DIGITS, tx);
  }

  private async generateNextUserCode(
    prefix: string,
    minDigits: number,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const safePrefix = (prefix ?? '')
      .toString()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .padEnd(2, 'X')
      .slice(0, 2);

    const likePrefix = `${safePrefix}%`;
    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(
        CAST(NULLIF(regexp_replace("usercode", '\\D', '', 'g'), '') AS INTEGER)
      ) AS max
      FROM "User"
      WHERE upper("usercode") LIKE ${likePrefix}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const digits = String(nextNumber).padStart(Math.max(2, minDigits), '0');
    return `${safePrefix}${digits}`;
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

  async getNextUserCode(role: string, loggedUser?: any) {
    const normalized = (role ?? '').toString().trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('Role is required');
    }

    const roles = Array.isArray(loggedUser?.roles) ? loggedUser.roles : [];

    if (normalized === 'ADMIN') {
      if (!roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException('Not allowed to generate admin codes');
      }
      const code = await this.generateNextAdminUserCode(this.prisma);
      return { code };
    }

    if (normalized === 'MANAGER') {
      if (!roles.includes('ADMIN') && !roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException('Not allowed to generate manager codes');
      }
      const code = await this.generateNextManagerUserCode(this.prisma);
      return { code };
    }

    if (normalized === 'OUTREACH') {
      if (!roles.includes('MANAGER') && !roles.includes('ADMIN') && !roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException('Not allowed to generate outreach codes');
      }
      const code = await this.generateNextOutreachUserCode(this.prisma);
      return { code };
    }

    throw new BadRequestException('Invalid role');
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

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.status !== undefined) data.status = dto.status;
    
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async removeAdminFromProject(id: number, projectId: number) {
    const admin = await this.getAdminById(id);
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    
    await this.prisma.userProjectLocation.deleteMany({
      where: { userId: id, projectId: projectId },
    });
    
    return { message: 'Admin removed from project' };
  }

  async removeManagerFromProject(id: number, projectId: number) {
    const manager = await this.prisma.user.findFirst({ where: { id, roles: { some: { role: { name: 'MANAGER' } } } } });
    if (!manager) throw new NotFoundException('Manager not found');
    await this.prisma.userProjectLocation.deleteMany({
      where: { userId: id, projectId: projectId },
    });
    return { message: 'Manager removed from project' };
  }

  async removeOutreachFromProject(id: number, projectId: number) {
    const outreach = await this.prisma.user.findFirst({ where: { id, roles: { some: { role: { name: 'OUTREACH' } } } } });
    if (!outreach) throw new NotFoundException('Outreach worker not found');
    await this.prisma.userProjectLocation.deleteMany({
      where: { userId: id, projectId: projectId },
    });
    return { message: 'Outreach worker removed from project' };
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
    const awc = await this.prisma.awc.findUnique({
      where: { id: dto.locationId },
    });
    if (!awc) throw new NotFoundException('AWC not found');

    await this.ensureLocationLinkedToProject(dto.projectId, dto.locationId);

    // check duplicate assignment
    const exists = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: dto.userId,
        projectId: dto.projectId,
      },
    });

    if (exists) {
      throw new BadRequestException('Already assigned');
    }

    return this.prisma.userProjectLocation.create({
      data: {
        userId: dto.userId,
        projectId: dto.projectId,
      },
    });
  }

  async createManager(dto: CreateManagerDto, adminUser: any) {
    const adminId = adminUser?.userId ?? adminUser?.id;
    if (!adminId) {
      throw new UnauthorizedException('Admin identity not found in token');
    }

    const projectId = Number(dto.projectId);
    const stateId = Number(dto.stateId);
    const hasProject = Number.isFinite(projectId) && projectId > 0;
    const hasState = Number.isFinite(stateId) && stateId > 0;

    if (hasProject !== hasState) {
      throw new BadRequestException('Select both project and state');
    }

    if (hasProject && hasState) {
      const allowed = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: adminId,
          projectId,
        },
      });

      if (!allowed) {
        throw new ForbiddenException('You are not assigned to this project');
      }

      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, status: true },
      });
      if (!project) throw new NotFoundException('Project not found');
      this.assertIsActive(project.status, 'Project');

      const state = await this.prisma.state.findUnique({ where: { id: stateId } });
      if (!state) throw new NotFoundException('State not found');
    }

    const email = (dto.email ?? '').trim();

    const exists = await this.prisma.user.findUnique({
      where: { email },
    });
    if (exists) throw new BadRequestException('Email already exists');

    const hash = await bcrypt.hash(dto.password, 10);

    for (let attempt = 0; attempt < MANAGER_CODE_MAX_RETRIES; attempt++) {
      try {
        const manager = await this.prisma.$transaction(async (tx) => {
          const role = await tx.role.findUnique({
            where: { name: 'MANAGER' },
          });

          if (!role) {
            throw new BadRequestException('MANAGER role does not exist');
          }

          const usercode = await this.generateNextManagerUserCode(tx);

          const user = await tx.user.create({
            data: {
              name: dto.name,
              email,
              usercode,
              mobileNumber: dto.mobileNumber ?? dto.mobile ?? null,
              password: hash,
              status: 'ACTIVE',
              createdByAdminId: adminId,
            },
          });

          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: role.id,
            },
          });

          if (hasProject && hasState) {
            const linkedState = await tx.projectState.findFirst({ where: { projectId, stateId } });
            if (!linkedState) {
              await tx.projectState.create({ data: { projectId, stateId } });
            }
            await tx.userProjectLocation.create({
              data: {
                userId: user.id,
                projectId,
                stateId,
              },
            });
          }

          return user;
        });

        const { password, ...safeUser } = manager;
        return {
          message: 'Manager created successfully',
          user: safeUser,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = error.meta?.target;
          const targets = Array.isArray(target)
            ? target
            : typeof target === 'string'
              ? [target]
              : [];

          if (targets.some((t) => t.includes('email'))) {
            throw new ConflictException('Email already exists');
          }
          if (targets.some((t) => t.includes('usercode'))) {
            continue;
          }
        }
        throw error;
      }
    }

    throw new ConflictException('Could not generate a unique manager user code');
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

    // MANAGER updating self
    if (loggedUser.roles?.includes('MANAGER') && (loggedUser.userId || loggedUser.id) !== managerId) {
      throw new ForbiddenException('You can update only your own profile');
    }

    // ADMIN updating manager
    if (loggedUser.roles?.includes('ADMIN')) {
      const loggedUserId = loggedUser.userId || loggedUser.id;

      // Creator admin can always update their own manager
      if (manager.createdByAdminId !== loggedUserId) {
        const managerProjects = await this.prisma.userProjectLocation.findMany({
          where: { userId: managerId },
          select: { projectId: true },
        });

        if (managerProjects.length === 0) {
          throw new ForbiddenException('You cannot modify this manager');
        }

        const allowed = await this.prisma.userProjectLocation.findFirst({
          where: {
            userId: loggedUserId,
            projectId: { in: managerProjects.map((p) => p.projectId) },
          },
        });

        if (!allowed) {
          throw new ForbiddenException('You cannot modify this manager');
        }
      }
    }

    const data: Record<string, any> = { ...dto };

    // Hash password if updating
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    if (data.mobile !== undefined && data.mobileNumber === undefined) {
      data.mobileNumber = data.mobile;
    }
    delete data.mobile;

    const updated = await this.prisma.user.update({
      where: { id: managerId },
      data: data,
    });

    const { password, ...safe } = updated;

    return {
      message: 'Profile updated successfully',
      user: safe,
    };
  }

  async assignProjectLocation(dto: AssignProjectDto, loggedUser: any) {
    const targetUserId = Number(dto.userId);
    const projectId = Number(dto.projectId);
    const stateId = dto.stateId ? Number(dto.stateId) : null;

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: { include: { role: true } } },
    });

    if (!targetUser) throw new NotFoundException('Target user not found');

    const targetRoleNames = targetUser.roles?.map((r) => r.role.name) ?? [];
    const isTargetManager = targetRoleNames.includes('MANAGER');
    const isTargetOutreach = targetRoleNames.includes('OUTREACH');

    if ((isTargetManager || isTargetOutreach) && !stateId) {
      throw new BadRequestException('State is required for this user role');
    }

    // RBAC Check
    if (!loggedUser.roles?.includes('SUPER_ADMIN')) {
      const loggedUserId = loggedUser.userId || loggedUser.id;
      const isManager = loggedUser.roles?.includes('MANAGER');

      const isAssigned = await this.prisma.userProjectLocation.findFirst({
        where: { userId: loggedUserId, projectId: projectId },
      });

      if (!isAssigned) throw new ForbiddenException('You are not assigned to this project');

      if (isManager && !isTargetOutreach) {
        throw new ForbiddenException('Managers can only assign projects to Outreach workers');
      }
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    this.assertIsActive(project.status, 'Project');

    if (stateId) {
      const state = await this.prisma.state.findUnique({ where: { id: stateId } });
      if (!state) throw new NotFoundException('State not found');
      const linkedState = await this.prisma.projectState.findFirst({ where: { projectId, stateId } });
      if (!linkedState) {
        await this.prisma.projectState.create({ data: { projectId, stateId } });
      }
    }

    const exists = await this.prisma.userProjectLocation.findFirst({
      where: { userId: targetUserId, projectId: projectId, stateId: stateId },
    });

    if (exists) throw new ConflictException('User already assigned to this project & state');

    return this.prisma.userProjectLocation.create({
      data: { userId: targetUserId, projectId: projectId, stateId: stateId },
    });
  }

  async superAdminDashboard() {
    const totalProjects = await this.prisma.project.count();
    const totalLocations = await this.prisma.awc.count();

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
        usercode: true,
        mobileNumber: true,
        createdByAdminId: true,
        createdByAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
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

    if (dto.mobile !== undefined && dto.mobileNumber === undefined) {
      dto.mobileNumber = dto.mobile;
    }

    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete dto.email;
    delete dto.status;
    delete dto.roles;
    delete dto.mobile;

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      }
    });
  }

  async assignOutreachManager(outreachId: number, managerId: number, loggedUser: any) {
    const outreach = await this.prisma.user.findFirst({
      where: { id: outreachId, roles: { some: { role: { name: 'OUTREACH' } } } }
    });
    if (!outreach) throw new NotFoundException('Outreach worker not found');
    
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, roles: { some: { role: { name: 'MANAGER' } } } }
    });
    if (!manager) throw new NotFoundException('Manager not found');

    return this.prisma.user.update({
      where: { id: outreachId },
      data: { createdByAdminId: managerId },
      select: {
        id: true,
        name: true,
        email: true,
        createdByAdminId: true,
        createdByAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });
  }
}
