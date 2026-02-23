import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';

@Injectable()
export class ManagerService {
  constructor(private prisma: PrismaService) { }

  private async getCreatorAdminIdForManager(managerId: number) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, createdByAdminId: true },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    if (!manager.createdByAdminId) {
      throw new BadRequestException(
        'No creator admin mapped for this manager. Please recreate manager with admin ownership mapping.',
      );
    }

    return manager.createdByAdminId;
  }

  async managerDashboard(managerId: number) {
    // workers under this manager
    const workers = await this.prisma.userRole.count({
      where: {
        role: { name: 'OUTREACH' }
      }
    });

    // pending approvals
    const pendingRequests = await this.prisma.approvalRequest.count({
      where: {
        status: 'PENDING'
      }
    });

    // today reports
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reportsToday = await this.prisma.activityReport.count({
      where: {
        createdAt: {
          gte: today
        }
      }
    });

    // assigned locations
    const assignments = await this.prisma.userProjectLocation.count({
      where: { userId: managerId }
    });

    return {
      totalWorkers: workers,
      pendingRequests,
      reportsToday,
      assignedLocations: assignments
    };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
  }

  async createWorker(dto: CreateWorkerDto, user: any) {
    // 1. Check manager assignment
    const assigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: user.userId,
        projectId: dto.projectId,
        locationId: dto.locationId
      }
    });

    if (!assigned) {
      throw new ForbiddenException(
        'You are not assigned to this project/location'
      );
    }

    // 2. Check email duplicate
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email }
    });

    if (exists) throw new ConflictException('Email already exists');

    // 3. Hash password
    const hash = await bcrypt.hash(dto.password, 10);

    // 4. Create outreach user
    const worker = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        status: 'ACTIVE',
        // Reuse creator field to keep ownership of outreach workers by manager
        createdByAdminId: user.userId,
      }
    });

    // 5. Assign role OUTREACH
    const role = await this.prisma.role.findUnique({
      where: { name: 'OUTREACH' }
    });

    if (!role) {
      throw new ConflictException('OUTREACH role not found');
    }

    await this.prisma.userRole.create({
      data: {
        userId: worker.id,
        roleId: role.id
      }
    });

    // 6. Assign project/location
    await this.prisma.userProjectLocation.create({
      data: {
        userId: worker.id,
        projectId: dto.projectId,
        locationId: dto.locationId
      }
    });

    const { password, ...safe } = worker;

    return {
      message: 'Outreach user created successfully',
      user: safe
    };
  }

  async updateWorker(id: number, dto: UpdateWorkerDto, user: any) {
    const assigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: user.userId,
        projectId: dto.projectId,
        locationId: dto.locationId
      }
    });

    if (!assigned)
      throw new ForbiddenException('Not assigned area');

    return this.prisma.user.update({
      where: { id },
      data: dto
    });
  }

  async activateWorker(workerId: number, manager: any) {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId }
    });

    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    const outreach = await this.prisma.userRole.findFirst({
      where: {
        userId: workerId,
        role: { name: 'OUTREACH' }
      },
      include: { role: true }
    });

    if (!outreach) {
      throw new ForbiddenException('User is not an Outreach Worker');
    }

    const updated = await this.prisma.user.update({
      where: { id: workerId },
      data: { status: 'ACTIVE' }
    });

    const { password, ...safe } = updated;

    return {
      message: 'Outreach worker activated successfully',
      user: safe
    };
  }

  async deactivateWorker(workerId: number, manager: any) {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId }
    });

    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    const outreach = await this.prisma.userRole.findFirst({
      where: {
        userId: workerId,
        role: { name: 'OUTREACH' }
      },
      include: { role: true }
    });

    if (!outreach) {
      throw new ForbiddenException('User is not an Outreach Worker');
    }

    const updated = await this.prisma.user.update({
      where: { id: workerId },
      data: { status: 'INACTIVE' }
    });

    const { password, ...safe } = updated;

    return {
      message: 'Outreach worker deactivated successfully',
      user: safe
    };
  }

  async getAll() {
    return this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING' },
      include: { requestedBy: true }
    });
  }

  async approve(id: number, manager: any) {
    const req = await this.prisma.approvalRequest.findUnique({
      where: { id }
    });

    if (!req) throw new NotFoundException();

    if (req.requestType === 'UPDATE_PROFILE') {
      await this.prisma.user.update({
        where: { id: req.requestedById },
        data: req.payload as any
      });
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: manager.userId,
        approvedAt: new Date()
      }
    });
  }

  async reject(id: number, dto: any, manager: any) {
    return this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        remarks: dto.reason,
        approvedById: manager.userId
      }
    });
  }

  async getBeneficiaryRequests() {
    return this.prisma.approvalRequest.findMany({
      where: {
        requestType: 'UPDATE_BENEFICIARY',
        status: 'PENDING'
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            createdAt: true
          }
        }
      }
    });
  }

  async submitBeneficiaryUpdateRequest(
    beneficiaryId: number,
    changes: UpdateBeneficiaryDto,
    managerId: number,
  ) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true },
    });

    if (!beneficiary) {
      throw new NotFoundException('Beneficiary not found');
    }

    const targetAdminId = await this.getCreatorAdminIdForManager(managerId);

    return this.prisma.approvalRequest.create({
      data: {
        requestType: 'MODIFY_BENEFICIARY',
        payload: {
          beneficiaryId,
          changes: changes as any,
        },
        requestedById: managerId,
        targetAdminId,
        status: 'PENDING',
      },
    });
  }

  async approveRequest(id: number, manager: any) {
    const req = await this.prisma.approvalRequest.findUnique({
      where: { id }
    });

    if (!req) throw new NotFoundException();

    if (req.requestType === 'UPDATE_BENEFICIARY') {
      const { beneficiaryId, changes } = req.payload as { beneficiaryId: number; changes: any };

      await this.prisma.beneficiary.update({
        where: { id: beneficiaryId },
        data: changes
      });
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: manager.userId,
        approvedAt: new Date()
      }
    });
  }

  async rejectRequest(requestId: number, dto: { reason: string }, manager: any) {
    const req = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId }
    });

    if (!req) {
      throw new NotFoundException('Request not found');
    }

    if (req.status !== 'PENDING') {
      throw new BadRequestException('Request already processed');
    }

    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        remarks: dto.reason,
        approvedById: manager.userId,
        approvedAt: new Date()
      }
    });
  }

  async getOutreachWorkers(managerId: number) {
    return this.prisma.user.findMany({
      where: {
        createdByAdminId: managerId,
        roles: {
          some: {
            role: { name: 'OUTREACH' }
          }
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true
      }
    });
  }

  async getProfileRequests() {
    return this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        requestType: {
          in: ['UPDATE_PROFILE', 'MODIFY_PROFILE'],
        },
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
  }

  async updateRequestStatus(id: number, status: 'APPROVED' | 'REJECTED', managerId: number) {
    const req = await this.prisma.approvalRequest.findUnique({
      where: { id }
    });

    if (!req) throw new NotFoundException('Request not found');

    if (
      status === 'APPROVED' &&
      ['UPDATE_PROFILE', 'MODIFY_PROFILE'].includes(String(req.requestType || ''))
    ) {
      const payload = (req.payload as any) || {};
      const profileUpdates: any = {};
      if (payload.name) profileUpdates.name = payload.name;
      if (payload.email) profileUpdates.email = payload.email;

      if (Object.keys(profileUpdates).length === 0) {
        return this.prisma.approvalRequest.update({
          where: { id },
          data: {
            status,
            approvedById: managerId,
            approvedAt: new Date(),
          },
        });
      }

      await this.prisma.user.update({
        where: { id: req.requestedById },
        data: profileUpdates,
      });
    }

    return this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status,
        approvedById: managerId,
        approvedAt: new Date()
      }
    });
  }

  async submitAccountRequest(type: string, data: any, managerId: number) {
    // For now, since Managers are the primary managers of workers,
    // we can directly perform the action OR store it as a request if needed.
    // The requirement says "submit request", so let's store it as an ApprovalRequest
    // that could be approved by an Admin or auto-approved.

    // However, the Manager already has createWorker, updateWorker, deactivateWorker.
    // If we want the "Request" flow as per frontend, we'll store it.

    const targetAdminId = await this.getCreatorAdminIdForManager(managerId);

    return this.prisma.approvalRequest.create({
      data: {
        requestType: `${type}_WORKER`,
        payload: data,
        requestedById: managerId,
        targetAdminId,
        status: 'PENDING'
      }
    });
  }

  async getMyRequests(managerId: number) {
    return this.prisma.approvalRequest.findMany({
      where: {
        requestedById: managerId,
      },
      include: {
        targetAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvedBy: {
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
}
