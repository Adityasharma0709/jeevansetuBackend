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

  private async ensureOutreachAssignedToBeneficiary(userId: number, beneficiary: { projectId: number; awcId?: number | null }) {
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
    if (dto.beneficiaryType === 'Priority') {
      if (!dto.locationId) {
        throw new BadRequestException('locationId is required for Priority beneficiaries');
      }
      
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
    } else {
      // For Stakeholder and General, just verify project assignment
      const assigned = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: user.userId,
          projectId: dto.projectId,
        }
      });

      if (!assigned) {
        throw new ForbiddenException(
          'You are not assigned to this project'
        );
      }
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
    const ben = await this.prisma.beneficiary.create({
      data: {
        uid,
        typeof: dto.beneficiaryType || 'Priority',
        projectId: dto.projectId,
        awcId: dto.locationId || null,
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
    await this.recalculateGroupsForBeneficiary(ben.id);
    return ben;
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
      'typeof', 'name', 'mobileNumber', 'gender', 'guardianName', 'dateOfBirth',
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

    const report = await this.prisma.activityReport.create({
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
    await this.recalculateGroupsForBeneficiary(dto.beneficiaryId);
    return report;
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

    const dataToUpdate: any = {
      reportData: {
        ...existingData,
        ...newData,
      }
    };

    if (dto.sessionDate) dataToUpdate.date = new Date(dto.sessionDate);
    if (dto.activityId) dataToUpdate.activityId = dto.activityId;
    if (dto.sessionId) dataToUpdate.sessionId = dto.sessionId;
    if (dto.beneficiaryId) dataToUpdate.beneficiaryId = dto.beneficiaryId;
    if (dto.childId !== undefined) dataToUpdate.childId = dto.childId || null;

    const updated = await this.prisma.activityReport.update({
      where: { id },
      data: dataToUpdate
    });
    await this.recalculateGroupsForBeneficiary(updated.beneficiaryId);
    return updated;
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
        beneficiary: {
          select: {
            name: true,
            uid: true,
            mobileNumber: true,
            dateOfBirth: true,
            gender: true,
            typeof: true,
            groups: {
              include: {
                group: true
              }
            }
          }
        },
        child: {
          select: {
            name: true,
            uid: true,
            dateOfBirth: true,
            gender: true
          }
        },
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
      // Outreach workers only see beneficiaries they personally registered
      where.createdById = user.userId;
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

  async getActivities(user: any) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: user.userId },
      select: { projectId: true }
    });

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    return this.prisma.activity.findMany({
      where: {
        status: 'ACTIVE',
        projectId: { in: projectIds }
      },
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
    // 1. Get assignments to find which states are assigned to the user
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId, projectId },
      include: { state: true }
    });

    const assignedStateIds = assignments.map(a => a.stateId).filter((id): id is number => id !== null);
    const hasFullProjectAccess = assignments.some(a => a.stateId === null);

    let finalAssignedStates: any[] = [];
    if (hasFullProjectAccess || assignments.length === 0) {
      // If user has full access or no specific state restriction, get all states assigned to this project
      const projectStates = await this.prisma.projectState.findMany({
        where: { projectId },
        include: { state: true }
      });
      finalAssignedStates = projectStates.map(ps => ps.state);
    } else {
      finalAssignedStates = assignments.map(a => a.state).filter(Boolean);
    }

    const finalAssignedStateIds = finalAssignedStates.map(s => s.id);

    const where: any = {
      projectId,
      status: 'ACTIVE'
    };

    // If specific states are assigned, filter by them.
    if (finalAssignedStateIds.length > 0) {
      where.stateId = { in: finalAssignedStateIds };
    }

    // 2. Fetch all AWCs in the project (filtered by states if necessary), including full hierarchy
    const awcs = await this.prisma.awc.findMany({
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

    return {
      states: finalAssignedStates,
      awcs: awcs
    };
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

    if (ageYears >= 3 && ageYears <= 14) {
      if (!dto.schoolingStatus) {
        throw new BadRequestException(`schoolingStatus is required for children (Age: ${ageYears})`);
      }
    } else if (ageYears > 14) {
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
    const child = await this.prisma.beneficiaryChild.create({
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
    await this.recalculateGroupsForBeneficiary(beneficiaryId);
    return child;
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

  async updateFamilyMember(memberId: number, dto: any, user: any) {
    const userId = Number(user?.userId);
    if (!Number.isFinite(userId)) throw new BadRequestException('Invalid user');

    const member = await this.prisma.beneficiaryChild.findUnique({
      where: { id: memberId },
      include: { beneficiary: { select: { id: true, createdById: true } } },
    });
    if (!member) throw new NotFoundException('Family member not found');
    if (member.beneficiary.createdById !== userId) {
      throw new ForbiddenException('You can only edit family members of beneficiaries you created');
    }

    const rawDob = dto.dateOfBirth ? new Date(dto.dateOfBirth) : member.dateOfBirth;
    const today = new Date();
    let ageYears = today.getFullYear() - rawDob.getFullYear();
    const m = today.getMonth() - rawDob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < rawDob.getDate())) ageYears--;

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.relationship !== undefined) data.relationship = dto.relationship;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = rawDob;

    if (ageYears >= 3 && ageYears <= 14) {
      data.schoolingStatus = dto.schoolingStatus ?? member.schoolingStatus ?? null;
      data.employmentStatus = null;
    } else if (ageYears > 14) {
      data.employmentStatus = dto.employmentStatus ?? member.employmentStatus ?? null;
      data.schoolingStatus = null;
    } else {
      data.schoolingStatus = null;
      data.employmentStatus = null;
    }
    data.qualification = ageYears > 6 ? (dto.qualification ?? member.qualification ?? null) : null;

    const child = await this.prisma.beneficiaryChild.update({ where: { id: memberId }, data });
    await this.recalculateGroupsForBeneficiary(child.beneficiaryId);
    return child;
  }

  private calcAge(dob: Date | string | null | undefined): number {
    if (!dob) return 0;
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  async recalculateGroupsForBeneficiary(beneficiaryId: number) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      include: {
        children: true,
        groups: {
          include: { group: true }
        }
      }
    });

    if (!beneficiary) return;

    // Fetch the latest report for the main beneficiary (childId: null)
    const latestMainReport = await this.prisma.activityReport.findFirst({
      where: {
        beneficiaryId,
        childId: null
      },
      orderBy: {
        date: 'desc'
      }
    });

    const latestMainReportData = (latestMainReport?.reportData as any) || {};

    // For each child, fetch their latest report
    const childrenWithReports = await Promise.all(
      beneficiary.children.map(async (child) => {
        const latestChildReport = await this.prisma.activityReport.findFirst({
          where: {
            beneficiaryId,
            childId: child.id
          },
          orderBy: {
            date: 'desc'
          }
        });
        return {
          child,
          latestReportData: (latestChildReport?.reportData as any) || {}
        };
      })
    );

    const groupNames = new Set<string>();

    const age = this.calcAge(beneficiary.dateOfBirth);
    const gender = (beneficiary.gender || '').trim();
    const maritalStatus = beneficiary.maritalStatus;
    const latestPregnancyStatus = latestMainReportData.pregnancyStatus || '';
    const latestSamMamStatus = latestMainReportData.samMamStatus || '';

    if (beneficiary.typeof === 'Stakeholder') {
      groupNames.add('Stakeholders');
    }

    // Preserve non-system groups
    const existingGroupNames = beneficiary.groups.map(g => g.group.name);
    const systemGroupNames = [
      'Young Married Women',
      'Pregnant Women',
      'Lactating Women',
      'Adolescent Girls',
      'Adolescent Boys',
      'Children above 6(6-9 Years) - Girls',
      'Children above 6 (6-9 Years) - Boys',
      'Children below 6(3-6 Years) - Girls',
      'Children below 6(3-6 Years) - Boys',
      'Other Beneficiaries - Females',
      'Other Beneficiaries - Males',
      'SAM Children [0-5 Years]',
      'MAM Children [0-5 Years]',
      'Stakeholders'
    ];
    for (const name of existingGroupNames) {
      if (!systemGroupNames.includes(name)) {
        groupNames.add(name);
      }
    }

    // Check child under 2 status
    const hasChildUnder2 = beneficiary.children.some(c => this.calcAge(c.dateOfBirth) <= 2);

    // Evaluate main beneficiary rules
    if (gender === 'Female') {
      if (age < 6) {
        if (latestSamMamStatus === 'SAM') {
          groupNames.add('SAM Children [0-5 Years]');
        } else if (latestSamMamStatus === 'MAM') {
          groupNames.add('MAM Children [0-5 Years]');
        } else {
          groupNames.add('Children below 6(3-6 Years) - Girls');
        }
      } else if (age >= 6 && age < 10) {
        groupNames.add('Children above 6(6-9 Years) - Girls');
      } else if (
        (age >= 10 && age < 14) ||
        (age >= 14 && age < 18 && latestPregnancyStatus !== 'Currently Pregnant') ||
        (age >= 14 && age <= 18 && maritalStatus !== 'Married' && !hasChildUnder2)
      ) {
        groupNames.add('Adolescent Girls');
      }

      if (age >= 14) {
        if (maritalStatus === 'Married' && age >= 15 && age <= 24) {
          groupNames.add('Young Married Women');
        }
        if (latestPregnancyStatus === 'Currently Pregnant') {
          groupNames.add('Pregnant Women');
        }
        if (latestPregnancyStatus === 'Baby Delivered' || hasChildUnder2) {
          groupNames.add('Lactating Women');
        }

        // If she is >= 14 and does not belong to any primary female group, mark as Other Beneficiaries - Females
        const hasPrimaryGroup =
          groupNames.has('Pregnant Women') ||
          groupNames.has('Lactating Women') ||
          groupNames.has('Adolescent Girls') ||
          groupNames.has('Young Married Women');

        if (!hasPrimaryGroup) {
          groupNames.add('Other Beneficiaries - Females');
        }
      }
    } else if (gender === 'Male') {
      if (age < 6) {
        if (latestSamMamStatus === 'SAM') {
          groupNames.add('SAM Children [0-5 Years]');
        } else if (latestSamMamStatus === 'MAM') {
          groupNames.add('MAM Children [0-5 Years]');
        } else {
          groupNames.add('Children below 6(3-6 Years) - Boys');
        }
      } else if (age >= 6 && age < 10) {
        groupNames.add('Children above 6 (6-9 Years) - Boys');
      } else if (age >= 10 && age < 18) {
        groupNames.add('Adolescent Boys');
      } else if (age >= 18) {
        groupNames.add('Other Beneficiaries - Males');
      }
    }



    // Sync database
    await this.syncGroupsForBeneficiary(beneficiaryId, Array.from(groupNames));
  }

  async syncGroupsForBeneficiary(beneficiaryId: number, groupNames: string[]) {
    // 1. Get all active groups in the database matching groupNames
    const dbGroups = await this.prisma.beneficiaryGroup.findMany({
      where: { name: { in: groupNames }, status: 'ACTIVE' }
    });

    const existingGroupNames = dbGroups.map(g => g.name);
    const missingGroupNames = groupNames.filter(name => !existingGroupNames.includes(name));

    if (missingGroupNames.length > 0) {
      const systemUser = await this.prisma.user.findFirst({
        where: { email: 'superadmin@jeevansetu.com' }
      });
      const creatorId = systemUser?.id || 1;

      for (const name of missingGroupNames) {
        const newGroup = await this.prisma.beneficiaryGroup.upsert({
          where: { name },
          update: { status: 'ACTIVE' },
          create: {
            name,
            createdById: creatorId,
            status: 'ACTIVE'
          }
        });
        dbGroups.push(newGroup);
      }
    }

    const groupIds = dbGroups.map(g => g.id);

    // Sync relationships inside a transaction
    await this.prisma.$transaction(async (tx) => {
      // Delete relationships not in target groupIds
      await tx.groupMember.deleteMany({
        where: {
          beneficiaryId,
          groupId: { notIn: groupIds }
        }
      });

      // Add missing relationships
      for (const groupId of groupIds) {
        await tx.groupMember.upsert({
          where: {
            beneficiaryId_groupId: {
              beneficiaryId,
              groupId
            }
          },
          update: {},
          create: {
            beneficiaryId,
            groupId
          }
        });
      }
    });
  }
}