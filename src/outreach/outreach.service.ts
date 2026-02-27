import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';

@Injectable()
export class OutreachService {
  constructor(private prisma: PrismaService) { }
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
      where: { id: dto.projectId }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

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
    return this.prisma.approvalRequest.create({
      data: {
        requestType: dto.type,
        payload: dto.data,
        requestedById: user.userId
      }
    });
  }

  async requestBeneficiaryUpdate(id: number, dto: UpdateBeneficiaryDto, user) {

    // check beneficiary exists
    const ben = await this.prisma.beneficiary.findUnique({
      where: { id }
    });

    if (!ben) throw new NotFoundException('Beneficiary not found');

    // Generic find creator logic or specific to user
    const requester = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { createdByAdminId: true }
    });

    // store request
    return this.prisma.approvalRequest.create({
      data: {
        requestType: 'UPDATE_BENEFICIARY',
        payload: {
          beneficiaryId: id,
          changes: dto as any
        },
        requestedById: user.userId,
        targetAdminId: requester?.createdByAdminId,
        status: 'PENDING'
      }
    });
  }

  async getMyRequests(userId: number) {
    return this.prisma.approvalRequest.findMany({
      where: {
        requestedById: userId
      },
      include: {
        approvedBy: {
          select: {
            name: true,
            email: true
          }
        },
        targetAdmin: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }


  //report
  async submitReport(dto: CreateReportDto, user: any) {

    // 1. Validate beneficiary
    const ben = await this.prisma.beneficiary.findUnique({
      where: { id: dto.beneficiaryId }
    });
    if (!ben) throw new NotFoundException('Beneficiary not found');

    // 2. Validate activity
    const activity = await this.prisma.activity.findUnique({
      where: { id: dto.activityId }
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // 3. Validate session
    const session = await this.prisma.session.findUnique({
      where: { id: dto.sessionId }
    });
    if (!session) throw new NotFoundException('Session not found');

    // 4. Prevent duplicate report
    const exists = await this.prisma.activityReport.findFirst({
      where: {
        beneficiaryId: dto.beneficiaryId,
        activityId: dto.activityId,
        sessionId: dto.sessionId
      }
    });

    if (exists) {
      throw new ConflictException('Report already submitted');
    }

    // 5. Save report
    return this.prisma.activityReport.create({
      data: {
        beneficiaryId: dto.beneficiaryId,
        activityId: dto.activityId,
        sessionId: dto.sessionId,
        reportedById: user.userId,
        reportData: dto.reportData
      }
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
        throw new NotFoundException('No assignments found for this user');
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
  async tagBeneficiaryGroup(beneficiaryId: number, groupId: number) {
    console.log('tagBeneficiaryGroup called with:', { beneficiaryId, groupId, typeBen: typeof beneficiaryId, typeGroup: typeof groupId });
    return this.prisma.groupMember.create({
      data: {
        beneficiaryId: Number(beneficiaryId),
        groupId: Number(groupId)
      }
    });
  }

  async tagBeneficiaryActivity(beneficiaryId: number, activityId: number, sessionId: number) {
    return this.prisma.beneficiaryActivity.create({
      data: {
        beneficiaryId,
        activityId,
        sessionId
      }
    });
  }

  // Helpers
  async getGroups() {
    return this.prisma.beneficiaryGroup.findMany({
      where: { status: 'ACTIVE' }
    });
  }

  async getActivities() {
    return this.prisma.activity.findMany({
      where: { status: 'ACTIVE' }
    });
  }

  async getSessions(activityId: number) {
    return this.prisma.session.findMany({
      where: { activityId, status: 'ACTIVE' }
    });
  }

  async getBeneficiary(id: number) {
    return this.prisma.beneficiary.findUnique({
      where: { id },
      include: {
        project: true,
        location: true,
        groups: { include: { group: true } },
        activities: { include: { activity: true, session: true } }
      }
    });
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
