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
import { AddFamilyMemberDto } from './dto/add-family-member.dto';

@Injectable()
export class OutreachService {
  constructor(private prisma: PrismaService) { }

  private assertIsActive(status: string | null | undefined, label: string) {
    if ((status ?? '').toString().toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException(`${label} is deactivated`);
    }
  }

  private async ensureOutreachAssignedToBeneficiary(userId: number, beneficiary: { projectId: number; awcId: number }) {
    const assigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId,
        projectId: beneficiary.projectId,

      },
      select: { id: true },
    });

    if (!assigned) {
      throw new ForbiddenException('You are not assigned to this beneficiary');
    }
  }
  async createBeneficiary(dto: CreateBeneficiaryDto, user: any) {
    // 1. Get AWC and check its state
    const awc = await this.prisma.awc.findUnique({
      where: { id: dto.locationId },
      select: { id: true, stateId: true, status: true },
    });
    if (!awc) throw new NotFoundException('AWC not found');
    this.assertIsActive(awc.status, 'AWC');

    // 2. Check outreach assignment for this project and state
    const assigned = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: user.userId,
        projectId: dto.projectId,
        stateId: awc.stateId
      }
    });

    if (!assigned) {
      throw new ForbiddenException(
        'You are not assigned to this project or the state of this location'
      );
    }

    // 3. Get project code   
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true, projectCode: true, status: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }
    this.assertIsActive(project.status, 'Project');

    // 4. Count existing beneficiaries in project
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
        awcId: dto.locationId,
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

  async raiseRequest(dto: any, user: any) {
    const outreachUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, name: true, email: true, mobileNumber: true, createdByAdminId: true },
    });

    let payload = dto.data ?? {};

    // If it's a profile update, only store actual changes
    if (dto.type === 'UPDATE_PROFILE' && outreachUser) {
      const diff: Record<string, any> = {};
      const incoming = dto.data || {};
      
      if (incoming.name && incoming.name !== outreachUser.name) diff.name = incoming.name;
      if (incoming.email && incoming.email !== outreachUser.email) diff.email = incoming.email;
      
      const mobile = incoming.mobileNumber || incoming.mobile;
      if (mobile && mobile !== outreachUser.mobileNumber) diff.mobileNumber = mobile;
      
      payload = diff;
      if (Object.keys(diff).length === 0) {
        throw new BadRequestException('No changes detected in profile update request');
      }
    }

    return this.prisma.approvalRequest.create({
      data: {
        requestType: dto.type,
        payload: payload,
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

    const diff: Record<string, any> = {};
    const incoming = (dto?.changes as any) || {};
    
    // Compare applicable fields
    const fields = [
      'name', 'mobileNumber', 'gender', 'guardianName', 'dateOfBirth',
      'maritalStatus', 'dateOfMarriage', 'womanAgeAtMarriage', 'husbandAgeAtMarriage',
      'qualification', 'religion', 'caste', 'monthlyIncome', 'economicStatus',
      'primaryIncomeSource', 'employmentStatus', 'state', 'district', 'block', 'village'
    ];

    for (const field of fields) {
      if (incoming[field] !== undefined && incoming[field] !== null) {
        let currentVal = ben[field];
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
        requestType: 'UPDATE_BENEFICIARY',
        payload: {
          beneficiaryId: id,
          changes: diff,
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

    const reportDate = dto.sessionDate ? new Date(dto.sessionDate) : new Date();

    // Check for duplicate report on the same date
    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingReport = await this.prisma.activityReport.findFirst({
      where: {
        beneficiaryId: dto.beneficiaryId,
        childId: dto.childId || null,
        activityId: dto.activityId,
        sessionId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        }
      }
    });

    if (existingReport) {
      throw new ConflictException('A report for this activity and session has already been submitted for this beneficiary on this date.');
    }

    return this.prisma.activityReport.create({
      data: {
        beneficiaryId: dto.beneficiaryId,
        childId: dto.childId || null,
        activityId: dto.activityId,
        sessionId,
        reportedById: user.userId,
        date: reportDate,
        reportData: dto.reportData
      }
    });
  }

  async getReport(id: number, user: any) {
    const report = await this.prisma.activityReport.findUnique({
      where: { id },
      include: {
        beneficiary: true,
        child: true,
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
        child: { select: { name: true, uid: true } },
        activity: { select: { name: true } },
        session: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getDebugInfo() {
    const users = await this.prisma.user.findMany();
    const projects = await this.prisma.project.findMany();
    const awcs = await this.prisma.awc.findMany();
    const assignments = await this.prisma.userProjectLocation.findMany();

    return { users, projects, awcs, assignments };
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
        { children: { some: { name: { contains: search, mode: 'insensitive' } } } },
        { children: { some: { uid: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.beneficiary.findMany({
      where,
      include: {
        project: true,
        awc: true,
        children: true,
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
      select: { id: true, projectId: true, awcId: true },
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
      select: { id: true, projectId: true, awcId: true },
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
        awc: true,
        children: true,
        groups: { include: { group: true } },
        activities: { include: { activity: true, session: true } }
      }
    });

    if (!ben) throw new NotFoundException('Beneficiary not found');

    return ben;
  }

  async getAssignedLocations(projectId: number, userId: number) {
    // 1. Get states assigned to the user for this project
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId, projectId },
      select: { stateId: true }
    });

    const assignedStateIds = assignments.map(a => a.stateId).filter((id): id is number => id !== null);

    const where: any = {
      projectId,
      status: 'ACTIVE'
    };

    // If specific states are assigned, filter by them.
    // If the user is assigned to the project but no specific stateId is present in any assignment, 
    // it means they have access to the entire project's locations.
    if (assignedStateIds.length > 0) {
      where.stateId = { in: assignedStateIds };
    }

    // 2. Fetch all AWCs in the project (filtered by states if necessary), including full hierarchy
    return this.prisma.awc.findMany({
      where,
      include: {
        state: true,
        district: true,
        block: true,
        village: true
      },
      orderBy: [
        { state: { name: 'asc' } },
        { district: { name: 'asc' } },
        { block: { name: 'asc' } },
        { village: { name: 'asc' } },
        { awcName: 'asc' }
      ]
    });
  }

  // ── Family Members ─────────────────────────────────────────────────────────

  async addFamilyMember(beneficiaryId: number, dto: AddFamilyMemberDto, user: any) {
    const userId = Number(user?.userId);
    if (!Number.isFinite(userId)) throw new BadRequestException('Invalid user');

    // 1. Verify beneficiary exists
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, uid: true, projectId: true, awcId: true },
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    // 2. Verify outreach user is assigned to this beneficiary
    await this.ensureOutreachAssignedToBeneficiary(userId, beneficiary);

    // 3. Age-based field validation
    const dob = new Date(dto.dateOfBirth);
    const today = new Date();
    let ageYears = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
      ageYears--;
    }

    if (ageYears <= 14) {
      if (!dto.schoolingStatus) {
        throw new BadRequestException(`schoolingStatus is required for children (Age: ${ageYears})`);
      }
    } else {
      if (!dto.employmentStatus) {
        throw new BadRequestException(`employmentStatus is required for family members (Age: ${ageYears})`);
      }
    }

    if (ageYears > 6) {
      if (!dto.qualification) {
        throw new BadRequestException(`qualification is required for family members (Age: ${ageYears})`);
      }
    }

    // 4. Generate family member UID: <beneficiaryUid>+f<NN>
    const existingCount = await this.prisma.beneficiaryChild.count({
      where: { beneficiaryId },
    });
    const suffix = String(existingCount + 1).padStart(2, '0');
    const memberUid = `${beneficiary.uid}F${suffix}`;

    // 5. Create family member record
    return this.prisma.beneficiaryChild.create({
      data: {
        uid: memberUid,
        beneficiaryId,
        name: dto.name,
        relationship: dto.relationship,
        dateOfBirth: new Date(dto.dateOfBirth),
        gender: dto.gender,
        schoolingStatus: (ageYears <= 14 ? (dto.schoolingStatus ?? null) : null) as any,
        employmentStatus: (ageYears > 14 ? (dto.employmentStatus ?? null) : null) as any,
        qualification: (ageYears > 6 ? (dto.qualification ?? null) : null) as any,
      },
    });
  }

  async getFamilyMembers(beneficiaryId: number) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true },
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    return this.prisma.beneficiaryChild.findMany({
      where: { beneficiaryId },
      orderBy: { id: 'asc' },
    });
  }
}

