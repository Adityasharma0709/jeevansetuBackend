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

    if (!assignments.length) {
      return [];
    }

    const projectIds = [...new Set(assignments.map((a) => a.projectId))];

    const reports = await this.prisma.activityReport.findMany({
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
        activity: { select: { id: true, name: true } },
        session: { select: { id: true, name: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    });

    return reports.map((r) => ({
      reportId: r.id,
      beneficiaryId: r.beneficiary.uid,
      beneficiaryName: r.beneficiary.name,
      beneficiaryDbId: r.beneficiary.id,
      dateOfBirth: r.beneficiary.dateOfBirth ?? null,
      guardianName: r.beneficiary.guardianName ?? null,
      dateOfMarriage: r.beneficiary.dateOfMarriage ?? null,
      womanAgeAtMarriage: r.beneficiary.womanAgeAtMarriage ?? null,
      husbandAgeAtMarriage: r.beneficiary.husbandAgeAtMarriage ?? null,
      maritalStatus: r.beneficiary.maritalStatus ?? null,
      gender: r.beneficiary.gender ?? null,
      state: r.beneficiary.awc?.state?.name ?? r.beneficiary.state ?? '-',
      district: r.beneficiary.awc?.district?.name ?? r.beneficiary.district ?? '-',
      block: r.beneficiary.awc?.block?.name ?? r.beneficiary.block ?? '-',
      village: r.beneficiary.awc?.village?.name ?? r.beneficiary.village ?? '-',
      awcCenter: r.beneficiary.awc?.awcName ?? r.beneficiary.awc?.locationCode ?? '-',
      activity: r.activity.name,
      session: r.session.name,
      reportData: r.reportData,
      reportingDate: r.date,
      reportedBy: r.reportedBy.name,
    }));
  }

  async getDashboardStats(
    userId: number,
    projectId?: number,
    activityId?: number,
    sessionId?: number,
    adminId?: number,
    managerId?: number,
    workerId?: number
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
        episodesOfCare: {
          adults: 0,
          adolescents: 0,
          childrenUnder5: 0,
          children6To10: 0
        },
        activities: []
      };
    }

    const assignedProjectIds = [...new Set(assignments.map(a => a.projectId))];
    const targetProjectIds = projectId ? [projectId] : assignedProjectIds;

    if (projectId && !assignedProjectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`b."projectId" IN (${Prisma.join(targetProjectIds)})`
    ];

    if (activityId) conditions.push(Prisma.sql`r."activityId" = ${activityId}`);
    if (sessionId) conditions.push(Prisma.sql`r."sessionId" = ${sessionId}`);

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
      conditions.push(Prisma.sql`r."reportedById" IN (${Prisma.join(reporterIds)})`);
    }

    const totalBeneficiaries = await this.prisma.beneficiary.count({
      where: { projectId: { in: targetProjectIds } }
    });

    const assignedProjects = await this.prisma.project.count({
      where: { id: { in: targetProjectIds } }
    });

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const statsRaw: any[] = await this.prisma.$queryRaw`
      WITH ReportData AS (
        SELECT 
          r.id,
          r."childId" AS "childId",
          r."reportData",
          COALESCE(c.gender, b.gender) AS gender,
          b."maritalStatus",
          b."typeof",
          EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_years,
          (EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) * 12) + EXTRACT(MONTH FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) AS age_months,
          EXISTS (
            SELECT 1 FROM "GroupMember" gm
            INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
            WHERE gm."beneficiaryId" = b.id AND bg.name = 'Pregnant Women'
          ) AS "isPregnantGroup",
          EXISTS (
            SELECT 1 FROM "GroupMember" gm
            INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
            WHERE gm."beneficiaryId" = b.id AND bg.name = 'Lactating Women'
          ) AS "isLactatingGroup",
          (
            EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'SAM Children [0-5 Years]'
            ) OR EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'SAM Children [0-5 Years]'
            )
          ) AS "isSamGroup",
          (
            EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'MAM Children [0-5 Years]'
            ) OR EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'MAM Children [0-5 Years]'
            )
          ) AS "isMamGroup",
          (
            EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'Adolescent Girls'
            ) OR EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'Adolescent Girls'
            )
          ) AS "isAdolescentGirlsGroup",
          CASE 
            WHEN r."childId" IS NOT NULL THEN 
              (EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c."dateOfBirth")) <= 6
            ELSE 
              EXISTS (
                SELECT 1 FROM "BeneficiaryChild" c_sub 
                WHERE c_sub."beneficiaryId" = b.id 
                AND (EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")) <= 6
              )
          END AS "hasEbfInfant",
          CASE 
            WHEN r."childId" IS NOT NULL THEN 
              (EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c."dateOfBirth")) > 6
              AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 2
            ELSE 
              EXISTS (
                SELECT 1 FROM "BeneficiaryChild" c_sub 
                WHERE c_sub."beneficiaryId" = b.id 
                AND (EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")) > 6
                AND EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) < 2
              )
          END AS "hasCfInfant"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
        ${whereClause}
      )
      SELECT 
        COUNT(*) AS "totalReports",
        COUNT(*) FILTER (WHERE "isPregnantGroup" = true AND "childId" IS NULL) AS "activePregnantWomen",
        COUNT(*) FILTER (WHERE "isLactatingGroup" = true AND "childId" IS NULL) AS "activeLactatingMothers",
        COUNT(*) FILTER (WHERE "isSamGroup" = true) AS "activeSamChildren",
        COUNT(*) FILTER (WHERE "isMamGroup" = true) AS "activeMamChildren",
        COUNT(*) FILTER (WHERE "isAdolescentGirlsGroup" = true) AS "adolescentGirls",
        COUNT(*) FILTER (WHERE "hasEbfInfant" = true) AS "infantsEbfPromotion",
        COUNT(*) FILTER (WHERE "hasCfInfant" = true) AS "infantsCfPromotion",
        COUNT(*) FILTER (
          WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
          AND (
            CASE
              WHEN "reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'edd', 'DD/MM/YYYY')
              WHEN "reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'edd', 'DDMMYYYY')
              ELSE NULL
            END
          ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND "childId" IS NULL
        ) AS "womenDueForDelivery30Days",
        COUNT(*) FILTER (WHERE age_years > 19) AS "adults",
        COUNT(*) FILTER (WHERE age_years BETWEEN 10 AND 19) AS "adolescents",
        COUNT(*) FILTER (WHERE age_years < 6) AS "childrenUnder5",
        COUNT(*) FILTER (WHERE age_years >= 6 AND age_years < 10) AS "children6To10",
        COUNT(*) FILTER (WHERE "isPregnantGroup" = true AND "childId" IS NULL) AS "pregnantWomen",
        COUNT(*) FILTER (WHERE "isLactatingGroup" = true AND "childId" IS NULL) AS "lactatingWomen",
        COUNT(*) FILTER (WHERE "isMamGroup" = true AND age_years <= 5) AS "mam0to5",
        COUNT(*) FILTER (WHERE "isSamGroup" = true AND age_years <= 5) AS "sam0to5",
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
      outreachActions: {
        activePregnantWomen: toNumber(row.activePregnantWomen),
        activeLactatingMothers: toNumber(row.activeLactatingMothers),
        activeSamChildren: toNumber(row.activeSamChildren),
        activeMamChildren: toNumber(row.activeMamChildren),
        adolescentGirls: toNumber(row.adolescentGirls),
        infantsEbfPromotion: toNumber(row.infantsEbfPromotion),
        infantsCfPromotion: toNumber(row.infantsCfPromotion),
        womenDueForDelivery30Days: toNumber(row.womenDueForDelivery30Days)
      },
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

  async getActionDetails(
    userId: number,
    groupName: string,
    activityId?: number,
    sessionId?: number,
    adminId?: number,
    managerId?: number,
    workerId?: number
  ) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    if (!assignments.length) {
      return [];
    }

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

    let groupCondition: Prisma.Sql;
    const gName = (groupName || '').trim().toUpperCase();

    switch (gName) {
      case 'CURRENTLY ACTIVE PREGNANT WOMEN':
      case 'PREGNANT WOMEN':
        groupCondition = Prisma.sql`"isPregnantGroup" = true AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE LACTATING MOTHERS':
      case 'LACTATING WOMEN':
        groupCondition = Prisma.sql`"isLactatingGroup" = true AND "childIntId" IS NULL`;
        break;
      case 'CURRENTLY ACTIVE SAM CHILDREN':
        groupCondition = Prisma.sql`"isSamGroup" = true`;
        break;
      case 'SAM (0-5)':
        groupCondition = Prisma.sql`"isSamGroup" = true AND age_years <= 5`;
        break;
      case 'CURRENTLY ACTIVE MAM CHILDREN':
        groupCondition = Prisma.sql`"isMamGroup" = true`;
        break;
      case 'MAM (0-5)':
        groupCondition = Prisma.sql`"isMamGroup" = true AND age_years <= 5`;
        break;
      case 'ADOLESCENT GIRLS':
        groupCondition = Prisma.sql`"isAdolescentGirlsGroup" = true`;
        break;
      case 'INFANTS FOR EBF PROMOTION (<= 6M)':
        groupCondition = Prisma.sql`"hasEbfInfant" = true`;
        break;
      case 'INFANTS FOR CF PROMOTION(2YEAR<CHILD AGE<6MONTHS)':
        groupCondition = Prisma.sql`"hasCfInfant" = true`;
        break;
      case 'WOMEN DUE FOR DELIVERY IN NEXT 30 DAYS':
        groupCondition = Prisma.sql`
          "reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
          AND (
            CASE
              WHEN "reportData"->>'edd' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN to_date("reportData"->>'edd', 'DD/MM/YYYY')
              WHEN "reportData"->>'edd' ~ '^[0-9]{8}$' THEN to_date("reportData"->>'edd', 'DDMMYYYY')
              ELSE NULL
            END
          ) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' 
          AND "childIntId" IS NULL
        `;
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

    const rawRecords: any[] = await this.prisma.$queryRaw`
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
          EXISTS (
            SELECT 1 FROM "GroupMember" gm
            INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
            WHERE gm."beneficiaryId" = b.id AND bg.name = 'Pregnant Women'
          ) AS "isPregnantGroup",
          EXISTS (
            SELECT 1 FROM "GroupMember" gm
            INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
            WHERE gm."beneficiaryId" = b.id AND bg.name = 'Lactating Women'
          ) AS "isLactatingGroup",
          (
            EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'SAM Children [0-5 Years]'
            ) OR EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'SAM Children [0-5 Years]'
            )
          ) AS "isSamGroup",
          (
            EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'MAM Children [0-5 Years]'
            ) OR EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'MAM Children [0-5 Years]'
            )
          ) AS "isMamGroup",
          (
            EXISTS (
              SELECT 1 FROM "GroupMember" gm
              INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
              WHERE gm."beneficiaryId" = b.id AND bg.name = 'Adolescent Girls'
            ) OR EXISTS (
              SELECT 1 FROM "ChildGroupMember" cgm
              INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
              WHERE cgm."childId" = c.id AND bg.name = 'Adolescent Girls'
            )
          ) AS "isAdolescentGirlsGroup",
          CASE 
            WHEN r."childId" IS NOT NULL THEN 
              (EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c."dateOfBirth")) <= 6
            ELSE 
              EXISTS (
                SELECT 1 FROM "BeneficiaryChild" c_sub 
                WHERE c_sub."beneficiaryId" = b.id 
                AND (EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")) <= 6
              )
          END AS "hasEbfInfant",
          CASE 
            WHEN r."childId" IS NOT NULL THEN 
              (EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c."dateOfBirth")) > 6
              AND EXTRACT(YEAR FROM AGE(r.date, c."dateOfBirth")) < 2
            ELSE 
              EXISTS (
                SELECT 1 FROM "BeneficiaryChild" c_sub 
                WHERE c_sub."beneficiaryId" = b.id 
                AND (EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) * 12) + EXTRACT(MONTH FROM AGE(r.date, c_sub."dateOfBirth")) > 6
                AND EXTRACT(YEAR FROM AGE(r.date, c_sub."dateOfBirth")) < 2
              )
          END AS "hasCfInfant",
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
        "childNameAndAge",
        "hasEbfInfant",
        "hasCfInfant"
      FROM ReportData
      WHERE ${groupCondition}
      ORDER BY "reportingDate" DESC
      LIMIT 100;
    `;

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
              select: { name: true }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const admins: any[] = [];
    const managers: any[] = [];
    const workers: any[] = [];

    users.forEach((u) => {
      const rolesList = u.roles.map(r => r.role.name);
      const isOutreach = rolesList.includes('OUTREACH');
      const isManager = rolesList.includes('MANAGER');
      const isAdmin = rolesList.includes('ADMIN');

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
      finalAssignedStates = assignments.map(a => a.state).filter(Boolean);
    }

    const finalAssignedStateIds = finalAssignedStates.map(s => s.id);

    const where: any = {
      projectId,
    };

    if (!hasFullProjectAccess && finalAssignedStateIds.length > 0) {
      where.stateId = { in: finalAssignedStateIds };
    }

    const awcs = await this.prisma.awc.findMany({
      where,
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
      projectId: { in: targetProjectIds }
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { uid: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
        { block: { contains: search, mode: 'insensitive' } },
        { village: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
        { district: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.beneficiary.findMany({
      where,
      include: {
        project: true,
        awc: {
          include: {
            state: true,
            district: true,
            block: true,
            village: true
          }
        },
        children: {
          include: {
            childGroups: {
              include: { group: true }
            }
          }
        },
        groups: { include: { group: true } },
        activities: { include: { activity: true, session: true } }
      },
      orderBy: { name: 'asc' }
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

  async getFamilyMembers(id: number) {
    return this.prisma.beneficiaryChild.findMany({
      where: { beneficiaryId: id },
      include: {
        childGroups: {
          include: { group: true }
        }
      }
    });
  }

  async getReportsByBeneficiary(id: number, userId: number) {
    const assignments = await this.prisma.userProjectLocation.findMany({
      where: { userId },
      select: { projectId: true },
    });

    const projectIds = [...new Set(assignments.map(a => a.projectId))];
    const ben = await this.prisma.beneficiary.findUnique({
      where: { id },
      select: { projectId: true }
    });

    if (!ben || !projectIds.includes(ben.projectId)) {
      throw new ForbiddenException('Access denied or beneficiary not found');
    }

    return this.prisma.activityReport.findMany({
      where: { beneficiaryId: id },
      include: {
        activity: { select: { name: true } },
        session: { select: { name: true } },
        child: {
          select: {
            name: true,
            uid: true,
            dateOfBirth: true,
            gender: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });
  }
}
