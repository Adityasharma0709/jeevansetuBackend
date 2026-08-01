import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OutreachDynamicsService } from '../dashboard/outreach-dynamics/outreach-dynamics.service';
import { CoverageDashboardService } from '../dashboard/coverage-dashboard/coverage-dashboard.service';

@Injectable()
export class AnalystService {
  constructor(
    private prisma: PrismaService,
    private outreachDynamics: OutreachDynamicsService,
    private coverageDashboard: CoverageDashboardService,
  ) {}

  async getDashboardReports(userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) return [];

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    return this.prisma.activityReport.findMany({
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
        child: true,
        reportedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        activity: true,
        session: true,
      },
    });
  }

  async getDashboardStats(
    userId: number,
    projectId?: number,
    activityId?: number,
    sessionId?: number,
    adminId?: number,
    managerId?: number,
    workerId?: number,
    year?: string,
    month?: string,
    state?: string,
    district?: string,
    block?: string,
    awc?: string,
    unique?: boolean,
  ) {
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
        activities: []
      };
    }

    const assignedProjectIds = [...new Set(assignments.map(a => a.projectId))];
    const targetProjectIds = projectId ? [projectId] : assignedProjectIds;
    const targetProjectIdsStr = targetProjectIds.join(',');

    // 1. Resolve User Hierarchy Filters
    let reporterIds: number[] = [];
    if (workerId) {
      reporterIds = [workerId];
    } else if (managerId) {
      const workers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: managerId,
          roles: { some: { role: { name: 'OUTREACH' } } }
        },
        select: { id: true }
      });
      reporterIds = [managerId, ...workers.map(w => w.id)];
    } else if (adminId) {
      const managers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: adminId,
          roles: { some: { role: { name: 'MANAGER' } } }
        },
        select: { id: true }
      });
      const managerIds = managers.map(m => m.id);
      let workerIds: number[] = [];
      if (managerIds.length > 0) {
        const workers = await this.prisma.user.findMany({
          where: {
            createdByAdminId: { in: managerIds },
            roles: { some: { role: { name: 'OUTREACH' } } }
          },
          select: { id: true }
        });
        workerIds = workers.map(w => w.id);
      }
      reporterIds = [adminId, ...managerIds, ...workerIds];
    }

    const hasReporterFilter = reporterIds.length > 0;
    const reporterFilterStr = hasReporterFilter ? `AND r."reportedById" IN (${reporterIds.join(',')})` : '';
    const creatorFilterStr = hasReporterFilter ? `AND b."createdById" IN (${reporterIds.join(',')})` : '';

    // 2. Resolve Location Filters
    const escapeStr = (val: string) => val.replace(/'/g, "''");
    let locFilterStr = '';
    if (state && state !== 'ALL') {
      locFilterStr += ` AND LOWER(b.state) = LOWER('${escapeStr(state)}')`;
    }
    if (district && district !== 'ALL') {
      locFilterStr += ` AND LOWER(b.district) = LOWER('${escapeStr(district)}')`;
    }
    if (block && block !== 'ALL') {
      locFilterStr += ` AND LOWER(b.block) = LOWER('${escapeStr(block)}')`;
    }
    if (awc && awc !== 'ALL') {
      locFilterStr += ` AND LOWER(a."awcName") = LOWER('${escapeStr(awc)}')`;
    }

    // 3. Calculate General Stats (Registry snapshot matching filters)
    const beneficiaryWhere: any = {
      projectId: { in: targetProjectIds }
    };
    if (state && state !== 'ALL') beneficiaryWhere.state = { equals: state, mode: 'insensitive' };
    if (district && district !== 'ALL') beneficiaryWhere.district = { equals: district, mode: 'insensitive' };
    if (block && block !== 'ALL') beneficiaryWhere.block = { equals: block, mode: 'insensitive' };
    if (awc && awc !== 'ALL') beneficiaryWhere.awc = { awcName: { equals: awc, mode: 'insensitive' } };
    if (hasReporterFilter) beneficiaryWhere.createdById = { in: reporterIds };

    const totalBeneficiaries = await this.prisma.beneficiary.count({
      where: beneficiaryWhere
    });

    const assignedProjects = targetProjectIds.length;

    // 4. Count Outreach Dynamics (Delegated to shared service)
    const outreachActions = await this.outreachDynamics.getStats({
      projectIds: targetProjectIds,
      reporterIds,
      creatorIds: reporterIds,
      state,
      district,
      block,
      awc
    });

    // 5. Coverage Dashboard Stats (Delegated to CoverageDashboardService)
    const row = await this.coverageDashboard.getStats({
      projectIds: targetProjectIds,
      reporterIds: hasReporterFilter ? reporterIds : undefined,
      activityId,
      sessionId,
      state,
      district,
      block,
      awc,
      year,
      month,
      unique
    });

    const toNumber = (val: any) => val ? Number(val) : 0;

    return {
      totalBeneficiaries,
      assignedProjects,
      assignedLocations: 0,
      totalReports: toNumber(row.totalReports),
      outreachActions,
      episodesOfCare: [
        { label: 'Adults (>19 Years)', male: toNumber(row.adultsMale), female: toNumber(row.adultsFemale), others: toNumber(row.adultsOthers), total: toNumber(row.adults) },
        { label: 'Adolescents (10-19 Years)', male: toNumber(row.adolescentsMale), female: toNumber(row.adolescentsFemale), others: toNumber(row.adolescentsOthers), total: toNumber(row.adolescents) },
        { label: 'Children (0-5 Years)', male: toNumber(row.childrenUnder5Male), female: toNumber(row.childrenUnder5Female), others: toNumber(row.childrenUnder5Others), total: toNumber(row.childrenUnder5) },
        { label: 'Children (6-9 Years)', male: toNumber(row.children6To10Male), female: toNumber(row.children6To10Female), others: toNumber(row.children6To10Others), total: toNumber(row.children6To10) }
      ],
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
        { label: 'OTHER BENEFICIARIES', count: toNumber(row.otherBeneficiaries), countColor: 'text-gray-900' },
      ]
    };
  }

  async getOutreachDynamicsDetails(
    userId: number,
    groupName: string,
    adminId?: number,
    managerId?: number,
    workerId?: number,
    state?: string,
    district?: string,
    block?: string,
    awc?: string,
  ) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) return [];

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    // 1. Resolve User Hierarchy Filters
    let reporterIds: number[] = [];
    if (workerId) {
      reporterIds = [workerId];
    } else if (managerId) {
      const workers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: managerId,
          roles: { some: { role: { name: 'OUTREACH' } } }
        },
        select: { id: true }
      });
      reporterIds = [managerId, ...workers.map(w => w.id)];
    } else if (adminId) {
      const managers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: adminId,
          roles: { some: { role: { name: 'MANAGER' } } }
        },
        select: { id: true }
      });
      const managerIds = managers.map(m => m.id);
      let workerIds: number[] = [];
      if (managerIds.length > 0) {
        const workers = await this.prisma.user.findMany({
          where: {
            createdByAdminId: { in: managerIds },
            roles: { some: { role: { name: 'OUTREACH' } } }
          },
          select: { id: true }
        });
        workerIds = workers.map(w => w.id);
      }
      reporterIds = [adminId, ...managerIds, ...workerIds];
    }

    const rawRecords = await this.outreachDynamics.getDetails(groupName, {
      projectIds,
      reporterIds,
      creatorIds: reporterIds,
      state,
      district,
      block,
      awc
    });

    return rawRecords.map(record => ({
      id: record.id,
      benId: record.benId ? Number(record.benId) : null,
      name: record.name,
      group: record.group,
      awc: record.awc || 'N/A',
      project: record.project || 'N/A',
      gender: record.gender || 'N/A',
      guardianName: record.guardianName || 'N/A',
      activity: record.activity || 'N/A',
      session: record.session || 'N/A',
      reportingDate: record.reportingDate && !isNaN(Date.parse(record.reportingDate))
        ? new Date(record.reportingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'N/A',
      age: record.age,
      childNameAndAge: record.childNameAndAge || 'N/A',
      beneficiaryType: record.beneficiaryType || 'N/A',
      district: record.district || 'N/A',
      block: record.block || 'N/A',
      village: record.village || 'N/A',
      school: 'N/A',
      motherName: record.motherName || 'N/A',
    }));
  }

  async getActivityDemographicsDetails(
    userId: number,
    groupName: string,
    activityId?: number,
    sessionId?: number,
    adminId?: number,
    managerId?: number,
    workerId?: number,
    year?: string,
    month?: string,
    state?: string,
    district?: string,
    block?: string,
    awc?: string,
    unique?: boolean,
  ) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) return [];

    const projectIds = [...new Set(assignments.map(a => a.projectId))];
    const projectIdsStr = projectIds.join(',');

    const conditions: string[] = [
      `b."projectId" IN (${projectIdsStr})`
    ];

    if (activityId) conditions.push(`r."activityId" = ${activityId}`);
    if (sessionId) conditions.push(`r."sessionId" = ${sessionId}`);

    let reporterIds: number[] = [];
    if (workerId) {
      reporterIds = [workerId];
    } else if (managerId) {
      const workers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: managerId,
          roles: { some: { role: { name: 'OUTREACH' } } }
        },
        select: { id: true }
      });
      reporterIds = [managerId, ...workers.map(w => w.id)];
    } else if (adminId) {
      const managers = await this.prisma.user.findMany({
        where: {
          createdByAdminId: adminId,
          roles: { some: { role: { name: 'MANAGER' } } }
        },
        select: { id: true }
      });
      const managerIds = managers.map(m => m.id);
      let workerIds: number[] = [];
      if (managerIds.length > 0) {
        const workers = await this.prisma.user.findMany({
          where: {
            createdByAdminId: { in: managerIds },
            roles: { some: { role: { name: 'OUTREACH' } } }
          },
          select: { id: true }
        });
        workerIds = workers.map(w => w.id);
      }
      reporterIds = [adminId, ...managerIds, ...workerIds];
    }

    if (reporterIds.length > 0) {
      conditions.push(`r."reportedById" IN (${reporterIds.join(',')})`);
    }

    const escapeStr = (val: string) => val.replace(/'/g, "''");

    if (state && state !== 'ALL') {
      conditions.push(`LOWER(b.state) = LOWER('${escapeStr(state)}')`);
    }
    if (district && district !== 'ALL') {
      conditions.push(`LOWER(b.district) = LOWER('${escapeStr(district)}')`);
    }
    if (block && block !== 'ALL') {
      conditions.push(`LOWER(b.block) = LOWER('${escapeStr(block)}')`);
    }
    if (awc && awc !== 'ALL') {
      conditions.push(`LOWER(a."awcName") = LOWER('${escapeStr(awc)}')`);
    }

    if (year && year !== 'ALL') {
      conditions.push(`EXTRACT(YEAR FROM r.date) = ${Number(year)}`);
    }
    if (month && month !== 'ALL') {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mIdx = months.indexOf(month.toLowerCase()) + 1;
      if (mIdx > 0) {
        conditions.push(`EXTRACT(MONTH FROM r.date) = ${mIdx}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let groupCondition = '1=1';
    const gName = (groupName || '').trim().toUpperCase();

    const pregnantWomenCond = `r."childId" IS NULL AND r."reportData"->>'pregnancyStatus' = 'Currently Pregnant'`;
    const lactatingWomenCond = `
      r."childId" IS NULL AND EXISTS (
        SELECT 1 FROM "BeneficiaryChild" c_sub
        WHERE c_sub."beneficiaryId" = r."beneficiaryId"
          AND c_sub."dateOfBirth" > r.date - INTERVAL '2 years'
      )
    `;
    const mam0to5Cond = `r."childId" IS NOT NULL AND r."reportData"->>'samMamStatus' = 'MAM' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) <= 5`;
    const sam0to5Cond = `r."childId" IS NOT NULL AND r."reportData"->>'samMamStatus' = 'SAM' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) <= 5`;
    const youngMarriedWomenCond = `
      r."childId" IS NULL 
      AND LOWER(TRIM(b.gender)) = 'female' 
      AND b."maritalStatus" = 'Married' 
      AND EXTRACT(YEAR FROM AGE(r.date, b."dateOfBirth")) BETWEEN 15 AND 24 
      AND (r."reportData"->>'pregnancyStatus' IS NULL OR r."reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
    `;
    const infantsLessThan1Cond = `r."childId" IS NOT NULL AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 1`;
    const toddlers1To3Cond = `r."childId" IS NOT NULL AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) >= 1 AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 3`;
    const childrenBelow6GirlsCond = `r."childId" IS NOT NULL AND LOWER(TRIM(c.gender)) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) >= 3 AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 6`;
    const childrenBelow6BoysCond = `r."childId" IS NOT NULL AND LOWER(TRIM(c.gender)) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) >= 3 AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 6`;
    const childrenAbove6GirlsCond = `r."childId" IS NOT NULL AND LOWER(TRIM(c.gender)) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) >= 6 AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 10`;
    const childrenAbove6BoysCond = `r."childId" IS NOT NULL AND LOWER(TRIM(c.gender)) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) >= 6 AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 10`;
    const adolescentGirlsCond = `LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19`;
    const adolescentBoysCond = `LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19`;
    const stakeholdersCond = `LOWER(TRIM(b."typeof")) = 'stakeholder'`;

    const otherBeneficiariesCond = `
      NOT (${pregnantWomenCond}
        OR ${lactatingWomenCond}
        OR ${mam0to5Cond}
        OR ${sam0to5Cond}
        OR ${youngMarriedWomenCond}
        OR ${infantsLessThan1Cond}
        OR ${toddlers1To3Cond}
        OR ${childrenBelow6GirlsCond}
        OR ${childrenBelow6BoysCond}
        OR ${childrenAbove6GirlsCond}
        OR ${childrenAbove6BoysCond}
        OR ${adolescentGirlsCond}
        OR ${adolescentBoysCond}
        OR ${stakeholdersCond})
    `;

    switch (gName) {
      case 'PREGNANT WOMEN':
        groupCondition = pregnantWomenCond;
        break;
      case 'LACTATING WOMEN':
        groupCondition = lactatingWomenCond;
        break;
      case 'MAM (0-5)':
        groupCondition = mam0to5Cond;
        break;
      case 'SAM (0-5)':
        groupCondition = sam0to5Cond;
        break;
      case 'YOUNG MARRIED WOMEN':
        groupCondition = youngMarriedWomenCond;
        break;
      case 'INFANT':
        groupCondition = infantsLessThan1Cond;
        break;
      case 'TODDLER':
        groupCondition = toddlers1To3Cond;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - GIRLS':
        groupCondition = childrenBelow6GirlsCond;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - BOYS':
        groupCondition = childrenBelow6BoysCond;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - GIRLS':
        groupCondition = childrenAbove6GirlsCond;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - BOYS':
        groupCondition = childrenAbove6BoysCond;
        break;
      case 'ADOLESCENT GIRLS':
        groupCondition = adolescentGirlsCond;
        break;
      case 'ADOLESCENT BOYS':
        groupCondition = adolescentBoysCond;
        break;
      case 'STAKEHOLDERS':
        groupCondition = stakeholdersCond;
        break;
      case 'OTHER BENEFICIARIES':
        groupCondition = otherBeneficiariesCond;
        break;
      default:
        groupCondition = '1=1';
        break;
    }

    const selectQuery = `
      SELECT * FROM (
        SELECT ${unique ? 'DISTINCT ON (COALESCE(r."childId", r."beneficiaryId"))' : ''}
          r.id AS "reportId",
          r."beneficiaryId" AS "benIntId",
          r."childId" AS "childIntId",
          COALESCE(r."childId", r."beneficiaryId") AS "uniqueEntityId",
          r.date AS "reportingDate",
          COALESCE(c.uid, b.uid) AS "beneficiaryId",
          COALESCE(c.name, b.name) AS "beneficiaryName",
          b."typeof",
          a."awcName" AS awc,
          p.name AS project,
          act.name AS activity,
          sess.name AS session,
          r."reportData",
          COALESCE(c.gender, b.gender) AS gender,
          b."maritalStatus",
          EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
          (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months,
          COALESCE(b.district, 'N/A') AS district,
          COALESCE(b.block, 'N/A') AS block,
          COALESCE(b.village, 'N/A') AS village,
          'N/A' AS school,
          CASE WHEN r."childId" IS NOT NULL THEN b.name ELSE 'N/A' END AS "motherName"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p ON b."projectId" = p.id
        LEFT JOIN "Activity" act ON r."activityId" = act.id
        LEFT JOIN "Session" sess ON r."sessionId" = sess.id
        ${whereClause}
        ${whereClause ? 'AND' : 'WHERE'} ${groupCondition}
        ORDER BY ${unique ? 'COALESCE(r."childId", r."beneficiaryId"), r.date DESC' : 'r.date DESC'}
      ) sub
      ORDER BY "reportingDate" DESC;
    `;

    const rawRecords: any[] = await this.prisma.$queryRawUnsafe(selectQuery);

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
        id: record.beneficiaryId,
        benId: record.benIntId ? Number(record.benIntId) : null,
        reportId: record.reportId,
        name: record.beneficiaryName,
        group: groupName,
        awc: record.awc,
        project: record.project || 'N/A',
        gender: record.gender || 'N/A',
        guardianName: record.motherName || 'N/A',
        activity: record.activity || 'N/A',
        session: record.session || 'N/A',
        reportingDate: record.reportingDate && !isNaN(Date.parse(record.reportingDate))
          ? new Date(record.reportingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'N/A',
        age: ageStr,
        childNameAndAge: 'N/A',
        beneficiaryType: record.typeof || 'N/A',
        district: record.district || 'N/A',
        block: record.block || 'N/A',
        village: record.village || 'N/A',
        school: 'N/A',
        motherName: record.motherName || 'N/A',
      };
    });
  }

  async getActivities() {
    return this.prisma.activity.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  async getSessions(activityId: number) {
    return this.prisma.session.findMany({
      where: { activityId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  async getDashboardUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              name: { in: ['ADMIN', 'MANAGER', 'OUTREACH'] }
            }
          }
        }
      },
      select: {
        id: true,
        name: true,
        createdByAdminId: true,
        roles: {
          select: {
            role: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    const admins: any[] = [];
    const managers: any[] = [];
    const workers: any[] = [];

    users.forEach(u => {
      const isOutreach = u.roles.some(ur => ur.role.name === 'OUTREACH');
      const isManager = u.roles.some(ur => ur.role.name === 'MANAGER');
      const isAdmin = u.roles.some(ur => ur.role.name === 'ADMIN');

      const mappedUser = {
        id: u.id,
        name: u.name,
        createdByAdminId: u.createdByAdminId
      };

      if (isOutreach) {
        workers.push(mappedUser);
      } else if (isManager) {
        managers.push(mappedUser);
      } else if (isAdmin) {
        admins.push(mappedUser);
      }
    });

    return { admins, managers, workers };
  }

  async getAssignedLocations(projectId: number, userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId, projectId },
      include: { state: true }
    });

    const assignedStateIds = assignments.map(a => a.stateId).filter((id): id is number => id !== null);
    const hasFullProjectAccess = assignments.some(a => a.stateId === null);

    let finalAssignedStates: any[] = [];
    if (hasFullProjectAccess || assignments.length === 0) {
      const projectStates = await this.prisma.projectState.findMany({
        where: { projectId },
        include: { state: true }
      });
      finalAssignedStates = projectStates.map(ps => ps.state);
    } else {
      finalAssignedStates = await this.prisma.state.findMany({
        where: { id: { in: assignedStateIds } }
      });
    }

    const awcs = await this.prisma.awc.findMany({
      where: { projectId },
      include: {
        state: true,
        district: true,
        block: true,
        village: true,
      },
      orderBy: { awcName: 'asc' }
    });

    return {
      states: finalAssignedStates,
      awcs: awcs
    };
  }

  async getBeneficiaryList(userId: number, search?: string, projectId?: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      return [];
    }

    const assignedProjectIds = [...new Set(assignments.map(a => a.projectId))];
    const targetProjectIds = projectId ? [projectId] : assignedProjectIds;

    if (projectId && !assignedProjectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const where: any = {
      projectId: { in: targetProjectIds },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { uid: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.beneficiary.findMany({
      where,
      orderBy: { name: 'asc' },
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
    });
  }

  async getBeneficiary(id: number, userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const projectIds = [...new Set(assignments.map(a => a.projectId))];

    const beneficiary = await this.prisma.beneficiary.findFirst({
      where: {
        id,
        projectId: { in: projectIds },
      },
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

  async getFamilyMembers(beneficiaryId: number, userId: number) {
    const beneficiary = await this.getBeneficiary(beneficiaryId, userId);
    return beneficiary.children || [];
  }

  async getReportsByBeneficiary(beneficiaryId: number, userId: number) {
    // Check access first
    await this.getBeneficiary(beneficiaryId, userId);

    return this.prisma.activityReport.findMany({
      where: { beneficiaryId },
      orderBy: { date: 'desc' },
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
    });
  }

  async getAssignedProjects(userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      include: {
        project: true
      }
    });
    return [...new Map(assignments.map(a => [a.projectId, a.project])).values()].filter(Boolean);
  }

  async getProjectAssignments(projectId: number) {
    const projectStates = await this.prisma.projectState.findMany({
      where: { projectId },
      include: { state: true }
    });
    const awcs = await this.prisma.awc.findMany({
      where: { projectId },
      include: {
        state: true,
        district: true,
        block: true,
        village: true
      }
    });
    return {
      states: projectStates.map(ps => ps.state),
      awcs: awcs
    };
  }
}
