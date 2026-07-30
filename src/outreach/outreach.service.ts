import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutreachDynamicsService } from '../dashboard/outreach-dynamics/outreach-dynamics.service';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { RequestBeneficiaryUpdateDto } from './dto/request-beneficiary-update.dto';
import { AddFamilyMemberDto } from './dto/add-family-member.dto';

@Injectable()
export class OutreachService {
  constructor(
    private prisma: PrismaService,
    private outreachDynamics: OutreachDynamicsService,
  ) { }

  private parseDateRobust(dateVal: any): Date {
    if (!dateVal) return new Date();
    if (dateVal instanceof Date) {
      return isNaN(dateVal.getTime()) ? new Date() : dateVal;
    }
    if (typeof dateVal !== 'string') {
      return new Date();
    }
    
    const trimmed = dateVal.trim();
    
    // Check if format is DD-MM-YYYY or DD/MM/YYYY
    const ddmmyyyyPattern = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
    const match = ddmmyyyyPattern.exec(trimmed);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      const year = parseInt(match[3], 10);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Fallback to standard parser
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return new Date();
  }


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

    if (assigned) return;

    // Check shared accounts
    const shares = await this.prisma.accountShare.findMany({
      where: { toUserId: userId },
      select: { fromUserId: true }
    });

    if (shares.length > 0) {
      const sharedFromUserIds = shares.map(s => s.fromUserId);
      const sharedAssigned = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: { in: sharedFromUserIds },
          projectId: beneficiary.projectId
        },
        select: { id: true }
      });
      if (sharedAssigned) return;
    }

    throw new ForbiddenException('You are not assigned to this beneficiary');
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
        const shares = await this.prisma.accountShare.findMany({
          where: { toUserId: user.userId },
          select: { fromUserId: true }
        });
        const sharedFromUserIds = shares.map(s => s.fromUserId);
        const sharedAssigned = await this.prisma.userProjectLocation.findFirst({
          where: {
            userId: { in: sharedFromUserIds },
            projectId: dto.projectId,
            stateId: awc.stateId
          }
        });
        if (!sharedAssigned) {
          throw new ForbiddenException(
            'You are not assigned to this project or the state of this location'
          );
        }
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
        const shares = await this.prisma.accountShare.findMany({
          where: { toUserId: user.userId },
          select: { fromUserId: true }
        });
        const sharedFromUserIds = shares.map(s => s.fromUserId);
        const sharedAssigned = await this.prisma.userProjectLocation.findFirst({
          where: {
            userId: { in: sharedFromUserIds },
            projectId: dto.projectId,
          }
        });
        if (!sharedAssigned) {
          throw new ForbiddenException(
            'You are not assigned to this project'
          );
        }
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

    const reportDate = this.parseDateRobust(dto.sessionDate);

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
    await this.updateReportGroupSnapshot(report.id, dto.beneficiaryId, dto.childId || null);
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
      const shares = await this.prisma.accountShare.findMany({
        where: { toUserId: user.userId },
        select: { fromUserId: true }
      });
      const sharedFromUserIds = shares.map(s => s.fromUserId);
      if (!sharedFromUserIds.includes(report.reportedById)) {
        throw new ForbiddenException('You can only update reports that you created or are shared with you');
      }
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

    if (dto.sessionDate) dataToUpdate.date = this.parseDateRobust(dto.sessionDate);
    if (dto.activityId) dataToUpdate.activityId = dto.activityId;
    if (dto.sessionId) dataToUpdate.sessionId = dto.sessionId;
    if (dto.beneficiaryId) dataToUpdate.beneficiaryId = dto.beneficiaryId;
    if (dto.childId !== undefined) dataToUpdate.childId = dto.childId || null;

    const updated = await this.prisma.activityReport.update({
      where: { id },
      data: dataToUpdate
    });
    await this.recalculateGroupsForBeneficiary(updated.beneficiaryId);
    await this.updateReportGroupSnapshot(updated.id, updated.beneficiaryId, updated.childId || null);
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

  async getDashboardStats(user: any, projectId?: number, activityId?: number, sessionId?: number) {
    const roles = user.roles?.map(r => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isAnalyst = roles.includes('ANALYST');
    const isAdmin = roles.includes('ADMIN');
    const isManager = roles.includes('MANAGER');

    let benWhere: any = {};
    let projWhere: any = {};
    const conditions: Prisma.Sql[] = [];

    if (!isSuperAdmin) {
      if (isAnalyst) {
        if (!projectId) {
          throw new BadRequestException('projectId is required for Analyst role');
        }
        conditions.push(Prisma.sql`b."projectId" = ${projectId}`);
        benWhere.projectId = projectId;
        projWhere.id = projectId;
      } else if (isAdmin) {
        const assignments = await this.prisma.userProjectLocation.findMany({
          where: { userId: user.userId },
          select: { projectId: true }
        });
        const pIds = assignments.map(a => a.projectId);
        benWhere.projectId = { in: pIds };
        projWhere.id = { in: pIds };
        if (pIds.length > 0) {
          conditions.push(Prisma.sql`b."projectId" IN (${Prisma.join(pIds)})`);
        } else {
          conditions.push(Prisma.sql`1 = 0`); // Deny access
        }
      } else if (isManager) {
        const managedUsers = await this.prisma.user.findMany({
          where: { createdByAdminId: user.userId },
          select: { id: true }
        });
        const managedIds = [...managedUsers.map(u => u.id), user.userId];
        benWhere.createdById = { in: managedIds };
        if (managedIds.length > 0) {
          conditions.push(Prisma.sql`r."reportedById" IN (${Prisma.join(managedIds)})`);
        }
      } else {
        benWhere.createdById = user.userId;
        conditions.push(Prisma.sql`r."reportedById" = ${user.userId}`);
      }
    }

    if (activityId) conditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) conditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

    const totalBeneficiaries = await this.prisma.beneficiary.count({ where: benWhere });

    let assignedProjects = 0;
    if (isSuperAdmin) assignedProjects = await this.prisma.project.count();
    else if (isAdmin || isAnalyst) assignedProjects = await this.prisma.project.count({ where: projWhere });
    else assignedProjects = await this.prisma.userProjectLocation.count({ where: { userId: user.userId } });

    // ----------------------------------------------------
    // Outreach Dynamics Unique Counts (Analyst Logic Port)
    // ----------------------------------------------------
    let targetProjectIds: number[] = [];
    if (projectId) {
      targetProjectIds = [projectId];
    } else {
      const assignments = await this.prisma.userProjectLocation.findMany({
        where: { userId: user.userId },
        select: { projectId: true }
      });
      targetProjectIds = [...new Set(assignments.map(a => a.projectId))];
      if (targetProjectIds.length === 0) {
        const projects = await this.prisma.project.findMany({ select: { id: true } });
        targetProjectIds = projects.map(p => p.id);
      }
    }

    let reporterIds: number[] = [];
    if (isSuperAdmin || isAdmin || isAnalyst) {
      // No filter by default
    } else if (isManager) {
      const managedUsers = await this.prisma.user.findMany({
        where: { createdByAdminId: user.userId },
        select: { id: true }
      });
      reporterIds = [user.userId, ...managedUsers.map(u => u.id)];
    } else {
      reporterIds = [user.userId];
    }

    // Outreach Dynamics Unique Counts (Delegated to shared service)
    const outreachActions = await this.outreachDynamics.getStats({
      projectIds: targetProjectIds,
      reporterIds,
      creatorIds: reporterIds,
      state: undefined,
      district: undefined,
      block: undefined,
      awc: undefined
    });
    // ----------------------------------------------------

    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const statsRaw: any[] = await this.prisma.$queryRaw`
      WITH ReportData AS (
        SELECT 
          r.id,
          r."beneficiaryId" AS "beneficiaryId",
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
          AND "reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
          AND "reportData"->>'edd' IS NOT NULL
          AND "reportData"->>'edd' != '' 
          AND to_date("reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
          AND to_date("reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days'
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
            AND "childId" IS NULL 
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
      outreachActions,
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

  async getActionDetails(user: any, groupName: string, activityId?: number, sessionId?: number) {
    const roles = user.roles?.map((r: any) => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isAnalyst = roles.includes('ANALYST');
    const isAdmin = roles.includes('ADMIN');
    const isManager = roles.includes('MANAGER');

    // 1. Resolve Project IDs
    let targetProjectIds: number[] = [];
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId: user.userId },
      select: { projectId: true }
    });
    targetProjectIds = [...new Set(assignments.map(a => a.projectId))];
    if (targetProjectIds.length === 0) {
      const projects = await this.prisma.project.findMany({ select: { id: true } });
      targetProjectIds = projects.map(p => p.id);
    }
    const projectIdsStr = targetProjectIds.join(',') || '0';

    // 2. Resolve User Hierarchy Filters
    let reporterIds: number[] = [];
    if (isSuperAdmin || isAdmin || isAnalyst) {
      // No filter by default
    } else if (isManager) {
      const managedUsers = await this.prisma.user.findMany({
        where: { createdByAdminId: user.userId },
        select: { id: true }
      });
        reporterIds = [user.userId, ...managedUsers.map(u => u.id)];
    } else {
      reporterIds = [user.userId];
    }

    const clean = (groupName || '').trim().toUpperCase();

    // Check if it is one of the 8 dynamic categories
    const isDynamic = clean.includes('PREGNANT') || clean.includes('LACTATING') || clean.includes('MOTHER') ||
                     clean.includes('SAM') || clean.includes('MAM') || clean.includes('ADOLESCENT') ||
                     clean.includes('EBF') || clean.includes('CF') || clean.includes('DUE') || clean.includes('DELIVERY');

    let rawRecords: any[] = [];

    if (isDynamic) {
      rawRecords = await this.outreachDynamics.getDetails(groupName, {
        projectIds: targetProjectIds,
        reporterIds,
        creatorIds: reporterIds
      });
    } else {
      let groupCondition: Prisma.Sql;
      switch (clean) {
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

      const rbacConditions: Prisma.Sql[] = [];
      if (!isSuperAdmin) {
        if (isAdmin || isAnalyst) {
          const assignments = await this.prisma.userProjectLocation.findMany({
            where: { userId: user.userId },
            select: { projectId: true }
          });
          const pIds = assignments.map(a => a.projectId);
          if (pIds.length > 0) {
            rbacConditions.push(Prisma.sql`b."projectId" IN (${Prisma.join(pIds)})`);
          } else {
            rbacConditions.push(Prisma.sql`1 = 0`);
          }
        } else if (isManager) {
          const managedUsers = await this.prisma.user.findMany({
            where: { createdByAdminId: user.userId },
            select: { id: true }
          });
          const managedIds = [...managedUsers.map(u => u.id), user.userId];
          if (managedIds.length > 0) {
            rbacConditions.push(Prisma.sql`r."reportedById" IN (${Prisma.join(managedIds)})`);
          }
        } else {
          rbacConditions.push(Prisma.sql`r."reportedById" = ${user.userId}`);
        }
      }

      if (activityId) rbacConditions.push(Prisma.sql`r."activityId" = ${activityId}`);
      if (sessionId) rbacConditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

      const rbacWhereClause = rbacConditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(rbacConditions, ' AND ')}` : Prisma.empty;

      const fallbackRecords: any[] = await this.prisma.$queryRaw`
        WITH ReportData AS (
          SELECT 
            r.id AS "reportId",
            r."beneficiaryId" AS "benIntId",
            r."childId" AS "childIntId",
            COALESCE(r."childId", r."beneficiaryId") AS "uniqueEntityId",
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
        SELECT * FROM (
          SELECT DISTINCT ON ("uniqueEntityId")
            "reportId",
            "beneficiaryId" AS id,
            "benIntId" AS "benId",
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
          ORDER BY "uniqueEntityId", "reportingDate" DESC
        ) AS unique_records
        ORDER BY "reportingDate" DESC
        LIMIT 100;
      `;
      rawRecords = fallbackRecords;
    }

    return rawRecords.map(record => ({
      id: record.id,
      benId: record.benId ? Number(record.benId) : null,
      name: record.name,
      group: record.group,
      awc: record.awc,
      project: record.project || 'N/A',
      gender: record.gender || 'N/A',
      guardianName: record.guardianName || 'N/A',
      activity: record.activity || 'N/A',
      session: record.session || 'N/A',
      reportingDate: record.reportingDate ? new Date(record.reportingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      age: record.age || 'N/A',
      childNameAndAge: record.childNameAndAge || 'N/A'
    }));
  }

  async getMyReports(user: any, projectId?: number) {
    const roles = user.roles?.map(r => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isAnalyst = roles.includes('ANALYST');
    const isAdmin = roles.includes('ADMIN');
    const isManager = roles.includes('MANAGER');

    let where: any = {};

    if (!isSuperAdmin) {
      if (isAnalyst) {
        if (!projectId) {
          throw new BadRequestException('projectId is required for Analyst role');
        }
        where.beneficiary = { projectId };
      } else if (isAdmin) {
        const assignments = await this.prisma.userProjectLocation.findMany({
          where: { userId: user.userId },
          select: { projectId: true }
        });
        where.beneficiary = { projectId: { in: assignments.map(a => a.projectId) } };
      } else if (isManager) {
        const managedUsers = await this.prisma.user.findMany({
          where: { createdByAdminId: user.userId },
          select: { id: true }
        });
        const managedIds = managedUsers.map(u => u.id);
        where.reportedById = { in: [...managedIds, user.userId] };
      } else {
        const shares = await this.prisma.accountShare.findMany({
          where: { toUserId: user.userId },
          select: { fromUserId: true }
        });
        const sharedFromUserIds = shares.map(s => s.fromUserId);
        where.reportedById = { in: [user.userId, ...sharedFromUserIds] };
      }
    }

    return this.prisma.activityReport.findMany({
      where,
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
            gender: true,
            childGroups: {
              include: {
                group: true
              }
            }
          }
        },
        activity: { select: { name: true } },
        session: { select: { name: true } },
        reportedBy: {
          select: {
            id: true,
            name: true
          }
        }
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
  async getBeneficiaryList(user: any, search?: string, projectId?: number) {
    const roles = user.roles?.map(r => r.role?.name || r.name) || [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isAnalyst = roles.includes('ANALYST');
    const isAdmin = roles.includes('ADMIN');
    const isManager = roles.includes('MANAGER');

    let where: any = {};

    if (!isSuperAdmin) {
      if (isAnalyst) {
        if (!projectId) {
          const assignments = await this.prisma.userProjectLocation.findMany({
            where: { userId: user.userId },
            select: { projectId: true }
          });
          where.projectId = { in: [...new Set(assignments.map(a => a.projectId))] };
        } else {
          where.projectId = projectId;
        }
      } else if (isAdmin) {
        const assignments = await this.prisma.userProjectLocation.findMany({
          where: { userId: user.userId },
          select: { projectId: true }
        });
        where.projectId = { in: assignments.map(a => a.projectId) };
      } else if (isManager) {
        const managedUsers = await this.prisma.user.findMany({
          where: { createdByAdminId: user.userId },
          select: { id: true }
        });
        const managedIds = managedUsers.map(u => u.id);
        where.createdById = { in: [...managedIds, user.userId] };
      } else {
        // Outreach workers only see beneficiaries they personally registered or are shared with them
        const shares = await this.prisma.accountShare.findMany({
          where: { toUserId: user.userId },
          select: { fromUserId: true }
        });
        const sharedFromUserIds = shares.map(s => s.fromUserId);
        where.createdById = { in: [user.userId, ...sharedFromUserIds] };
      }
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
        children: {
          include: {
            childGroups: {
              include: { group: true }
            }
          }
        },
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
        children: {
          include: {
            childGroups: {
              include: { group: true }
            }
          }
        },
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

  async getReportsByBeneficiary(beneficiaryId: number) {
    const beneficiary = await this.prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true },
    });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');

    return this.prisma.activityReport.findMany({
      where: { beneficiaryId },
      include: {
        activity: true,
        session: true,
        child: true,
      },
      orderBy: { date: 'desc' },
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
      const shares = await this.prisma.accountShare.findMany({
        where: { toUserId: userId },
        select: { fromUserId: true }
      });
      const sharedFromUserIds = shares.map(s => s.fromUserId);
      if (!sharedFromUserIds.includes(member.beneficiary.createdById)) {
        throw new ForbiddenException('You can only edit family members of beneficiaries you created or are shared with you');
      }
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

    // Fetch all reports for the main beneficiary (childId: null) to find the most recent non-empty statuses
    const mainReports = await this.prisma.activityReport.findMany({
      where: {
        beneficiaryId,
        childId: null
      },
      orderBy: {
        date: 'desc'
      },
      select: {
        reportData: true
      }
    });

    let latestPregnancyStatus = '';
    let latestSamMamStatus = '';

    for (const report of mainReports) {
      const data = (report.reportData as any) || {};
      if (!latestPregnancyStatus && data.pregnancyStatus) {
        latestPregnancyStatus = data.pregnancyStatus;
      }
      if (!latestSamMamStatus && data.samMamStatus) {
        latestSamMamStatus = data.samMamStatus;
      }
      if (latestPregnancyStatus && latestSamMamStatus) {
        break; // Both found, no need to look further back
      }
    }

    // We no longer fetch all reports for children since the group logic does not use it.

    const groupNames = new Set<string>();

    const age = this.calcAge(beneficiary.dateOfBirth);
    const gender = (beneficiary.gender || '').trim();
    const maritalStatus = beneficiary.maritalStatus;

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
      'Stakeholders',
      'Infant',
      'Toddler'
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
        } else if (age < 1) {
          groupNames.add('Infant');
        } else if (age >= 1 && age < 3) {
          groupNames.add('Toddler');
        } else if (age >= 3) {
          groupNames.add('Children below 6(3-6 Years) - Girls');
        }
      } else if (age >= 6 && age < 10) {
        groupNames.add('Children above 6(6-9 Years) - Girls');
      } else if (
        (age >= 10 && age < 14) ||
        (age >= 14 && age <= 19 && latestPregnancyStatus !== 'Currently Pregnant') ||
        (age >= 14 && age <= 19 && maritalStatus !== 'Married' && !hasChildUnder2)
      ) {
        groupNames.add('Adolescent Girls');
      }

      if (age >= 14) {
        if (
          maritalStatus === 'Married' &&
          age >= 15 &&
          age <= 24 &&
          latestPregnancyStatus !== 'Currently Pregnant' &&
          latestPregnancyStatus !== 'Baby Delivered' &&
          !hasChildUnder2
        ) {
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
        } else if (age < 1) {
          groupNames.add('Infant');
        } else if (age >= 1 && age < 3) {
          groupNames.add('Toddler');
        } else if (age >= 3) {
          groupNames.add('Children below 6(3-6 Years) - Boys');
        }
      } else if (age >= 6 && age < 10) {
        groupNames.add('Children above 6 (6-9 Years) - Boys');
      } else if (age >= 10 && age <= 19) {
        groupNames.add('Adolescent Boys');
      } else if (age > 19) {
        groupNames.add('Other Beneficiaries - Males');
      }
    }



    // Sync database for primary beneficiary
    await this.syncGroupsForBeneficiary(beneficiaryId, Array.from(groupNames));

    // Evaluate children rules
    for (const child of beneficiary.children) {
      const childGroupNames = new Set<string>();
      const childAge = this.calcAge(child.dateOfBirth);
      const childGender = (child.gender || '').trim();

      // Fetch all reports for this specific child to find the most recent non-empty statuses
      const childReports = await this.prisma.activityReport.findMany({
        where: {
          beneficiaryId,
          childId: child.id
        },
        orderBy: {
          date: 'desc'
        },
        select: {
          reportData: true
        }
      });

      let childSamMamStatus = '';

      for (const report of childReports) {
        const data = (report.reportData as any) || {};
        if (data.samMamStatus) {
          childSamMamStatus = data.samMamStatus;
          break; // Found the latest non-empty status
        }
      }

      if (childGender === 'Female') {
        if (childAge < 6) {
          if (childSamMamStatus === 'SAM') childGroupNames.add('SAM Children [0-5 Years]');
          else if (childSamMamStatus === 'MAM') childGroupNames.add('MAM Children [0-5 Years]');
          else if (childAge < 1) childGroupNames.add('Infant');
          else if (childAge >= 1 && childAge < 3) childGroupNames.add('Toddler');
          else if (childAge >= 3) childGroupNames.add('Children below 6(3-6 Years) - Girls');
        } else if (childAge >= 6 && childAge < 10) {
          childGroupNames.add('Children above 6(6-9 Years) - Girls');
        } else if (childAge >= 10 && childAge <= 19) {
          childGroupNames.add('Adolescent Girls');
        } else if (childAge >= 20) {
          childGroupNames.add('Other Beneficiaries - Females');
        }
      } else if (childGender === 'Male') {
        if (childAge < 6) {
          if (childSamMamStatus === 'SAM') childGroupNames.add('SAM Children [0-5 Years]');
          else if (childSamMamStatus === 'MAM') childGroupNames.add('MAM Children [0-5 Years]');
          else if (childAge < 1) childGroupNames.add('Infant');
          else if (childAge >= 1 && childAge < 3) childGroupNames.add('Toddler');
          else if (childAge >= 3) childGroupNames.add('Children below 6(3-6 Years) - Boys');
        } else if (childAge >= 6 && childAge < 10) {
          childGroupNames.add('Children above 6 (6-9 Years) - Boys');
        } else if (childAge >= 10 && childAge <= 19) {
          childGroupNames.add('Adolescent Boys');
        } else if (childAge >= 20) {
          childGroupNames.add('Other Beneficiaries - Males');
        }
      }

      // Sync database for child
      await this.syncGroupsForChild(child.id, Array.from(childGroupNames));
    }
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

  async syncGroupsForChild(childId: number, groupNames: string[]) {
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

    await this.prisma.$transaction(async (tx) => {
      await tx.childGroupMember.deleteMany({
        where: {
          childId,
          groupId: { notIn: groupIds }
        }
      });

      for (const groupId of groupIds) {
        await tx.childGroupMember.upsert({
          where: {
            childId_groupId: {
              childId,
              groupId
            }
          },
          update: {},
          create: {
            childId,
            groupId
          }
        });
      }
    });
  }

  private async updateReportGroupSnapshot(reportId: number, beneficiaryId: number, childId: number | null) {
    const report = await this.prisma.activityReport.findUnique({ where: { id: reportId } });
    if (!report) return;

    let newGroupString = 'N/A';

    if (childId) {
      const childGroups = await this.prisma.childGroupMember.findMany({
        where: { childId },
        include: { group: true }
      });
      if (childGroups.length > 0) {
        newGroupString = childGroups.map((g: any) => g.group.name).join(', ');
      }
    } else {
      const mainGroups = await this.prisma.groupMember.findMany({
        where: { beneficiaryId },
        include: { group: true }
      });
      if (mainGroups.length > 0) {
        newGroupString = mainGroups.map((g: any) => g.group.name).join(', ');
      }
    }

    const currentData = (report.reportData as any) || {};
    if (currentData.group !== newGroupString) {
      await this.prisma.activityReport.update({
        where: { id: reportId },
        data: {
          reportData: {
            ...currentData,
            group: newGroupString
          }
        }
      });
    }
  }
}