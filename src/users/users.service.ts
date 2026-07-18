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
import { CreateAnalystDto } from './dto/create-analyst.dto';
import { UpdateAnalystDto } from './dto/update-analyst.dto';

const ADMIN_CODE_PREFIX = 'AC';
const ADMIN_CODE_MIN_DIGITS = 3;
const ADMIN_CODE_MAX_RETRIES = 5;

const MANAGER_CODE_PREFIX = 'MC';
const MANAGER_CODE_MIN_DIGITS = 2;
const MANAGER_CODE_MAX_RETRIES = 5;

const OUTREACH_CODE_PREFIX = 'OW';
const OUTREACH_CODE_MIN_DIGITS = 2;

const ANALYST_CODE_PREFIX = 'AN';
const ANALYST_CODE_MIN_DIGITS = 2;
const ANALYST_CODE_MAX_RETRIES = 5;

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

  private async generateNextAnalystUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateNextUserCode(ANALYST_CODE_PREFIX, ANALYST_CODE_MIN_DIGITS, tx);
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

    if (normalized === 'ANALYST') {
      if (!roles.includes('SUPER_ADMIN')) {
        throw new ForbiddenException('Not allowed to generate analyst codes');
      }
      const code = await this.generateNextAnalystUserCode(this.prisma);
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

  async removeAnalystFromProject(id: number, projectId: number) {
    const analyst = await this.getAnalystById(id);
    if (!analyst) {
      throw new NotFoundException('Analyst not found');
    }
    
    await this.prisma.userProjectLocation.deleteMany({
      where: { userId: id, projectId: projectId },
    });
    
    return { message: 'Analyst removed from project' };
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

  // =========================
  // ANALYST METHODS
  // =========================

  async createAnalyst(dto: CreateAnalystDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (exists) {
      throw new BadRequestException('Email already exists');
    }

    const hash = await bcrypt.hash(dto.password, 10);

    for (let attempt = 0; attempt < ANALYST_CODE_MAX_RETRIES; attempt++) {
      try {
        const user = await this.prisma.$transaction(async (tx) => {
          const usercode = await this.generateNextAnalystUserCode(tx);

          const user = await tx.user.create({
            data: {
              name: dto.name,
              email: dto.email,
              password: hash,
              mobileNumber: dto.mobileNumber ?? null,
              status: 'ACTIVE',
              usercode,
            },
          });

          const role = await tx.role.findUnique({
            where: { name: 'ANALYST' },
          });

          if (!role) {
            throw new BadRequestException('ANALYST role does not exist. Please run the database seed.');
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
          message: 'Analyst created successfully',
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

    throw new ConflictException('Could not generate a unique analyst user code');
  }

  async getAllAnalysts() {
    return this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: { name: 'ANALYST' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        mobileNumber: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAnalystById(id: number) {
    const analyst = await this.prisma.user.findFirst({
      where: {
        id,
        roles: { some: { role: { name: 'ANALYST' } } },
      },
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        mobileNumber: true,
        status: true,
        createdAt: true,
      },
    });

    if (!analyst) {
      throw new NotFoundException('Analyst not found');
    }

    return analyst;
  }

  async updateAnalyst(id: number, dto: UpdateAnalystDto) {
    const analyst = await this.prisma.user.findFirst({
      where: { id, roles: { some: { role: { name: 'ANALYST' } } } },
    });

    if (!analyst) {
      throw new NotFoundException('Analyst not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        usercode: true,
        status: true,
        updatedAt: true,
      },
    });

    return { message: 'Analyst updated successfully', user: updated };
  }

  async updateAnalystStatus(id: number, status: string) {
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

    // Scoping for ADMIN viewing OUTREACH
    if (roleName === 'OUTREACH' && loggedUser?.roles?.includes('ADMIN') && !loggedUser?.roles?.includes('SUPER_ADMIN')) {
      const loggedUserId = loggedUser.userId || loggedUser.id;
      const adminProjects = await this.prisma.userProjectLocation.findMany({
        where: { userId: loggedUserId },
        select: { projectId: true },
      });
      const projectIds = adminProjects.map(p => p.projectId);

      whereClause.projectAssignments = {
        some: {
          projectId: { in: projectIds }
        }
      };
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

    // ADMIN can only reassign outreach workers in their assigned projects
    if (loggedUser?.roles?.includes('ADMIN') && !loggedUser?.roles?.includes('SUPER_ADMIN')) {
      const loggedUserId = loggedUser.userId || loggedUser.id;
      const adminProjects = await this.prisma.userProjectLocation.findMany({
        where: { userId: loggedUserId },
        select: { projectId: true },
      });
      const adminProjectIds = adminProjects.map(p => p.projectId);

      const outreachInAdminProject = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: outreachId,
          projectId: { in: adminProjectIds },
        },
      });

      if (!outreachInAdminProject) {
        throw new ForbiddenException('You are not authorized to reassign this outreach worker');
      }
    }
    
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

  async getAnalystDashboardReports(userId: number) {
    // 1. Get projects assigned to this analyst
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      return [];
    }

    const projectIds = [...new Set(assignments.map((a) => a.projectId))];

    // 2. Fetch all activity reports for beneficiaries in those projects
    const reports = await this.prisma.activityReport.findMany({
      where: {
        beneficiary: {
          projectId: { in: projectIds },
        },
      },
      orderBy: { date: 'desc' },
      include: {
        beneficiary: {
          include: {
            awc: {
              include: {
                state: true,
                district: true,
                block: true,
                village: true,
              },
            },
          },
        },
        activity: { select: { id: true, name: true } },
        session: { select: { id: true, name: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    });

    return reports.map((r) => ({
      reportId: r.id,
      beneficiaryId: r.beneficiary.uid,
      beneficiaryName: r.beneficiary.name,
      // Beneficiary detail fields
      dateOfBirth: r.beneficiary.dateOfBirth ?? null,
      guardianName: r.beneficiary.guardianName ?? null,
      dateOfMarriage: r.beneficiary.dateOfMarriage ?? null,
      womanAgeAtMarriage: r.beneficiary.womanAgeAtMarriage ?? null,
      husbandAgeAtMarriage: r.beneficiary.husbandAgeAtMarriage ?? null,
      maritalStatus: r.beneficiary.maritalStatus ?? null,
      gender: r.beneficiary.gender ?? null,
      // Location
      state: r.beneficiary.awc?.state?.name ?? r.beneficiary.state ?? '-',
      district: r.beneficiary.awc?.district?.name ?? r.beneficiary.district ?? '-',
      block: r.beneficiary.awc?.block?.name ?? r.beneficiary.block ?? '-',
      village: r.beneficiary.awc?.village?.name ?? r.beneficiary.village ?? '-',
      awcCenter: r.beneficiary.awc?.awcName ?? r.beneficiary.awc?.locationCode ?? '-',
      // Activity & report
      activity: r.activity.name,
      session: r.session.name,
      reportData: r.reportData,
      reportingDate: r.date,
      reportedBy: r.reportedBy.name,
    }));
  }

  async getAnalystDashboardStats(userId: number, projectId?: number, activityId?: number, sessionId?: number) {
    // 1. Get projects assigned to this analyst
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      return {
        totalBeneficiaries: 0,
        assignedProjects: 0,
        assignedLocations: 0,
        totalReports: 0,
        outreachActions: {
          activePregnantWomen: 0,
          activeLactatingMothers: 0,
          activeSamChildren: 0,
          activeMamChildren: 0,
          adolescentGirls: 0,
          infantsEbfPromotion: 0,
          infantsCfPromotion: 0,
          womenDueForDelivery30Days: 0
        },
        episodesOfCare: {
          adults: 0,
          adolescents: 0,
          childrenUnder5: 0,
          children6To10: 0
        },
        activities: []
      };
    }

    const assignedProjectIds = [...new Set(assignments.map(a => a.projectId))];
    const targetProjectIds = projectId ? [projectId] : assignedProjectIds;

    // Check if the analyst is indeed assigned to the requested project
    if (projectId && !assignedProjectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Build query conditions
    const conditions: Prisma.Sql[] = [
      Prisma.sql`b."projectId" IN (${Prisma.join(targetProjectIds)})`
    ];

    if (activityId) conditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) conditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

    const totalBeneficiaries = await this.prisma.beneficiary.count({
      where: { projectId: { in: targetProjectIds } }
    });

    const assignedProjects = await this.prisma.project.count({
      where: { id: { in: targetProjectIds } }
    });

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const statsRaw: any[] = await this.prisma.$queryRaw`
      WITH ReportData AS (
        SELECT 
          r.id,
          r."childId" AS "childId",
          r."reportData",
          COALESCE(c.gender, b.gender) AS gender,
          b."maritalStatus",
          b."typeof",
          EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
          (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
        ${whereClause}
      )
      SELECT 
        COUNT(*) AS "totalReports",

        -- Outreach Actions
        COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL) AS "activePregnantWomen",
        COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childId" IS NULL) AS "activeLactatingMothers",
        COUNT(*) FILTER (WHERE "reportData"->>'samMamStatus' = 'SAM') AS "activeSamChildren",
        COUNT(*) FILTER (WHERE "reportData"->>'samMamStatus' = 'MAM') AS "activeMamChildren",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls",
        COUNT(*) FILTER (WHERE age_months <= 6) AS "infantsEbfPromotion",
        COUNT(*) FILTER (WHERE age_months > 6 AND age_years < 2) AS "infantsCfPromotion",
        COUNT(*) FILTER (
          WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
          AND (
            CASE
              WHEN "reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'edd', 'DD/MM/YYYY')
              WHEN "reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'edd', 'DDMMYYYY')
              ELSE NULL
            END
          ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND "childId" IS NULL
        ) AS "womenDueForDelivery30Days",

        -- Episodes of Care
        COUNT(*) FILTER (WHERE age_years > 19) AS "adults",
        COUNT(*) FILTER (WHERE age_years BETWEEN 10 AND 19) AS "adolescents",
        COUNT(*) FILTER (WHERE age_years < 6) AS "childrenUnder5",
        COUNT(*) FILTER (WHERE age_years >= 6 AND age_years < 10) AS "children6To10",

        -- Activity Session Demographics
        COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL) AS "pregnantWomen",
        COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childId" IS NULL) AS "lactatingWomen",
        COUNT(*) FILTER (WHERE "reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5) AS "mam0to5",
        COUNT(*) FILTER (WHERE "reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5) AS "sam0to5",
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(gender)) = 'female' 
          AND "maritalStatus" = 'Married' 
          AND age_years BETWEEN 15 AND 24 
          AND "childId" IS NULL
          AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
        ) AS "youngMarriedWomen",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Girls",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Boys",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Girls",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Boys",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
        COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19) AS "adolescentBoys",
        COUNT(*) FILTER (WHERE LOWER(TRIM("typeof")) = 'stakeholder') AS "stakeholders",
        COUNT(*) FILTER (WHERE age_years < 1) AS "infantsLessThan1",
        COUNT(*) FILTER (WHERE age_years >= 1 AND age_years < 3) AS "toddlers1To3",
        
        -- Catch all
        COUNT(*) FILTER (
          WHERE NOT (("reportData"->>'pregnancyStatus' IN ('Currently Pregnant', 'Baby Delivered') AND "childId" IS NULL)
          OR ("reportData"->>'samMamStatus' IN ('MAM', 'SAM') AND age_years <= 5)
          OR (
            LOWER(TRIM(gender)) = 'female' 
            AND "maritalStatus" = 'Married' 
            AND age_years BETWEEN 15 AND 24 
            AND "childIntId" IS NULL 
            AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          )
          OR (age_years < 3)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19)
          OR LOWER(TRIM("typeof")) = 'stakeholder')
        ) AS "otherBeneficiaries"
      FROM ReportData;
    `;

    const row = statsRaw[0] || {};
    const toNumber = (val: any) => val ? Number(val) : 0;

    return {
      totalBeneficiaries,
      assignedProjects,
      assignedLocations: 0,
      totalReports: toNumber(row.totalReports),
      outreachActions: {
        activePregnantWomen: toNumber(row.activePregnantWomen),
        activeLactatingMothers: toNumber(row.activeLactatingMothers),
        activeSamChildren: toNumber(row.activeSamChildren),
        activeMamChildren: toNumber(row.activeMamChildren),
        adolescentGirls: toNumber(row.adolescentGirls),
        infantsEbfPromotion: toNumber(row.infantsEbfPromotion),
        infantsCfPromotion: toNumber(row.infantsCfPromotion),
        womenDueForDelivery30Days: toNumber(row.womenDueForDelivery30Days)
      },
      episodesOfCare: {
        adults: toNumber(row.adults),
        adolescents: toNumber(row.adolescents),
        childrenUnder5: toNumber(row.childrenUnder5),
        children6To10: toNumber(row.children6To10)
      },
      activities: [
        { label: 'YOUNG MARRIED WOMEN', count: toNumber(row.youngMarriedWomen), countColor: 'text-gray-900' },
        { label: 'PREGNANT WOMEN', count: toNumber(row.pregnantWomen), countColor: 'text-gray-900' },
        { label: 'MAM (0-5)', count: toNumber(row.mam0to5), countColor: 'text-green-600' },
        { label: 'CHILDREN BELOW 6 (3-6 YEARS) - GIRLS', count: toNumber(row.childrenBelow6Girls), countColor: 'text-gray-900' },
        { label: 'CHILDREN BELOW 6 (3-6 YEARS) - BOYS', count: toNumber(row.childrenBelow6Boys), countColor: 'text-gray-900' },
        { label: 'LACTATING WOMEN', count: toNumber(row.lactatingWomen), countColor: 'text-gray-900' },
        { label: 'ADOLESCENT GIRLS', count: toNumber(row.adolescentGirls2), countColor: 'text-gray-900' },
        { label: 'CHILDREN ABOVE 6 (6-9 YEARS) - GIRLS', count: toNumber(row.childrenAbove6Girls), countColor: 'text-red-600' },
        { label: 'STAKEHOLDERS', count: toNumber(row.stakeholders), countColor: 'text-gray-900' },
        { label: 'ADOLESCENT BOYS', count: toNumber(row.adolescentBoys), countColor: 'text-gray-900' },
        { label: 'SAM (0-5)', count: toNumber(row.sam0to5), countColor: 'text-red-600' },
        { label: 'CHILDREN ABOVE 6 (6-9 YEARS) - BOYS', count: toNumber(row.childrenAbove6Boys), countColor: 'text-green-600' },
        { label: 'INFANT', count: toNumber(row.infantsLessThan1), countColor: 'text-gray-900' },
        { label: 'TODDLER', count: toNumber(row.toddlers1To3), countColor: 'text-gray-900' },
        { label: 'OTHER BENEFICIARIES', count: toNumber(row.otherBeneficiaries), countColor: 'text-gray-900' },
      ]
    };
  }

  async getAnalystActionDetails(userId: number, groupName: string, activityId?: number, sessionId?: number) {
    // 1. Get projects assigned to this analyst
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      return [];
    }

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    const rbacConditions: Prisma.Sql[] = [
      Prisma.sql`b."projectId" IN (${Prisma.join(projectIds)})`
    ];

    if (activityId) rbacConditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) rbacConditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

    // Map group name to SQL condition
    let groupCondition: Prisma.Sql;
    const gName = (groupName || '').trim().toUpperCase();

    switch (gName) {
      case 'CURRENTLY ACTIVE PREGNANT WOMEN':
      case 'PREGNANT WOMEN':
        groupCondition = Prisma.sql`"reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE LACTATING MOTHERS':
      case 'LACTATING WOMEN':
        groupCondition = Prisma.sql`"reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE SAM CHILDREN':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'SAM'`;
        break;
      case 'SAM (0-5)':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5`;
        break;
      case 'CURRENTLY ACTIVE MAM CHILDREN':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'MAM'`;
        break;
      case 'MAM (0-5)':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5`;
        break;
      case 'ADOLESCENT GIRLS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19`;
        break;
      case 'INFANTS FOR EBF PROMOTION (<= 6M)':
        groupCondition = Prisma.sql`age_months <= 6`;
        break;
      case 'INFANTS FOR CF PROMOTION(2YEAR<CHILD AGE<6MONTHS)':
        groupCondition = Prisma.sql`age_months > 6 AND age_years < 2`;
        break;
      case 'WOMEN DUE FOR DELIVERY IN NEXT 30 DAYS':
        groupCondition = Prisma.sql`
          "reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
          AND (
            CASE
              WHEN "reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'edd', 'DD/MM/YYYY')
              WHEN "reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'edd', 'DDMMYYYY')
              ELSE NULL
            END
          ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' 
          AND "childIntId" IS NULL
        `;
        break;
      case 'YOUNG MARRIED WOMEN':
        groupCondition = Prisma.sql`
          LOWER(TRIM(gender)) = 'female' 
          AND "maritalStatus" = 'Married' 
          AND age_years BETWEEN 15 AND 24 
          AND "childIntId" IS NULL
          AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
        `;
        break;
      case 'INFANT':
        groupCondition = Prisma.sql`age_years < 1`;
        break;
      case 'TODDLER':
        groupCondition = Prisma.sql`age_years >= 1 AND age_years < 3`;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - GIRLS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6`;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - BOYS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6`;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - GIRLS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10`;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - BOYS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10`;
        break;
      case 'ADOLESCENT BOYS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19`;
        break;
      case 'STAKEHOLDERS':
        groupCondition = Prisma.sql`LOWER(TRIM("typeof")) = 'stakeholder'`;
        break;
      case 'OTHER BENEFICIARIES':
        groupCondition = Prisma.sql`
          NOT (("reportData"->>'pregnancyStatus' IN ('Currently Pregnant', 'Baby Delivered') AND "childIntId" IS NULL)
          OR ("reportData"->>'samMamStatus' IN ('MAM', 'SAM') AND age_years <= 5)
          OR (
            LOWER(TRIM(gender)) = 'female' 
            AND "maritalStatus" = 'Married' 
            AND age_years BETWEEN 15 AND 24 
            AND "childIntId" IS NULL 
            AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          )
          OR (age_years < 3)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10)
          OR (LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19)
          OR (LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19)
          OR LOWER(TRIM("typeof")) = 'stakeholder')
        `;
        break;
      default:
        groupCondition = Prisma.sql`1 = 1`;
        break;
    }

    const rbacWhereClause = Prisma.sql`WHERE ${Prisma.join(rbacConditions, ' AND ')}`;

    const rawRecords: any[] = await this.prisma.$queryRaw`
      WITH ReportData AS (
        SELECT 
          r.id AS "reportId",
          r."beneficiaryId" AS "benIntId",
          r."childId" AS "childIntId",
          r.date AS "reportingDate",
          COALESCE(c.uid, b.uid) AS "beneficiaryId",
          COALESCE(c.name, b.name) AS "beneficiaryName",
          b."typeof",
          a."awcName" AS awc,
          act.name AS activity,
          sess.name AS session,
          r."reportData",
          COALESCE(c.gender, b.gender) AS gender,
          b."maritalStatus",
          EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
          (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months,
          CASE 
            WHEN r."childId" IS NOT NULL THEN (
              SELECT STRING_AGG(bg.name, ', ')
              FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id
            )
            ELSE (
              SELECT STRING_AGG(bg.name, ', ')
              FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id
            )
          END AS "actualGroups"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Activity" act ON r."activityId" = act.id
        LEFT JOIN "Session" sess ON r."sessionId" = sess.id
        ${rbacWhereClause}
      )
      SELECT 
        "reportId",
        "beneficiaryId" AS id,
        "beneficiaryName" AS name,
        COALESCE("actualGroups", 'N/A') AS group,
        COALESCE(awc, 'N/A') AS awc,
        COALESCE(activity, 'N/A') AS activity,
        COALESCE(session, 'N/A') AS session,
        "reportingDate",
        age_years,
        age_months
      FROM ReportData
      WHERE ${groupCondition}
      ORDER BY "reportingDate" DESC
      LIMIT 100;
    `;

    return rawRecords.map(record => {
      let ageStr = 'N/A';
      if (record.age_years !== null && record.age_years !== undefined) {
        const yrs = Number(record.age_years);
        const mos = Number(record.age_months);
        if (yrs === 0) {
          ageStr = `${mos} M`;
        } else {
          ageStr = `${yrs} Y`;
        }
      }
      return {
        id: record.id,
        name: record.name,
        group: record.group,
        awc: record.awc,
        activity: record.activity,
        session: record.session,
        reportingDate: record.reportingDate ? new Date(record.reportingDate).toLocaleDateString() : 'N/A',
        age: ageStr,
      };
    });
  }

  async getAnalystActivities() {
    return this.prisma.activity.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  async getAnalystSessions(activityId: number) {
    return this.prisma.session.findMany({
      where: { activityId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }
}
