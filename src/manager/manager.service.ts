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

  private buildBeneficiaryUpdateData(raw: Record<string, any>) {
    const data: Record<string, any> = {};
    const changes = raw || {};

    const assignNumber = (key: string) => {
      const value = changes[key];
      if (value === undefined || value === null || value === '') return;
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new BadRequestException(`Invalid number for ${key}`);
      }
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
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`Invalid date for ${key}`);
      }
      data[key] = date;
    };

    assignNumber('projectId');
    assignNumber('locationId');
    assignString('mobileNumber');
    assignString('name');
    assignString('gender');
    assignString('guardianName');
    assignDate('dateOfBirth');
    assignString('maritalStatus');
    assignString('dateOfMarriage');
    assignNumber('womanAgeAtMarriage');
    assignNumber('husbandAgeAtMarriage');
    assignString('qualification');
    assignString('religion');
    assignString('caste');
    assignNumber('monthlyIncome');
    assignString('economicStatus');
    assignString('primaryIncomeSource');
    assignString('employmentStatus');
    assignString('state');
    assignString('district');
    assignString('block');
    assignString('village');

    return data;
  }

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
    const workers = await this.prisma.user.count({
      where: {
        createdByAdminId: managerId,
        roles: {
          some: {
            role: { name: 'OUTREACH' }
          }
        }
      }
    });

    // pending approvals targeted to this manager
    const pendingRequests = await this.prisma.approvalRequest.count({
      where: {
        status: 'PENDING',
        targetAdminId: managerId
      }
    });

    // today reports submitted by outreach workers under this manager
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reportsToday = await this.prisma.activityReport.count({
      where: {
        createdAt: {
          gte: today
        },
        reportedBy: {
          createdByAdminId: managerId
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

    const data: Record<string, any> = { ...dto };
    if (data.mobile !== undefined && data.mobileNumber === undefined) {
      data.mobileNumber = data.mobile;
    }
    delete data.mobile;

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
      delete data.password; // Wait, it's actually data.password getting updated above
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
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
        mobileNumber: dto.mobileNumber ?? dto.mobile,
        usercode: dto.usercode,
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
    const linked = await this.prisma.project.count({
      where: {
        id: dto.projectId,
        locations: { some: { id: dto.locationId } },
      },
    });

    if (linked === 0) {
      await this.prisma.project.update({
        where: { id: dto.projectId },
        data: { locations: { connect: { id: dto.locationId } } },
      });
    }

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

  async getAll(managerId: number) {
    return this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', targetAdminId: managerId },
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
        mobileNumber: true,
        usercode: true,
        status: true,
        projectAssignments: {
          select: {
            projectId: true,
            locationId: true,
            project: { select: { id: true, name: true } },
            location: { select: { id: true, village: true, block: true, status: true } },
          }
        }
      },
      orderBy: { id: 'desc' }
    });
  }

  async getAssignedLocations(managerId: number, projectId: number) {
    const numericProjectId = Number(projectId);
    if (!Number.isFinite(numericProjectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: managerId, projectId: numericProjectId },
      select: {
        location: { select: { id: true, state: true, district: true, block: true, village: true, status: true } },
      },
    });

    const seen = new Set<number>();
    return (assignments || [])
      .map((a: any) => a.location)
      .filter(Boolean)
      .filter((l: any) => (l.status ?? '').toString().toUpperCase() === 'ACTIVE')
      .filter((l: any) => {
        const id = Number(l.id);
        if (!Number.isFinite(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  async tagWorkerProjectLocation(managerId: number, workerId: number, projectId: any, locationId: any) {
    const numericWorkerId = Number(workerId);
    const numericProjectId = Number(projectId);
    const numericLocationId = Number(locationId);

    if (!Number.isFinite(numericWorkerId) || !Number.isFinite(numericProjectId) || !Number.isFinite(numericLocationId)) {
      throw new BadRequestException('Invalid project/location selection');
    }

    const managerAssigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: managerId,
        projectId: numericProjectId,
        locationId: numericLocationId,
      },
      select: { id: true },
    });

    if (!managerAssigned) {
      throw new ForbiddenException('You are not assigned to this project/location');
    }

    const worker = await this.prisma.user.findFirst({
      where: {
        id: numericWorkerId,
        createdByAdminId: managerId,
        roles: {
          some: {
            role: { name: 'OUTREACH' }
          }
        }
      },
      select: { id: true },
    });

    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    const already = await this.prisma.userProjectLocation.findFirst({
      where: { userId: numericWorkerId, projectId: numericProjectId, locationId: numericLocationId },
      select: { id: true },
    });

    if (already) {
      return { message: 'Already tagged' };
    }

    const linked = await this.prisma.project.count({
      where: {
        id: numericProjectId,
        locations: { some: { id: numericLocationId } },
      },
    });

    if (linked === 0) {
      await this.prisma.project.update({
        where: { id: numericProjectId },
        data: { locations: { connect: { id: numericLocationId } } },
      });
    }

    await this.prisma.userProjectLocation.create({
      data: {
        userId: numericWorkerId,
        projectId: numericProjectId,
        locationId: numericLocationId,
      }
    });

    return { message: 'Tagged successfully' };
  }
  async getProfileRequests(managerId: number) {
    return this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        targetAdminId: managerId,
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

  async getBeneficiaries(managerId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: managerId },
      select: { projectId: true }
    });

    const projectIds = assignments.map(a => a.projectId);

    return this.prisma.beneficiary.findMany({
      where: {
        projectId: { in: projectIds },
        createdBy: { createdByAdminId: managerId }
      },
      include: {
        project: true,
        location: true,
        createdBy: { select: { name: true, email: true, mobileNumber: true } }
      },
      orderBy: {
        createdAt: 'desc'
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
      data: {
        status,
        approvedById: managerId,
        approvedAt: new Date()
      }
    });
  }

  async submitAccountRequest(type: string, data: any, managerId: number) {
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
