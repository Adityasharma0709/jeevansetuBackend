import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnalystService {
  constructor(private prisma: PrismaService) {}

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

    // 1. Calculate General Stats (Registry snapshot)
    const totalBeneficiaries = await this.prisma.beneficiary.count({
      where: { projectId: { in: targetProjectIds } }
    });

    const assignedProjects = targetProjectIds.length;

    // 2. Count Outreach Dynamics (Registry snapshot, independent of date/activity filters)
    const pregnantGroup = await this.prisma.beneficiaryGroup.findFirst({ where: { name: 'Pregnant Women' } });
    const lactatingGroup = await this.prisma.beneficiaryGroup.findFirst({ where: { name: 'Lactating Women' } });
    const samGroup = await this.prisma.beneficiaryGroup.findFirst({ where: { name: 'SAM Children [0-5 Years]' } });
    const mamGroup = await this.prisma.beneficiaryGroup.findFirst({ where: { name: 'MAM Children [0-5 Years]' } });
    const adolescentGroup = await this.prisma.beneficiaryGroup.findFirst({ where: { name: 'Adolescent Girls' } });

    const getGroupCount = async (group: any, isChild: boolean) => {
      if (!group) return 0;
      if (isChild) {
        return this.prisma.childGroupMember.count({
          where: {
            groupId: group.id,
            child: { beneficiary: { projectId: { in: targetProjectIds } } }
          }
        });
      } else {
        return this.prisma.groupMember.count({
          where: {
            groupId: group.id,
            beneficiary: { projectId: { in: targetProjectIds } }
          }
        });
      }
    };

    const activePregnantWomen = await getGroupCount(pregnantGroup, false);
    const activeLactatingMothers = await getGroupCount(lactatingGroup, false);
    const activeSamChildren = (await getGroupCount(samGroup, true)) + (await getGroupCount(samGroup, false));
    const activeMamChildren = (await getGroupCount(mamGroup, true)) + (await getGroupCount(mamGroup, false));
    const adolescentGirls = await getGroupCount(adolescentGroup, false);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const infantsEbfPromotion = await this.prisma.beneficiaryChild.count({
      where: {
        beneficiary: { projectId: { in: targetProjectIds } },
        dateOfBirth: { gte: sixMonthsAgo }
      }
    });

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const infantsCfPromotion = await this.prisma.beneficiaryChild.count({
      where: {
        beneficiary: { projectId: { in: targetProjectIds } },
        dateOfBirth: { gte: twoYearsAgo, lt: sixMonthsAgo }
      }
    });

    const eddRaw: any[] = await this.prisma.$queryRaw`
      WITH LatestReports AS (
        SELECT DISTINCT ON ("beneficiaryId") "reportData", date
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        WHERE b."projectId" IN (${Prisma.join(targetProjectIds)})
        ORDER BY "beneficiaryId", date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports
      WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant'
        AND (
          CASE
            WHEN "reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'edd', 'DD/MM/YYYY')
            WHEN "reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'edd', 'DDMMYYYY')
            ELSE NULL
          END
        ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';
    `;
    const womenDueForDelivery30Days = Number(eddRaw[0]?.count || 0);

    // 3. Coverage Dashboard Stats (Applying filters and unique toggle)
    const rbacConditions: Prisma.Sql[] = [
      Prisma.sql`b."projectId" IN (${Prisma.join(targetProjectIds)})`
    ];

    if (activityId) rbacConditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) rbacConditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

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
      rbacConditions.push(Prisma.sql`r."reportedById" IN (${Prisma.join(reporterIds)})`);
    }

    if (state && state !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.state) = LOWER(${state})`);
    }
    if (district && district !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.district) = LOWER(${district})`);
    }
    if (block && block !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.block) = LOWER(${block})`);
    }
    if (awc && awc !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(a."awcName") = LOWER(${awc})`);
    }

    if (year && year !== 'ALL') {
      rbacConditions.push(Prisma.sql`EXTRACT(YEAR FROM r.date) = ${Number(year)}`);
    }
    if (month && month !== 'ALL') {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mIdx = months.indexOf(month.toLowerCase()) + 1;
      if (mIdx > 0) {
        rbacConditions.push(Prisma.sql`EXTRACT(MONTH FROM r.date) = ${mIdx}`);
      }
    }

    const rbacWhereClause = Prisma.sql`WHERE ${Prisma.join(rbacConditions, ' AND ')}`;

    let totalReportsRaw: any[];
    if (unique) {
      totalReportsRaw = await this.prisma.$queryRaw`
        WITH ReportData AS (
          SELECT 
            r.id,
            r."beneficiaryId",
            r."childId",
            r.date,
            r."reportData",
            COALESCE(c.gender, b.gender) AS gender,
            b."maritalStatus",
            EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
            (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          ${rbacWhereClause}
        )
        SELECT 
          COUNT(*) AS "totalReports",
          COUNT(DISTINCT r."beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL) AS "pregnantWomen",
          COUNT(DISTINCT r."beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childId" IS NULL) AS "lactatingWomen",
          COUNT(DISTINCT r."childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5) AS "mam0to5",
          COUNT(DISTINCT r."childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5) AS "sam0to5",
          COUNT(DISTINCT COALESCE(r."childId"::text, 'ben_' || r."beneficiaryId"::text)) FILTER (
            WHERE LOWER(TRIM(gender)) = 'female' 
            AND "maritalStatus" = 'Married' 
            AND age_years BETWEEN 15 AND 24 
            AND "childId" IS NULL
            AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          ) AS "youngMarriedWomen",
          COUNT(DISTINCT r."childId") FILTER (WHERE age_years < 1) AS "infantsLessThan1",
          COUNT(DISTINCT r."childId") FILTER (WHERE age_years >= 1 AND age_years < 3) AS "toddlers1To3",
          COUNT(DISTINCT r."childId") FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Girls",
          COUNT(DISTINCT r."childId") FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Boys",
          COUNT(DISTINCT r."childId") FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Girls",
          COUNT(DISTINCT r."childId") FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Boys",
          COUNT(DISTINCT COALESCE(r."childId"::text, 'ben_' || r."beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
          COUNT(DISTINCT COALESCE(r."childId"::text, 'ben_' || r."beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19) AS "adolescentBoys",
          COUNT(DISTINCT r."beneficiaryId") FILTER (LOWER(TRIM("typeof")) = 'stakeholder') AS "stakeholders",
          COUNT(DISTINCT COALESCE(r."childId"::text, 'ben_' || r."beneficiaryId"::text)) FILTER (
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
    } else {
      totalReportsRaw = await this.prisma.$queryRaw`
        WITH ReportData AS (
          SELECT 
            r.id,
            r."beneficiaryId",
            r."childId",
            r.date,
            r."reportData",
            COALESCE(c.gender, b.gender) AS gender,
            b."maritalStatus",
            EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
            (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          ${rbacWhereClause}
        )
        SELECT 
          COUNT(*) AS "totalReports",
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
          COUNT(*) FILTER (WHERE age_years < 1) AS "infantsLessThan1",
          COUNT(*) FILTER (WHERE age_years >= 1 AND age_years < 3) AS "toddlers1To3",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Girls",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Boys",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Girls",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Boys",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
          COUNT(*) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19) AS "adolescentBoys",
          COUNT(*) FILTER (LOWER(TRIM("typeof")) = 'stakeholder') AS "stakeholders",
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
    }

    const row = totalReportsRaw[0] || {};
    const toNumber = (val: any) => val ? Number(val) : 0;

    return {
      totalBeneficiaries,
      assignedProjects,
      assignedLocations: 0,
      totalReports: toNumber(row.totalReports),
      outreachActions: {
        activePregnantWomen: toNumber(activePregnantWomen),
        activeLactatingMothers: toNumber(activeLactatingMothers),
        activeSamChildren: toNumber(activeSamChildren),
        activeMamChildren: toNumber(activeMamChildren),
        adolescentGirls: toNumber(adolescentGirls),
        infantsEbfPromotion: toNumber(infantsEbfPromotion),
        infantsCfPromotion: toNumber(infantsCfPromotion),
        womenDueForDelivery30Days: toNumber(womenDueForDelivery30Days)
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
        { label: 'OTHER BENEFICIARIES', count: toNumber(row.otherBeneficiaries), countColor: 'text-gray-900' },
      ]
    };
  }

  async getOutreachDynamicsDetails(userId: number, groupName: string) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) return [];

    const projectIds = [...new Set(assignments.map(a => a.projectId))];
    const gName = (groupName || '').trim().toUpperCase();

    let rawRecords: any[] = [];

    if (['CURRENTLY ACTIVE PREGNANT WOMEN', 'PREGNANT WOMEN'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        SELECT b.uid AS id, b.name, 'Pregnant Women' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN "GroupMember" gm ON gm."beneficiaryId" = b.id
        INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND bg.name = 'Pregnant Women';
      `;
    } else if (['CURRENTLY ACTIVE LACTATING MOTHERS', 'LACTATING WOMEN'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        SELECT b.uid AS id, b.name, 'Lactating Women' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               (
                 SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
                 FROM "BeneficiaryChild" c_sub
                 WHERE c_sub."beneficiaryId" = b.id
               ) AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN "GroupMember" gm ON gm."beneficiaryId" = b.id
        INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND bg.name = 'Lactating Women';
      `;
    } else if (['CURRENTLY ACTIVE SAM CHILDREN', 'SAM (0-5)'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        SELECT c.uid AS id, c.name, 'SAM Children [0-5 Years]' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "ChildGroupMember" cgm ON cgm."childId" = c.id
        INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND bg.name = 'SAM Children [0-5 Years]';
      `;
    } else if (['CURRENTLY ACTIVE MAM CHILDREN', 'MAM (0-5)'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        SELECT c.uid AS id, c.name, 'MAM Children [0-5 Years]' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "ChildGroupMember" cgm ON cgm."childId" = c.id
        INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND bg.name = 'MAM Children [0-5 Years]';
      `;
    } else if (['ADOLESCENT GIRLS'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        SELECT b.uid AS id, b.name, 'Adolescent Girls' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN "GroupMember" gm ON gm."beneficiaryId" = b.id
        INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND bg.name = 'Adolescent Girls';
      `;
    } else if (['INFANTS FOR EBF PROMOTION (<= 6M)'].includes(gName)) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      rawRecords = await this.prisma.$queryRaw`
        SELECT c.uid AS id, c.name, 'Infants for EBF' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND c."dateOfBirth" >= ${sixMonthsAgo};
      `;
    } else if (['INFANTS FOR CF PROMOTION(2YEAR<CHILD AGE<6MONTHS)'].includes(gName)) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      rawRecords = await this.prisma.$queryRaw`
        SELECT c.uid AS id, c.name, 'Infants for CF' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${Prisma.join(projectIds)}) AND c."dateOfBirth" >= ${twoYearsAgo} AND c."dateOfBirth" < ${sixMonthsAgo};
      `;
    } else if (['WOMEN DUE FOR DELIVERY IN NEXT 30 DAYS'].includes(gName)) {
      rawRecords = await this.prisma.$queryRaw`
        WITH LatestReports AS (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", date
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${Prisma.join(projectIds)})
          ORDER BY "beneficiaryId", date DESC
        )
        SELECT b.uid AS id, b.name, 'Due for Delivery' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN LatestReports lr ON b.id = lr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
          AND (
            CASE
              WHEN lr."reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date(lr."reportData"->>'edd', 'DD/MM/YYYY')
              WHEN lr."reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date(lr."reportData"->>'edd', 'DDMMYYYY')
              ELSE NULL
            END
          ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';
      `;
    }

    return rawRecords.map(record => ({
      id: record.id,
      name: record.name,
      group: record.group,
      awc: record.awc,
      activity: record.activity,
      session: record.session,
      reportingDate: record.reportingDate,
      age: record.age,
      childNameAndAge: record.childNameAndAge || 'N/A'
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

    const rbacConditions: Prisma.Sql[] = [
      Prisma.sql`b."projectId" IN (${Prisma.join(projectIds)})`
    ];

    if (activityId) rbacConditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) rbacConditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

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
      rbacConditions.push(Prisma.sql`r."reportedById" IN (${Prisma.join(reporterIds)})`);
    }

    if (state && state !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.state) = LOWER(${state})`);
    }
    if (district && district !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.district) = LOWER(${district})`);
    }
    if (block && block !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(b.block) = LOWER(${block})`);
    }
    if (awc && awc !== 'ALL') {
      rbacConditions.push(Prisma.sql`LOWER(a."awcName") = LOWER(${awc})`);
    }

    if (year && year !== 'ALL') {
      rbacConditions.push(Prisma.sql`EXTRACT(YEAR FROM r.date) = ${Number(year)}`);
    }
    if (month && month !== 'ALL') {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mIdx = months.indexOf(month.toLowerCase()) + 1;
      if (mIdx > 0) {
        rbacConditions.push(Prisma.sql`EXTRACT(MONTH FROM r.date) = ${mIdx}`);
      }
    }

    let groupCondition: Prisma.Sql;
    const gName = (groupName || '').trim().toUpperCase();

    switch (gName) {
      case 'CURRENTLY ACTIVE PREGNANT WOMEN':
      case 'PREGNANT WOMEN':
        groupCondition = Prisma.sql`"reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE LACTATING MOTHERS':
      case 'LACTATING WOMEN':
        groupCondition = Prisma.sql`"reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE SAM CHILDREN':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'SAM'`;
        break;
      case 'SAM (0-5)':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5`;
        break;
      case 'CURRENTLY ACTIVE MAM CHILDREN':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'MAM'`;
        break;
      case 'MAM (0-5)':
        groupCondition = Prisma.sql`"reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5`;
        break;
      case 'ADOLESCENT GIRLS':
        groupCondition = Prisma.sql`LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19`;
        break;
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

    const rbacWhereClause = Prisma.sql`WHERE ${Prisma.join(rbacConditions, ' AND ')}`;

    let rawRecords: any[] = [];
    if (unique) {
      rawRecords = await this.prisma.$queryRaw`
        WITH ReportData AS (
          SELECT 
            r.id AS "reportId",
            r."beneficiaryId" AS "benIntId",
            r."childId" AS "childIntId",
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
            (
              SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
              FROM "BeneficiaryChild" c_sub
              WHERE c_sub."beneficiaryId" = b.id
            ) AS "childNameAndAge",
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
        ),
        FilteredReportData AS (
          SELECT * FROM ReportData
          WHERE ${groupCondition}
        )
        SELECT DISTINCT ON (COALESCE("childIntId", "benIntId"))
          "reportId",
          "beneficiaryId" AS id,
          "beneficiaryName" AS name,
          COALESCE("actualGroups", 'N/A') AS group,
          COALESCE(awc, 'N/A') AS awc,
          COALESCE(activity, 'N/A') AS activity,
          COALESCE(session, 'N/A') AS session,
          "reportingDate",
          age_years,
          age_months,
          "childNameAndAge"
        FROM FilteredReportData
        ORDER BY COALESCE("childIntId", "benIntId"), "reportingDate" DESC
        LIMIT 100;
      `;
    } else {
      rawRecords = await this.prisma.$queryRaw`
        WITH ReportData AS (
          SELECT 
            r.id AS "reportId",
            r."beneficiaryId" AS "benIntId",
            r."childId" AS "childIntId",
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
            (
              SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
              FROM "BeneficiaryChild" c_sub
              WHERE c_sub."beneficiaryId" = b.id
            ) AS "childNameAndAge",
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
        SELECT 
          "reportId",
          "beneficiaryId" AS id,
          "beneficiaryName" AS name,
          COALESCE("actualGroups", 'N/A') AS group,
          COALESCE(awc, 'N/A') AS awc,
          COALESCE(activity, 'N/A') AS activity,
          COALESCE(session, 'N/A') AS session,
          "reportingDate",
          age_years,
          age_months,
          "childNameAndAge"
        FROM ReportData
        WHERE ${groupCondition}
        ORDER BY "reportingDate" DESC
        LIMIT 100;
      `;
    }

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
        id: record.id,
        name: record.name,
        group: record.group,
        awc: record.awc,
        activity: record.activity,
        session: record.session,
        reportingDate: record.reportingDate ? new Date(record.reportingDate).toLocaleDateString() : 'N/A',
        age: ageStr,
        childNameAndAge: record.childNameAndAge || 'N/A',
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
