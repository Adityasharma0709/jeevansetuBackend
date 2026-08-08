// src/admin/admin.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { TagGroupActivityDto } from './dto/tag-group-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import * as bcrypt from 'bcrypt';
import { OutreachService } from '../outreach/outreach.service';

const OUTREACH_CODE_PREFIX = 'OW';
const OUTREACH_CODE_MIN_DIGITS = 2;
const OUTREACH_CODE_MAX_RETRIES = 5;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private outreachService: OutreachService,
  ) { }

  private async generateNextOutreachUserCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const likePrefix = `${OUTREACH_CODE_PREFIX}%`;

    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(
        CAST(NULLIF(regexp_replace("usercode", '\\D', '', 'g'), '') AS INTEGER)
      ) AS max
      FROM "User"
      WHERE upper("usercode") LIKE ${likePrefix}
    `;

    const nextNumber = (rows[0]?.max ?? 0) + 1;
    const digits = String(nextNumber).padStart(OUTREACH_CODE_MIN_DIGITS, '0');
    return `${OUTREACH_CODE_PREFIX}${digits}`;
  }

  private async ensureProjectIsActive(projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true },
    });

    if (!project) throw new NotFoundException('Project not found');
    if (project.status?.toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException('Project is deactivated');
    }

    return project;
  }

  private async ensureActivityIsActive(activityId: number) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        status: true,
        projectId: true,
        project: { select: { status: true } },
      },
    });

    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status?.toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException('Activity is deactivated');
    }
    if (activity.projectId && activity.project?.status?.toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException('Project is deactivated');
    }

    return activity;
  }

  private async ensureAdminOwnsRequest(adminId: number, requestId: number) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.targetAdminId !== adminId) {
      throw new ForbiddenException('You are not allowed to access this request');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request already processed');
    }

    return request;
  }

  async adminDashboard(user: any) {
    const adminId = user.userId;
    const isSuperAdmin = user.roles?.includes('SUPER_ADMIN');

    const where = isSuperAdmin ? {} : { createdById: adminId };

    const groups = await this.prisma.beneficiaryGroup.count({ where });
    const activities = await this.prisma.activity.count({ where });
    const sessions = await this.prisma.session.count({ where });

    const reportStats = await this.prisma.activityReport.groupBy({
      by: ['activityId'],
      where: isSuperAdmin ? {} : {
        activity: { createdById: adminId }
      },
      _count: true
    });

    return {
      totalGroups: groups,
      totalActivities: activities,
      totalSessions: sessions,
      reportStats
    };
  }


  //group
  async getAllGroups(user: any) {
    const where = user.roles?.includes('SUPER_ADMIN') ? {} : { createdById: user.userId };
    return this.prisma.beneficiaryGroup.findMany({
      where,
      include: {
        activities: {
          include: {
            activity: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  //activities
  async createActivity(dto: CreateActivityDto, user: any) {
    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    if (typeof dto.projectId === 'number') {
      await this.ensureProjectIsActive(dto.projectId);
    }

    // check duplicate
    const exists = await this.prisma.activity.findFirst({
      where: { name: dto.name },
    });

    if (exists) {
      throw new ConflictException('Activity already exists');
    }

    return this.prisma.activity.create({
      data: {
        name: dto.name,
        description: dto.description,
        projectId: dto.projectId || null,
        createdById: user.userId, // from JWT
      },
    });
  }

  async updateActivity(id: number, dto: UpdateActivityDto) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.projectId) {
      await this.ensureProjectIsActive(activity.projectId);
    }

    if (typeof dto.projectId === 'number') {
      await this.ensureProjectIsActive(dto.projectId);
    }

    // prevent duplicate activity name
    if (dto.name) {
      const exists = await this.prisma.activity.findFirst({
        where: {
          name: dto.name,
          NOT: { id },
        },
      });

      if (exists) {
        throw new ConflictException('Activity name already exists');
      }
    }

    return this.prisma.activity.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateActivity(id: number) {

    const activity = await this.prisma.activity.findUnique({
      where: { id }
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.status === 'INACTIVE') {
      throw new BadRequestException('Activity already inactive');
    }

    return this.prisma.activity.update({
      where: { id },
      data: { status: 'INACTIVE' }
    });
  }

  async activateActivity(id: number) {

    const activity = await this.prisma.activity.findUnique({
      where: { id }
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.status === 'ACTIVE') {
      throw new BadRequestException('Activity already active');
    }

    if (activity.projectId) {
      await this.ensureProjectIsActive(activity.projectId);
    }

    return this.prisma.activity.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });
  }
  async getActiveActivities(user: any) {
    const isSuperAdmin = user.roles?.includes('SUPER_ADMIN');
    const isOutreach = user.roles?.includes('OUTREACH');
    
    // Outreach and Super Admin see all active activities
    const filterByCreator = !isSuperAdmin && !isOutreach;

    return this.prisma.activity.findMany({
      where: {
        ...(filterByCreator ? { createdById: user.userId } : {}),
        status: 'ACTIVE',
        OR: [
          { projectId: null },
          { project: { status: { equals: 'ACTIVE', mode: 'insensitive' } } },
        ],
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            projectCode: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAllActivities(user: any) {
    const where: any = {
      OR: [
        { projectId: null },
        { project: { status: { equals: 'ACTIVE', mode: 'insensitive' } } },
      ],
    };

    if (!user.roles?.includes('SUPER_ADMIN')) {
      where.createdById = user.userId;
    }

    return this.prisma.activity.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            projectCode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }


  async tagGroupWithActivity(dto: TagGroupActivityDto, user: any) {
    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    // check group exists
    const group = await this.prisma.beneficiaryGroup.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.status?.toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException('Group is deactivated');
    }

    await this.ensureActivityIsActive(dto.activityId);

    // check duplicate mapping
    const exists = await this.prisma.groupActivity.findFirst({
      where: {
        groupId: dto.groupId,
        activityId: dto.activityId,
      },
    });

    if (exists) {
      throw new ConflictException('Already tagged');
    }

    return this.prisma.groupActivity.create({
      data: {
        groupId: dto.groupId,
        activityId: dto.activityId,
      },
    });
  }

  //session
  async createSession(dto: CreateSessionDto, user: any) {

    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    await this.ensureActivityIsActive(dto.activityId);

    // Prevent duplicate session
    const exists = await this.prisma.session.findFirst({
      where: {
        name: dto.name,
        activityId: dto.activityId
      }
    });

    if (exists) {
      throw new ConflictException('Session already exists');
    }

    return this.prisma.session.create({
      data: {
        name: dto.name,
        activityId: dto.activityId,
        createdById: user.userId   // ðŸ‘ˆ from JWT
      }
    });
  }

  async updateSession(id: number, dto: UpdateSessionDto) {

    const session = await this.prisma.session.findUnique({
      where: { id }
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const nextActivityId =
      typeof dto.activityId === 'number' ? dto.activityId : session.activityId;
    await this.ensureActivityIsActive(nextActivityId);

    return this.prisma.session.update({
      where: { id },
      data: {
        ...dto
      }
    });
  }

  async deactivateSession(id: number) {

    const session = await this.prisma.session.findUnique({
      where: { id }
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return this.prisma.session.update({
      where: { id },
      data: { status: 'INACTIVE' }
    });
  }

  async activateSession(id: number) {

    const session = await this.prisma.session.findUnique({
      where: { id }
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status === 'ACTIVE') {
      throw new BadRequestException('Session already active');
    }

    await this.ensureActivityIsActive(session.activityId);

    return this.prisma.session.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });
  }

  async getSessionsByActivity(activityId: number, user: any) {
    await this.ensureActivityIsActive(activityId);
    
    const isSuperAdmin = user.roles?.includes('SUPER_ADMIN');
    const isOutreach = user.roles?.includes('OUTREACH');
    const filterByCreator = !isSuperAdmin && !isOutreach;

    return this.prisma.session.findMany({
      where: {
        activityId,
        ...(filterByCreator ? { createdById: user.userId } : {}),
        status: 'ACTIVE'
      },
      include: {
        activity: {
          select: { name: true }
        },
        creator: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAllSessions(user: any) {
    const where = user.roles?.includes('SUPER_ADMIN') ? {} : { createdById: user.userId };
    return this.prisma.session.findMany({
      where,
      include: {
        activity: {
          select: { name: true }
        },
        creator: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getManagerBeneficiaryRequests(adminId: number) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        targetAdminId: adminId,
        requestType: {
          in: [
            'UPDATE_BENEFICIARY',
            'MODIFY_BENEFICIARY',
            'CREATE_WORKER',
            'MODIFY_WORKER',
            'DEACTIVATE_WORKER',
            'ACTIVATE_WORKER',
          ],
        },
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const benIds = [...new Set(requests.map(r => (r.payload as any)?.beneficiaryId).filter(Boolean))] as number[];

    if (benIds.length === 0) return requests;

    const beneficiaries = await this.prisma.beneficiary.findMany({
      where: { id: { in: benIds } },
      select: { id: true, uid: true, name: true, mobileNumber: true }
    });

    const benMap = Object.fromEntries(beneficiaries.map(b => [b.id, b]));

    return requests.map(r => ({
      ...r,
      beneficiary: benMap[(r.payload as any)?.beneficiaryId] || null
    }));
  }

  async approveManagerBeneficiaryRequest(requestId: number, adminId: number) {
    const request = await this.ensureAdminOwnsRequest(adminId, requestId);
    const payload = (request.payload ?? {}) as any;
    const requestType = String(request.requestType || '').toUpperCase();

    if (['UPDATE_BENEFICIARY', 'MODIFY_BENEFICIARY'].includes(requestType)) {
      const beneficiaryId = payload.beneficiaryId;
      const changes = payload.changes ?? payload;

      if (!beneficiaryId || typeof changes !== 'object') {
        throw new BadRequestException('Invalid request payload');
      }

      await this.prisma.beneficiary.update({
        where: { id: Number(beneficiaryId) },
        data: changes,
      });
      await this.outreachService.recalculateGroupsForBeneficiary(Number(beneficiaryId));
    }

    if (requestType === 'CREATE_WORKER') {
      const { name, email, password, mobile, mobileNumber, projectId, locationId } = payload || {};
      if (!name || !email || !password) {
        throw new BadRequestException('Invalid CREATE_WORKER payload');
      }

      const exists = await this.prisma.user.findUnique({ where: { email } });
      if (exists) throw new ConflictException('Email already exists');

      const normalizedMobile = mobileNumber ?? mobile;

      const hash = await bcrypt.hash(String(password), 10);

      const role = await this.prisma.role.findUnique({ where: { name: 'OUTREACH' } });
      if (!role) throw new NotFoundException('OUTREACH role not found');

      const numericProjectId = Number(projectId);
      const isValidProjectId = Number.isFinite(numericProjectId) && numericProjectId > 0;

      let stateId: number | null = null;
      if (isValidProjectId) {
        const managerAssignment = await this.prisma.userProjectLocation.findFirst({
          where: { userId: request.requestedById, projectId: numericProjectId }
        });
        stateId = managerAssignment?.stateId ?? null;
      }

      for (let attempt = 0; attempt < OUTREACH_CODE_MAX_RETRIES; attempt++) {
        try {
          const worker = await this.prisma.$transaction(async (tx) => {
            const usercode = await this.generateNextOutreachUserCode(tx);

            const created = await tx.user.create({
              data: {
                name: String(name),
                email: String(email),
                ...(normalizedMobile ? { mobileNumber: String(normalizedMobile) } : {}),
                usercode,
                password: hash,
                status: 'ACTIVE',
                createdByAdminId: request.requestedById,
              },
            });

            await tx.userRole.create({
              data: {
                userId: created.id,
                roleId: role.id,
              },
            });

            if (numericProjectId) {
              await tx.userProjectLocation.create({
                data: {
                  userId: created.id,
                  projectId: numericProjectId,
                  stateId: stateId
                },
              });
            }

            return created;
          });

          const { password, ...safeWorker } = worker;
          payload.usercode = safeWorker.usercode;
          payload.workerId = safeWorker.id;
          break;
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

      if (!payload.usercode) {
        throw new ConflictException('Could not generate a unique outreach user code');
      }
    }

    if (requestType === 'MODIFY_WORKER') {
      const { workerId, name, email, mobile, mobileNumber, usercode } = payload || {};
      if (!workerId) throw new BadRequestException('Invalid MODIFY_WORKER payload');

      const updates: any = {};
      if (name) updates.name = String(name);
      if (email) updates.email = String(email);
      if (usercode) updates.usercode = String(usercode);
      const normalizedMobile = mobileNumber ?? mobile;
      if (normalizedMobile) updates.mobileNumber = String(normalizedMobile);

      if (updates.email) {
        const existing = await this.prisma.user.findFirst({
          where: {
            email: updates.email,
            NOT: { id: Number(workerId) },
          },
        });
        if (existing) throw new ConflictException('Email already exists');
      }

      if (Object.keys(updates).length > 0) {
        await this.prisma.user.update({
          where: { id: Number(workerId) },
          data: updates,
        });
      }
    }

    if (requestType === 'DEACTIVATE_WORKER') {
      const { workerId } = payload || {};
      if (!workerId) throw new BadRequestException('Invalid DEACTIVATE_WORKER payload');
      await this.prisma.user.update({
        where: { id: Number(workerId) },
        data: { status: 'INACTIVE' },
      });
    }

    if (requestType === 'ACTIVATE_WORKER') {
      const { workerId } = payload || {};
      if (!workerId) throw new BadRequestException('Invalid ACTIVATE_WORKER payload');
      await this.prisma.user.update({
        where: { id: Number(workerId) },
        data: { status: 'ACTIVE' },
      });
    }

    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        approvedById: adminId,
        approvedAt: new Date(),
      },
    });
  }

  async rejectManagerBeneficiaryRequest(
    requestId: number,
    adminId: number,
    reason?: string,
  ) {
    await this.ensureAdminOwnsRequest(adminId, requestId);
    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        remarks: reason || null,
        approvedById: adminId,
        approvedAt: new Date(),
      },
    });
  }

  async getStates() {
    return this.prisma.state.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getBeneficiary(id: number) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id },
      include: {
        awc: {
          include: {
            state: true,
            district: true,
            block: true,
            village: true,
          },
        },
        children: true,
      },
    });
    if (!beneficiary) {
      throw new NotFoundException('Beneficiary not found');
    }
    return beneficiary;
  }

  async getFamilyMembers(beneficiaryId: number) {
    await this.getBeneficiary(beneficiaryId);
    return this.prisma.beneficiaryChild.findMany({
      where: { beneficiaryId },
      orderBy: { id: 'asc' },
    });
  }

  async getReportsByBeneficiary(beneficiaryId: number) {
    await this.getBeneficiary(beneficiaryId);
    return this.prisma.activityReport.findMany({
      where: { beneficiaryId },
      include: {
        activity: true,
        session: true,
        child: true,
        reportedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }
}


