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
    const targetProjectIdsStr = targetProjectIds.join(',');

    // 1. Calculate General Stats (Registry snapshot)
    const totalBeneficiaries = await this.prisma.beneficiary.count({
      where: { projectId: { in: targetProjectIds } }
    });

    const assignedProjects = targetProjectIds.length;

    // 2. Count Outreach Dynamics (Unfiltered by date or activity filters)
    
    // a. Currently Pregnant Women: Activity table where pregnancyOutcome is null
    const pregnantCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        WHERE b."projectId" IN (${targetProjectIdsStr})
        ORDER BY "beneficiaryId", r.date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports
      WHERE "childId" IS NULL
        AND "reportData"->>'pregnancyStatus' = 'Currently Pregnant'
        AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '');
    `;
    const pregnantRaw: any[] = await this.prisma.$queryRawUnsafe(pregnantCountQuery);
    const activePregnantWomen = Number(pregnantRaw[0]?.count || 0);

    // b. Currently Lactating Mothers: Activity and Beneficiary table (having child < 2 years)
    const lactatingCountQuery = `
      SELECT COUNT(DISTINCT id) AS count FROM (
        SELECT b.id
        FROM "Beneficiary" b
        INNER JOIN "BeneficiaryChild" c ON c."beneficiaryId" = b.id
        WHERE b."projectId" IN (${targetProjectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
        UNION
        SELECT "beneficiaryId" AS id
        FROM (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", date, "childId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${targetProjectIdsStr})
          ORDER BY "beneficiaryId", r.date DESC
        ) lr
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Baby Delivered'
          AND lr.date >= CURRENT_DATE - INTERVAL '2 years'
      ) combined;
    `;
    const lactatingRaw: any[] = await this.prisma.$queryRawUnsafe(lactatingCountQuery);
    const activeLactatingMothers = Number(lactatingRaw[0]?.count || 0);

    // c. SAM Children: Activity table (samMamStatus = SAM and child age <= 5)
    const samCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("childId") "childId", "reportData"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        WHERE b."projectId" IN (${targetProjectIdsStr}) AND r."childId" IS NOT NULL
        ORDER BY "childId", r.date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports lr
      INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
      WHERE lr."reportData"->>'samMamStatus' = 'SAM'
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years';
    `;
    const samRaw: any[] = await this.prisma.$queryRawUnsafe(samCountQuery);
    const activeSamChildren = Number(samRaw[0]?.count || 0);

    // d. MAM Children: Activity table (samMamStatus = MAM and child age <= 5)
    const mamCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("childId") "childId", "reportData"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        WHERE b."projectId" IN (${targetProjectIdsStr}) AND r."childId" IS NOT NULL
        ORDER BY "childId", r.date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports lr
      INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
      WHERE lr."reportData"->>'samMamStatus' = 'MAM'
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years';
    `;
    const mamRaw: any[] = await this.prisma.$queryRawUnsafe(mamCountQuery);
    const activeMamChildren = Number(mamRaw[0]?.count || 0);

    // e. Adolescent Girls: Beneficiary table 10 <= age <= 19
    const adolescentCountQuery = `
      SELECT COUNT(*) AS count
      FROM "Beneficiary" b
      WHERE b."projectId" IN (${targetProjectIdsStr})
        AND LOWER(TRIM(b.gender)) = 'female'
        AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) BETWEEN 10 AND 19;
    `;
    const adolescentRaw: any[] = await this.prisma.$queryRawUnsafe(adolescentCountQuery);
    const adolescentGirls = Number(adolescentRaw[0]?.count || 0);

    // f. Infants for EBF Promotion: Beneficiary child age <= 6 months
    const ebfCountQuery = `
      SELECT COUNT(*) AS count
      FROM "BeneficiaryChild" c
      INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
      WHERE b."projectId" IN (${targetProjectIdsStr})
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '6 months';
    `;
    const ebfRaw: any[] = await this.prisma.$queryRawUnsafe(ebfCountQuery);
    const infantsEbfPromotion = Number(ebfRaw[0]?.count || 0);

    // g. Infants for CF Promotion: Beneficiary child 6 months <= age < 2 years
    const cfCountQuery = `
      SELECT COUNT(*) AS count
      FROM "BeneficiaryChild" c
      INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
      WHERE b."projectId" IN (${targetProjectIdsStr})
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
        AND c."dateOfBirth" < CURRENT_DATE - INTERVAL '6 months';
    `;
    const cfRaw: any[] = await this.prisma.$queryRawUnsafe(cfCountQuery);
    const infantsCfPromotion = Number(cfRaw[0]?.count || 0);

    // h. Women due pregnancy: Activity table, LMP + 280 days
    const dueCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        WHERE b."projectId" IN (${targetProjectIdsStr})
        ORDER BY "beneficiaryId", r.date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports
      WHERE "childId" IS NULL
        AND "reportData"->>'pregnancyStatus' = 'Currently Pregnant'
        AND (
          CASE
            WHEN "reportData"->>'lmp' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'lmp', 'DD/MM/YYYY')
            WHEN "reportData"->>'lmp' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'lmp', 'DDMMYYYY')
            ELSE NULL
          END
        ) + INTERVAL '280 days' BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';
    `;
    const dueRaw: any[] = await this.prisma.$queryRawUnsafe(dueCountQuery);
    const womenDueForDelivery30Days = Number(dueRaw[0]?.count || 0);

    // 3. Coverage Dashboard Stats (Applying filters and unique toggle)
    const conditions: string[] = [
      `b."projectId" IN (${targetProjectIdsStr})`
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

    let totalReportsRaw: any[];
    if (unique) {
      const uniqueQuery = `
        WITH ReportData AS (
          SELECT 
            r.id,
            r."beneficiaryId",
            r."childId",
            r.date,
            r."reportData",
            b."typeof",
            COALESCE(c.gender, b.gender) AS gender,
            b."maritalStatus",
            EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
            (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          ${whereClause}
        )
        SELECT 
          COUNT(*) AS "totalReports",
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL) AS "pregnantWomen",
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childId" IS NULL) AS "lactatingWomen",
          COUNT(DISTINCT "childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5) AS "mam0to5",
          COUNT(DISTINCT "childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5) AS "sam0to5",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (
            WHERE LOWER(TRIM(gender)) = 'female' 
            AND "maritalStatus" = 'Married' 
            AND age_years BETWEEN 15 AND 24 
            AND "childId" IS NULL
            AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          ) AS "youngMarriedWomen",
          COUNT(DISTINCT "childId") FILTER (WHERE age_years < 1) AS "infantsLessThan1",
          COUNT(DISTINCT "childId") FILTER (WHERE age_years >= 1 AND age_years < 3) AS "toddlers1To3",
          COUNT(DISTINCT "childId") FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Girls",
          COUNT(DISTINCT "childId") FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6) AS "childrenBelow6Boys",
          COUNT(DISTINCT "childId") FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Girls",
          COUNT(DISTINCT "childId") FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10) AS "childrenAbove6Boys",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19) AS "adolescentBoys",
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE LOWER(TRIM("typeof")) = 'stakeholder') AS "stakeholders",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (
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
      totalReportsRaw = await this.prisma.$queryRawUnsafe(uniqueQuery);
    } else {
      const nonUniqueQuery = `
        WITH ReportData AS (
          SELECT 
            r.id,
            r."beneficiaryId",
            r."childId",
            r.date,
            r."reportData",
            b."typeof",
            COALESCE(c.gender, b.gender) AS gender,
            b."maritalStatus",
            EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
            (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          ${whereClause}
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
          COUNT(*) FILTER (WHERE LOWER(TRIM("typeof")) = 'stakeholder') AS "stakeholders",
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
      totalReportsRaw = await this.prisma.$queryRawUnsafe(nonUniqueQuery);
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
    const projectIdsStr = projectIds.join(',');
    
    const clean = (groupName || '').trim().toUpperCase();

    let rawRecords: any[] = [];
    let queryStr = '';

    if (clean.includes('PREGNANT') && !clean.includes('DUE') && !clean.includes('DELIVERY')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${projectIdsStr})
          ORDER BY "beneficiaryId", r.date DESC
        )
        SELECT b.uid AS id, b.id AS "benId", b.name, 'Pregnant Women' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN LatestReports lr ON b.id = lr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
          AND (lr."reportData"->>'pregnancyOutcome' IS NULL OR lr."reportData"->>'pregnancyOutcome' = 'null' OR lr."reportData"->>'pregnancyOutcome' = '');
      `;
    } else if (clean.includes('LACTATING') || clean.includes('MOTHER')) {
      queryStr = `
        SELECT DISTINCT id, "benId", name, 'Lactating Mothers' AS group, awc, project, gender, "guardianName", age, "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM (
          SELECT b.uid AS id, b.id AS "benId", b.name, COALESCE(a."awcName", 'N/A') AS awc,
                 p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
                 EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
                 (
                   SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
                   FROM "BeneficiaryChild" c_sub
                   WHERE c_sub."beneficiaryId" = b.id
                 ) AS "childNameAndAge"
          FROM "Beneficiary" b
          INNER JOIN "BeneficiaryChild" c ON c."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
          WHERE b."projectId" IN (${projectIdsStr})
            AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
          UNION
          SELECT b.uid AS id, b.id AS "benId", b.name, COALESCE(a."awcName", 'N/A') AS awc,
                 p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
                 EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
                 (
                   SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
                   FROM "BeneficiaryChild" c_sub
                   WHERE c_sub."beneficiaryId" = b.id
                 ) AS "childNameAndAge"
          FROM "Beneficiary" b
          INNER JOIN (
            SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", date, "childId"
            FROM "ActivityReport" r
            INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
            WHERE b."projectId" IN (${projectIdsStr})
            ORDER BY "beneficiaryId", r.date DESC
          ) lr ON b.id = lr."beneficiaryId"
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
          WHERE lr."childId" IS NULL
            AND lr."reportData"->>'pregnancyStatus' = 'Baby Delivered'
            AND lr.date >= CURRENT_DATE - INTERVAL '2 years'
        ) combined;
      `;
    } else if (clean.includes('SAM')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("childId") "childId", "reportData"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
          ORDER BY "childId", r.date DESC
        )
        SELECT c.uid AS id, b.id AS "benId", c.name, 'SAM Children [0-5 Years]' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM LatestReports lr
        INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE lr."reportData"->>'samMamStatus' = 'SAM'
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years';
      `;
    } else if (clean.includes('MAM')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("childId") "childId", "reportData"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
          ORDER BY "childId", r.date DESC
        )
        SELECT c.uid AS id, b.id AS "benId", c.name, 'MAM Children [0-5 Years]' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM LatestReports lr
        INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE lr."reportData"->>'samMamStatus' = 'MAM'
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years';
      `;
    } else if (clean.includes('ADOLESCENT')) {
      queryStr = `
        SELECT b.uid AS id, b.id AS "benId", b.name, 'Adolescent Girls' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND LOWER(TRIM(b.gender)) = 'female'
          AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) BETWEEN 10 AND 19;
      `;
    } else if (clean.includes('EBF')) {
      queryStr = `
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Infants for EBF' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '6 months';
      `;
    } else if (clean.includes('CF')) {
      queryStr = `
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Infants for CF' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
          AND c."dateOfBirth" < CURRENT_DATE - INTERVAL '6 months';
      `;
    } else if (clean.includes('DUE') || clean.includes('DELIVERY')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          WHERE b."projectId" IN (${projectIdsStr})
          ORDER BY "beneficiaryId", r.date DESC
        )
        SELECT b.uid AS id, b.id AS "benId", b.name, 'Due for Delivery' AS group, COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 'N/A' AS activity, 'N/A' AS session, 'N/A' AS "reportingDate"
        FROM "Beneficiary" b
        INNER JOIN LatestReports lr ON b.id = lr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
          AND (
            CASE
              WHEN lr."reportData"->>'lmp' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date(lr."reportData"->>'lmp', 'DD/MM/YYYY')
              WHEN lr."reportData"->>'lmp' ~ '^[0-9]{8}$' THEN to_date(lr."reportData"->>'lmp', 'DDMMYYYY')
              ELSE NULL
            END
          ) + INTERVAL '280 days' BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';
      `;
    }

    if (queryStr) {
      rawRecords = await this.prisma.$queryRawUnsafe(queryStr);
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

    let groupCondition: string;
    const gName = (groupName || '').trim().toUpperCase();

    switch (gName) {
      case 'CURRENTLY ACTIVE PREGNANT WOMEN':
      case 'PREGNANT WOMEN':
        groupCondition = `"reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE LACTATING MOTHERS':
      case 'LACTATING WOMEN':
        groupCondition = `"reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE SAM CHILDREN':
        groupCondition = `"reportData"->>'samMamStatus' = 'SAM'`;
        break;
      case 'SAM (0-5)':
        groupCondition = `"reportData"->>'samMamStatus' = 'SAM' AND age_years <= 5`;
        break;
      case 'CURRENTLY ACTIVE MAM CHILDREN':
        groupCondition = `"reportData"->>'samMamStatus' = 'MAM'`;
        break;
      case 'MAM (0-5)':
        groupCondition = `"reportData"->>'samMamStatus' = 'MAM' AND age_years <= 5`;
        break;
      case 'ADOLESCENT GIRLS':
        groupCondition = `LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19`;
        break;
      case 'YOUNG MARRIED WOMEN':
        groupCondition = `
          LOWER(TRIM(gender)) = 'female' 
          AND "maritalStatus" = 'Married' 
          AND age_years BETWEEN 15 AND 24 
          AND "childIntId" IS NULL
          AND ("reportData"->>'pregnancyStatus' IS NULL OR "reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
        `;
        break;
      case 'INFANT':
        groupCondition = `age_years < 1`;
        break;
      case 'TODDLER':
        groupCondition = `age_years >= 1 AND age_years < 3`;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - GIRLS':
        groupCondition = `LOWER(TRIM(gender)) = 'female' AND age_years >= 3 AND age_years < 6`;
        break;
      case 'CHILDREN BELOW 6 (3-6 YEARS) - BOYS':
        groupCondition = `LOWER(TRIM(gender)) = 'male' AND age_years >= 3 AND age_years < 6`;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - GIRLS':
        groupCondition = `LOWER(TRIM(gender)) = 'female' AND age_years >= 6 AND age_years < 10`;
        break;
      case 'CHILDREN ABOVE 6 (6-9 YEARS) - BOYS':
        groupCondition = `LOWER(TRIM(gender)) = 'male' AND age_years >= 6 AND age_years < 10`;
        break;
      case 'ADOLESCENT BOYS':
        groupCondition = `LOWER(TRIM(gender)) = 'male' AND age_years BETWEEN 10 AND 19`;
        break;
      case 'STAKEHOLDERS':
        groupCondition = `LOWER(TRIM("typeof")) = 'stakeholder'`;
        break;
      case 'OTHER BENEFICIARIES':
        groupCondition = `
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
        groupCondition = `1 = 1`;
        break;
    }

    let rawRecords: any[] = [];
    if (unique) {
      const uniqueQuery = `
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
          ${whereClause}
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
      rawRecords = await this.prisma.$queryRawUnsafe(uniqueQuery);
    } else {
      const nonUniqueQuery = `
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
          ${whereClause}
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
      rawRecords = await this.prisma.$queryRawUnsafe(nonUniqueQuery);
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
