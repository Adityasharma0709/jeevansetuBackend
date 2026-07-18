import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';

const OUTREACH_CODE_PREFIX = 'OW';
const OUTREACH_CODE_MIN_DIGITS = 2;
const OUTREACH_CODE_MAX_RETRIES = 5;

@Injectable()
export class ManagerService {
  constructor(private prisma: PrismaService) {}

  private async generateNextOutreachUserCode(tx: Prisma.TransactionClient): Promise<string> {
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

  private buildBeneficiaryUpdateData(raw: Record<string, any>) {
    const data: Record<string, any> = {};
    const changes = raw || {};

    const assignNumber = (key: string) => {
      const value = changes[key];
      if (value === undefined || value === null || value === '') return;
      const num = Number(value);
      if (Number.isNaN(num)) throw new BadRequestException(`Invalid number for ${key}`);
      data[key] = num;
    };

    const assignString = (key: string) => {
      const value = changes[key];
      if (value === undefined || value === null || value === '') return;
      data[key] = String(value);
    };

    const assignDate = (key: string) => {
      const value = changes[key];
      if (value === undefined || value === null || value === '') return;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid date for ${key}`);
      data[key] = date;
    };

    // Safely assign all valid properties
    ['projectId', 'awcId', 'womanAgeAtMarriage', 'husbandAgeAtMarriage', 'monthlyIncome'].forEach(assignNumber);
    ['typeof', 'mobileNumber', 'name', 'gender', 'guardianName', 'maritalStatus', 'dateOfMarriage', 'qualification', 'religion', 'caste', 'economicStatus', 'primaryIncomeSource', 'employmentStatus', 'state', 'district', 'block', 'village'].forEach(assignString);
    assignDate('dateOfBirth');

    return data;
  }

  private async getCreatorAdminIdForManager(managerId: number) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, createdByAdminId: true },
    });

    if (!manager) throw new NotFoundException('Manager not found');
    if (!manager.createdByAdminId) throw new BadRequestException('No creator admin mapped for this manager. Please recreate manager with admin ownership mapping.');

    return manager.createdByAdminId;
  }

  async managerDashboard(managerId: number) {
    const workers = await this.prisma.user.count({
      where: {
        createdByAdminId: managerId,
        roles: { some: { role: { name: 'OUTREACH' } } }
      }
    });

    const pendingRequests = await this.prisma.approvalRequest.count({
      where: { status: 'PENDING', targetAdminId: managerId }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reportsToday = await this.prisma.activityReport.count({
      where: {
        createdAt: { gte: today },
        reportedBy: { createdByAdminId: managerId }
      }
    });

    const assignedLocations = await this.prisma.userProjectLocation.count({
      where: { userId: managerId }
    });

    return { totalWorkers: workers, pendingRequests, reportsToday, assignedLocations };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const data: Record<string, any> = { ...dto };
    if (data.mobile !== undefined && data.mobileNumber === undefined) {
      data.mobileNumber = data.mobile;
    }
    delete data.mobile;

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async createWorker(dto: CreateWorkerDto, managerId: number) {
    const numericProjectId = dto.projectId ? Number(dto.projectId) : null;
    const isValidProjectId = numericProjectId !== null && Number.isFinite(numericProjectId) && numericProjectId > 0;

    let managerAssignment: { stateId: number | null } | null = null;

    if (isValidProjectId) {
      managerAssignment = await this.prisma.userProjectLocation.findFirst({
        where: { userId: managerId, projectId: numericProjectId! }
      });

      if (!managerAssignment) {
        throw new ForbiddenException('You are not assigned to this project');
      }
    }

    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already exists');

    const hash = await bcrypt.hash(dto.password, 10);
    const role = await this.prisma.role.findUnique({ where: { name: 'OUTREACH' } });
    if (!role) throw new ConflictException('OUTREACH role not found');

    for (let attempt = 0; attempt < OUTREACH_CODE_MAX_RETRIES; attempt++) {
      try {
        const worker = await this.prisma.$transaction(async (tx) => {
          const usercode = await this.generateNextOutreachUserCode(tx);

          const user = await tx.user.create({
            data: {
              name: dto.name,
              email: dto.email,
              mobileNumber: dto.mobileNumber ?? dto.mobile,
              usercode,
              password: hash,
              status: 'ACTIVE',
              createdByAdminId: managerId,
            }
          });

          await tx.userRole.create({
            data: { userId: user.id, roleId: role.id }
          });

          // Only assign to project/location if projectId was provided
          if (isValidProjectId && numericProjectId) {
            await tx.userProjectLocation.create({
              data: {
                userId: user.id,
                projectId: numericProjectId,
                stateId: managerAssignment?.stateId ?? null
              }
            });
          }

          return user;
        });

        const { password, ...safe } = worker;
        return { message: 'Outreach user created successfully', user: safe };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = error.meta?.target;
          const targets = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
          if (targets.some((t) => t.includes('email'))) throw new ConflictException('Email already exists');
          if (targets.some((t) => t.includes('usercode'))) continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not generate a unique outreach user code');
  }

  async updateWorker(id: number, dto: UpdateWorkerDto, managerId: number) {
    if (dto.projectId && dto.locationId) {
      const assigned = await this.prisma.userProjectLocation.findFirst({
        where: { userId: managerId, projectId: dto.projectId }
      });
      if (!assigned) throw new ForbiddenException('Not assigned area');
    }
    return this.prisma.user.update({ where: { id }, data: dto });
  }

  async activateWorker(workerId: number, managerId: number) {
    const worker = await this.prisma.user.findUnique({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Worker not found');

    const outreach = await this.prisma.userRole.findFirst({
      where: { userId: workerId, role: { name: 'OUTREACH' } }
    });
    if (!outreach) throw new ForbiddenException('User is not an Outreach Worker');

    const updated = await this.prisma.user.update({
      where: { id: workerId },
      data: { status: 'ACTIVE' }
    });

    const { password, ...safe } = updated;
    return { message: 'Outreach worker activated successfully', user: safe };
  }

  async deactivateWorker(workerId: number, managerId: number) {
    const worker = await this.prisma.user.findUnique({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('Worker not found');

    const outreach = await this.prisma.userRole.findFirst({
      where: { userId: workerId, role: { name: 'OUTREACH' } }
    });
    if (!outreach) throw new ForbiddenException('User is not an Outreach Worker');

    const updated = await this.prisma.user.update({
      where: { id: workerId },
      data: { status: 'INACTIVE' }
    });

    const { password, ...safe } = updated;
    return { message: 'Outreach worker deactivated successfully', user: safe };
  }

  async getAll(managerId: number) {
    return this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', targetAdminId: managerId },
      include: { requestedBy: true }
    });
  }

  async approve(id: number, managerId: number) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException();

    if (req.requestType === 'UPDATE_PROFILE') {
      await this.prisma.user.update({
        where: { id: req.requestedById },
        data: req.payload as any
      });
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: managerId, approvedAt: new Date() }
    });
  }

  async reject(id: number, dto: any, managerId: number) {
    return this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'REJECTED', remarks: dto.reason, approvedById: managerId }
    });
  }

  async getBeneficiaryRequests(managerId: number) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: { 
        requestType: 'UPDATE_BENEFICIARY', 
        status: 'PENDING',
        targetAdminId: managerId 
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, status: true, createdAt: true } }
      }
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

  async submitBeneficiaryUpdateRequest(beneficiaryId: number, changes: UpdateBeneficiaryDto, managerId: number) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId }
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    const targetAdminId = await this.getCreatorAdminIdForManager(managerId);

    const diff: Record<string, any> = {};
    const incoming = (changes as any) || {};

    // Compare applicable fields
    const fields = [
      'typeof', 'name', 'mobileNumber', 'gender', 'guardianName', 'dateOfBirth',
      'maritalStatus', 'dateOfMarriage', 'womanAgeAtMarriage', 'husbandAgeAtMarriage',
      'qualification', 'religion', 'caste', 'monthlyIncome', 'economicStatus',
      'primaryIncomeSource', 'employmentStatus', 'state', 'district', 'block', 'village'
    ];

    for (const field of fields) {
      if (incoming[field] !== undefined && incoming[field] !== null) {
        let currentVal = beneficiary[field];
        let incomingVal = incoming[field];

        // Normalize dates for comparison
        if (field === 'dateOfBirth' || field === 'dateOfMarriage') {
          if (currentVal) currentVal = new Date(currentVal).toISOString().split('T')[0];
          if (incomingVal) incomingVal = new Date(incomingVal).toISOString().split('T')[0];
        }

        if (String(incomingVal) !== String(currentVal ?? '')) {
          diff[field] = incoming[field];
        }
      }
    }

    if (Object.keys(diff).length === 0) {
      throw new BadRequestException('No changes detected in update request');
    }

    return this.prisma.approvalRequest.create({
      data: {
        requestType: 'MODIFY_BENEFICIARY',
        payload: { beneficiaryId, changes: diff },
        requestedById: managerId,
        targetAdminId,
        status: 'PENDING',
      },
    });
  }

  async approveRequest(id: number, managerId: number) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException();

    if (['UPDATE_BENEFICIARY', 'MODIFY_BENEFICIARY'].includes(req.requestType)) {
      const { beneficiaryId, changes } = req.payload as { beneficiaryId: number; changes: any };
      const data = this.buildBeneficiaryUpdateData(changes || {});

      if (Object.keys(data).length > 0) {
        await this.prisma.beneficiary.update({
          where: { id: beneficiaryId },
          data
        });
      }
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: managerId, approvedAt: new Date() }
    });
  }

  async rejectRequest(requestId: number, dto: { reason: string }, managerId: number) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request already processed');

    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', remarks: dto.reason, approvedById: managerId, approvedAt: new Date() }
    });
  }

  async getOutreachWorkers(managerId: number) {
    return this.prisma.user.findMany({
      where: {
        createdByAdminId: managerId,
        roles: { some: { role: { name: 'OUTREACH' } } }
      },
      select: {
        id: true, name: true, email: true, mobileNumber: true, usercode: true, status: true,
        projectAssignments: {
          select: {
            projectId: true, stateId: true,
            project: { select: { id: true, name: true } },
            state: { select: { id: true, name: true, locationCode: true } },
          }
        }
      },
      orderBy: { id: 'desc' }
    });
  }

  async getAssignedLocations(managerId: number, projectId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: managerId, projectId },
      select: { state: { select: { id: true, name: true, locationCode: true } } },
    });

    const seen = new Set<number>();
    return (assignments || [])
      .map(a => a.state)
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
  }

  async tagWorkerProjectLocation(managerId: number, workerId: number, projectId: number, stateId: number) {
    const managerAssigned = await this.prisma.userProjectLocation.findFirst({
      where: { userId: managerId, projectId, stateId },
      select: { id: true },
    });
    if (!managerAssigned) throw new ForbiddenException('You are not assigned to this project/location');

    const worker = await this.prisma.user.findFirst({
      where: {
        id: workerId,
        createdByAdminId: managerId,
        roles: { some: { role: { name: 'OUTREACH' } } }
      },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    const already = await this.prisma.userProjectLocation.findFirst({
      where: { userId: workerId, projectId, stateId },
      select: { id: true },
    });
    if (already) return { message: 'Already tagged' };

    await this.prisma.userProjectLocation.create({
      data: { userId: workerId, projectId, stateId }
    });

    return { message: 'Tagged successfully' };
  }

  async getProfileRequests(managerId: number) {
    return this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING', targetAdminId: managerId,
        requestType: { in: ['UPDATE_PROFILE', 'MODIFY_PROFILE'] },
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } }
      }
    });
  }

  // Refactored to fetch beneficiaries natively mapped to the assigned Projects & Locations.
  async getBeneficiaries(managerId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: managerId },
      select: { projectId: true, stateId: true }
    });

    if (assignments.length === 0) return [];

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    return this.prisma.beneficiary.findMany({
      where: { projectId: { in: projectIds } },
      include: {
        project: true,
        awc: true,
        createdBy: { select: { name: true, email: true, mobileNumber: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateRequestStatus(id: number, status: 'APPROVED' | 'REJECTED', managerId: number) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Request not found');

    if (status === 'APPROVED' && ['UPDATE_PROFILE', 'MODIFY_PROFILE'].includes(String(req.requestType))) {
      const payload = (req.payload as any) || {};
      const profileUpdates: any = {};
      if (payload.name) profileUpdates.name = payload.name;
      if (payload.email) profileUpdates.email = payload.email;
      if (payload.mobile) profileUpdates.mobileNumber = String(payload.mobile);

      if (Object.keys(profileUpdates).length > 0) {
        await this.prisma.user.update({
          where: { id: req.requestedById },
          data: profileUpdates,
        });
      }
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: { status, approvedById: managerId, approvedAt: new Date() }
    });
  }

  async submitAccountRequest(type: string, data: any, managerId: number) {
    const targetAdminId = await this.getCreatorAdminIdForManager(managerId);
    let payload = data;

    // Diffing for updates
    if (type === 'MODIFY' && data.workerId) {
      const worker = await this.prisma.user.findUnique({
        where: { id: Number(data.workerId) },
        select: { id: true, name: true, email: true, mobileNumber: true }
      });
      if (worker) {
        const diff: Record<string, any> = { workerId: worker.id };
        const incoming = data.changes || data || {};
        
        if (incoming.name && incoming.name !== worker.name) diff.name = incoming.name;
        if (incoming.email && incoming.email !== worker.email) diff.email = incoming.email;
        const mobile = incoming.mobileNumber || incoming.mobile;
        if (mobile && mobile !== worker.mobileNumber) diff.mobileNumber = mobile;
        
        payload = diff;
      }
    } else if (type === 'UPDATE_PROFILE' || type === 'PROFILE_UPDATE') {
      const manager = await this.prisma.user.findUnique({
        where: { id: managerId },
        select: { id: true, name: true, email: true, mobileNumber: true }
      });
      if (manager) {
        const diff: Record<string, any> = {};
        const incoming = data || {};

        if (incoming.name && incoming.name !== manager.name) diff.name = incoming.name;
        if (incoming.email && incoming.email !== manager.email) diff.email = incoming.email;
        const mobile = incoming.mobileNumber || incoming.mobile;
        if (mobile && mobile !== manager.mobileNumber) diff.mobileNumber = mobile;

        payload = diff;
        if (Object.keys(diff).length === 0) {
          throw new BadRequestException('No changes detected in profile update');
        }
      }
    }

    return this.prisma.approvalRequest.create({
      data: {
        requestType: type.includes('_WORKER') ? type : `${type}_WORKER`,
        payload: payload,
        requestedById: managerId,
        targetAdminId,
        status: 'PENDING'
      }
    });
  }

  async getMyRequests(managerId: number) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: { requestedById: managerId },
      include: {
        targetAdmin: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const benIds = [...new Set(requests.map(r => (r.payload as any)?.beneficiaryId).filter(Boolean))] as number[];
    const workerIds = [...new Set(requests.map(r => (r.payload as any)?.workerId).filter(Boolean))] as number[];

    const beneficiaries = benIds.length > 0 
      ? await this.prisma.beneficiary.findMany({
          where: { id: { in: benIds } },
          select: { id: true, uid: true, name: true, mobileNumber: true }
        })
      : [];

    const workers = workerIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, name: true, email: true, usercode: true }
        })
      : [];

    const benMap = Object.fromEntries(beneficiaries.map(b => [b.id, b]));
    const workerMap = Object.fromEntries(workers.map(w => [w.id, w]));

    return requests.map(r => {
      const payload = (r.payload as any) || {};
      return {
        ...r,
        beneficiary: benMap[payload.beneficiaryId] || null,
        worker: workerMap[payload.workerId] || null
      };
    });
  }

  async cancelRequest(requestId: number, managerId: number) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.requestedById !== managerId) throw new ForbiddenException('You can only cancel your own requests');
    if (request.status !== 'PENDING') throw new BadRequestException('Only pending requests can be cancelled');

    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' }
    });
  }

  async getActiveShares(managerId: number) {
    return this.prisma.accountShare.findMany({
      where: { managerId },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true, usercode: true }
        },
        toUser: {
          select: { id: true, name: true, email: true, usercode: true }
        }
      }
    });
  }

  async shareAccount(fromWorkerId: number, toWorkerId: number, managerId: number) {
    if (fromWorkerId === toWorkerId) {
      throw new BadRequestException('Cannot share account with oneself');
    }

    // Verify both users exist
    const [fromUser, toUser] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: fromWorkerId } }),
      this.prisma.user.findUnique({ where: { id: toWorkerId } })
    ]);

    if (!fromUser || !toUser) {
      throw new NotFoundException('One or both outreach workers not found');
    }

    // Check if share already exists
    const existing = await this.prisma.accountShare.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: fromWorkerId,
          toUserId: toWorkerId
        }
      }
    });

    if (existing) {
      throw new ConflictException('This account sharing relationship already exists');
    }

    return this.prisma.accountShare.create({
      data: {
        fromUserId: fromWorkerId,
        toUserId: toWorkerId,
        managerId
      },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true, usercode: true }
        },
        toUser: {
          select: { id: true, name: true, email: true, usercode: true }
        }
      }
    });
  }

  async revokeShare(shareId: number, managerId: number) {
    const share = await this.prisma.accountShare.findUnique({
      where: { id: shareId }
    });

    if (!share) {
      throw new NotFoundException('Account sharing relationship not found');
    }

    if (share.managerId !== managerId) {
      throw new ForbiddenException('You cannot revoke sharing relationship created by another manager');
    }

    return this.prisma.accountShare.delete({
      where: { id: shareId }
    });
  }
}
