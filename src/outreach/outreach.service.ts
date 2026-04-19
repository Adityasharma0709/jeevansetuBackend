import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';
import { RequestBeneficiaryUpdateDto } from './dto/request-beneficiary-update.dto';

@Injectable()
export class OutreachService {
  constructor(private prisma: PrismaService) { }

  private assertIsActive(status: string | null | undefined, label: string) {
    if ((status ?? '').toString().toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException(`${label} is deactivated`);
    }
  }

  private async ensureOutreachAssignedToBeneficiary(userId: number, beneficiary: { projectId: number; locationId: number }) {
    const assigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId,
        projectId: beneficiary.projectId,
        locationId: beneficiary.locationId,
      },
      select: { id: true },
    });

    if (!assigned) {
      throw new ForbiddenException('You are not assigned to this beneficiary');
    }
  }
  async createBeneficiary(dto: CreateBeneficiaryDto, user: any) {

    // 1. Check outreach assignment
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

    // 2. Get project code
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true, projectCode: true, status: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }
    this.assertIsActive(project.status, 'Project');

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
      select: { id: true, status: true },
    });
    if (!location) throw new NotFoundException('Location not found');
    this.assertIsActive(location.status, 'Location');

    // 3. Count existing beneficiaries in project
    const count = await this.prisma.beneficiary.count({
      where: { projectId: dto.projectId }
    });

    // 4. Generate UID
    const next = count + 1;
    const padded = String(next).padStart(6, '0');

    const uid = `${project.projectCode}${padded}`;

    // 5. Create beneficiary
    return this.prisma.beneficiary.create({
      data: {
        uid,
        projectId: dto.projectId,
        locationId: dto.locationId,
        state: dto.state,
        district: dto.district,
        block: dto.block,
        village: dto.village,
        createdById: user.userId,

        mobileNumber: dto.mobileNumber,
        name: dto.name,
        gender: dto.gender,
        guardianName: dto.guardianName,
        dateOfBirth: new Date(dto.dateOfBirth),

        maritalStatus: dto.maritalStatus,
        dateOfMarriage: dto.dateOfMarriage,
        womanAgeAtMarriage: dto.womanAgeAtMarriage,
        husbandAgeAtMarriage: dto.husbandAgeAtMarriage,

        qualification: dto.qualification,
        religion: dto.religion,
        caste: dto.caste,

        monthlyIncome: dto.monthlyIncome,
        economicStatus: dto.economicStatus,
        primaryIncomeSource: dto.primaryIncomeSource,
        employmentStatus: dto.employmentStatus
      }
    });
  }

  async raiseRequest(dto, user) {
    // Find the manager who created this outreach worker
    const outreachUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { createdByAdminId: true },
    });

    return this.prisma.approvalRequest.create({
      data: {
        requestType: dto.type,
        payload: dto.data ?? {},
        requestedById: user.userId,
        targetAdminId: outreachUser?.createdByAdminId ?? null,
        status: 'PENDING',
      }
    });
  }

  async requestBeneficiaryUpdate(id: number, dto: RequestBeneficiaryUpdateDto, user) {
    const ben = await this.prisma.beneficiary.findUnique({ where: { id } });
    if (!ben) throw new NotFoundException('Beneficiary not found');

    const requester = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { createdByAdminId: true }
    });

    return this.prisma.approvalRequest.create({
      data: {
        requestType: 'UPDATE_BENEFICIARY',
        payload: {
          beneficiaryId: id,
          changes: dto?.changes as any,
        },
        requestedById: user.userId,
        targetAdminId: requester?.createdByAdminId,
        status: 'PENDING'
      }
    });
  }

  async getMyRequests(userId: number) {
    const requests = await this.prisma.approvalRequest.findMany({
      where: { requestedById: userId },
      include: {
        approvedBy: { select: { name: true, email: true } },
        targetAdmin: { select: { name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
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

  async cancelRequest(requestId: number, userId: number) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) throw new NotFoundException('Request not found');
    if (request.requestedById !== userId) throw new ForbiddenException('You can only cancel your own requests');
    if (request.status !== 'PENDING') throw new BadRequestException('Only pending requests can be cancelled');

    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' }
    });
  }

  async submitReport(dto: CreateReportDto, user: any) {
    const ben = await this.prisma.beneficiary.findUnique({ where: { id: dto.beneficiaryId } });
    if (!ben) throw new NotFoundException('Beneficiary not found');

    const activity = await this.prisma.activity.findUnique({ where: { id: dto.activityId } });
    if (!activity) throw new NotFoundException('Activity not found');

    const sessionId = typeof dto.sessionId === 'number' && dto.sessionId > 0 ? dto.sessionId : null;
    if (sessionId === null) throw new BadRequestException('sessionId is required');

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const exists = await this.prisma.activityReport.findFirst({
      where: { beneficiaryId: dto.beneficiaryId, activityId: dto.activityId, sessionId }
    });
    if (exists) throw new ConflictException('Report already submitted');

    return this.prisma.activityReport.create({
      data: {
        beneficiaryId: dto.beneficiaryId,
        activityId: dto.activityId,
        sessionId,
        reportedById: user.userId,
        reportData: {
          ...dto.reportData,
          sessionDate: dto.sessionDate
        }
      }
    });
  }

  async getReport(id: number, user: any) {
    const report = await this.prisma.activityReport.findUnique({
      where: { id },
      include: {
        beneficiary: true,
        activity: true,
        session: true
      }
    });

    if (!report) throw new NotFoundException('Report not found');
    
    // We can allow managers/admins to view reports too, but for now just basic auth 
    return report;
  }

  async updateReport(id: number, dto: UpdateReportDto, user: any) {
    const report = await this.prisma.activityReport.findUnique({
      where: { id }
    });
    
    if (!report) throw new NotFoundException('Report not found');

    // Make sure user owns it or has right role
    const roles = user.roles?.map((r: any) => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN') || roles.includes('ADMIN') || roles.includes('MANAGER');
    
    if (!isSuperAdmin && report.reportedById !== user.userId) {
      throw new ForbiddenException('You can only update reports that you created');
    }

    // Prepare updated data
    const existingData = (report.reportData as any) || {};
    const newData = dto.reportData || {};

    return this.prisma.activityReport.update({
      where: { id },
      data: {
        reportData: {
          ...existingData,
          ...newData,
          sessionDate: dto.sessionDate || existingData.sessionDate
        }
      }
    });
  }

  async outreachDashboard(userId: number) {
    const beneficiariesRegistered = await this.prisma.beneficiary.count({
      where: { createdById: userId }
    });

    const pendingRequests = await this.prisma.approvalRequest.count({
      where: {
        requestedById: userId,
        status: 'PENDING'
      }
    });

    const reportsSubmitted = await this.prisma.activityReport.count({
      where: { reportedById: userId }
    });

    const assignedLocations = await this.prisma.userProjectLocation.count({
      where: { userId }
    });

    return {
      totalBeneficiaries: beneficiariesRegistered,
      pendingRequests,
      totalReports: reportsSubmitted,
      assignedLocations
    };
  }

  async getMyReports(userId: number) {
    return this.prisma.activityReport.findMany({
      where: { reportedById: userId },
      include: {
        beneficiary: { select: { name: true, uid: true, mobileNumber: true } },
        activity: { select: { name: true } },
        session: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getDebugInfo() {
    const users = await this.prisma.user.findMany();
    const projects = await this.prisma.project.findMany();
    const locations = await this.prisma.location.findMany();
    const assignments = await this.prisma.userProjectLocation.findMany();

    return { users, projects, locations, assignments };
  }
  async getBeneficiaryList(user: any, search?: string) {
    const roles = user.roles?.map(r => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');

    let where: any = {};

    if (!isSuperAdmin) {
      const assignments = await this.prisma.userProjectLocation.findMany({
        where: { userId: user.userId }
      });

      if (assignments.length === 0) {
        return [];
      }

      // Filter by projects assigned to the user
      const projectIds = assignments.map(a => a.projectId);
      where.projectId = { in: projectIds };

      // Optionally filter by location as well if the requirement is strict
      // const locationIds = assignments.map(a => a.locationId);
      // where.locationId = { in: locationIds };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { uid: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.beneficiary.findMany({
      where,
      include: {
        project: true,
        location: true,
        createdBy: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // Group Tagging
  async tagBeneficiaryGroup(beneficiaryId: number, groupId: number, user: any) {
    const userId = Number(user?.userId);
    if (!Number.isFinite(userId)) throw new BadRequestException('Invalid user');

    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: Number(beneficiaryId) },
      select: { id: true, projectId: true, locationId: true },
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    await this.ensureOutreachAssignedToBeneficiary(userId, beneficiary);

    const group = await this.prisma.beneficiaryGroup.findUnique({
      where: { id: Number(groupId) },
      select: { id: true, status: true },
    });
    if (!group) throw new NotFoundException('Group not found');
    this.assertIsActive(group.status, 'Group');

    const exists = await this.prisma.groupMember.findFirst({
      where: { beneficiaryId: beneficiary.id, groupId: group.id },
      select: { id: true },
    });
    if (exists) throw new ConflictException('Already tagged');

    return this.prisma.groupMember.create({
      data: {
        beneficiaryId: beneficiary.id,
        groupId: group.id,
      },
    });
  }

  async tagBeneficiaryActivity(beneficiaryId: number, activityId: number, sessionId: number, user: any) {
    const userId = Number(user?.userId);
    if (!Number.isFinite(userId)) throw new BadRequestException('Invalid user');

    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: Number(beneficiaryId) },
      select: { id: true, projectId: true, locationId: true },
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    await this.ensureOutreachAssignedToBeneficiary(userId, beneficiary);

    const activity = await this.prisma.activity.findUnique({
      where: { id: Number(activityId) },
      select: {
        id: true,
        status: true,
        projectId: true,
        project: { select: { status: true } },
      },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    this.assertIsActive(activity.status, 'Activity');
    if (activity.projectId && activity.project?.status) {
      this.assertIsActive(activity.project.status, 'Project');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: Number(sessionId) },
      select: { id: true, status: true, activityId: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.assertIsActive(session.status, 'Session');
    if (Number(session.activityId) !== Number(activity.id)) {
      throw new BadRequestException('Session does not belong to the activity');
    }

    const exists = await this.prisma.beneficiaryActivity.findFirst({
      where: { beneficiaryId: beneficiary.id, activityId: activity.id, sessionId: session.id },
      select: { id: true },
    });
    if (exists) throw new ConflictException('Already tagged');

    return this.prisma.beneficiaryActivity.create({
      data: {
        beneficiaryId: beneficiary.id,
        activityId: activity.id,
        sessionId: session.id,
      },
    });
  }

  // Helpers
  async getGroups() {
    return this.prisma.beneficiaryGroup.findMany({
      where: { status: 'ACTIVE' },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActivities() {
    return this.prisma.activity.findMany({
      where: { status: 'ACTIVE' },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, name: true, projectCode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSessions(activityId: number) {
    return this.prisma.session.findMany({
      where: { activityId, status: 'ACTIVE' },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        activity: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBeneficiary(id: number) {
    const ben = await this.prisma.beneficiary.findUnique({
      where: { id },
      include: {
        project: true,
        location: true,
        children: true,
        groups: { include: { group: true } },
        activities: { include: { activity: true, session: true } }
      }
    });

    if (!ben) throw new NotFoundException('Beneficiary not found');

    return ben;
  }

  async getAssignedLocations(projectId: number, userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: {
        userId,
        projectId
      },
      include: {
        location: true
      }
    });

    // Extract and return just the locations
    return assignments.map(a => a.location);
  }
}

