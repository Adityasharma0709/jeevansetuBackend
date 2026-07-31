import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CoverageDashboardOptions {
  projectIds: number[];
  reporterIds?: number[];
  activityId?: number;
  sessionId?: number;
  state?: string;
  district?: string;
  block?: string;
  awc?: string;
  year?: string;
  month?: string;
  unique?: boolean;
}

@Injectable()
export class CoverageDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(options: CoverageDashboardOptions) {
    const projectIdsStr = options.projectIds.join(',') || '0';
    const conditions: string[] = [
      `b."projectId" IN (${projectIdsStr})`
    ];

    if (options.activityId) {
      conditions.push(`r."activityId" = ${options.activityId}`);
    }
    if (options.sessionId) {
      conditions.push(`r."sessionId" = ${options.sessionId}`);
    }

    if (options.reporterIds && options.reporterIds.length > 0) {
      conditions.push(`r."reportedById" IN (${options.reporterIds.join(',')})`);
    }

    const escapeStr = (val: string) => (val || '').replace(/'/g, "''");

    if (options.state && options.state !== 'ALL') {
      conditions.push(`LOWER(b.state) = LOWER('${escapeStr(options.state)}')`);
    }
    if (options.district && options.district !== 'ALL') {
      conditions.push(`LOWER(b.district) = LOWER('${escapeStr(options.district)}')`);
    }
    if (options.block && options.block !== 'ALL') {
      conditions.push(`LOWER(b.block) = LOWER('${escapeStr(options.block)}')`);
    }
    if (options.awc && options.awc !== 'ALL') {
      conditions.push(`LOWER(a."awcName") = LOWER('${escapeStr(options.awc)}')`);
    }

    if (options.year && options.year !== 'ALL') {
      conditions.push(`EXTRACT(YEAR FROM r.date) = ${Number(options.year)}`);
    }
    if (options.month && options.month !== 'ALL') {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const mIdx = months.indexOf(options.month.toLowerCase()) + 1;
      if (mIdx > 0) {
        conditions.push(`EXTRACT(MONTH FROM r.date) = ${mIdx}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let statsRaw: any[];

    if (options.unique) {
      const uniqueQuery = `
        WITH LatestReports AS (
          SELECT DISTINCT ON (COALESCE(r."childId", r."beneficiaryId"))
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
          ORDER BY COALESCE(r."childId", r."beneficiaryId"), r.date DESC
        )
        SELECT 
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) AS "totalReports",
 
          -- Outreach Actions
          COUNT(DISTINCT lr."beneficiaryId") FILTER (WHERE lr."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = lr."beneficiaryId" AND bg.name = 'Pregnant Women')) AS "activePregnantWomen",
          COUNT(DISTINCT lr."beneficiaryId") FILTER (WHERE lr."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = lr."beneficiaryId" AND bg.name = 'Lactating Women')) AS "activeLactatingMothers",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr."reportData"->>'samMamStatus' = 'SAM') AS "activeSamChildren",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr."reportData"->>'samMamStatus' = 'MAM') AS "activeMamChildren",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years BETWEEN 10 AND 19) AS "adolescentGirls",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_months <= 6) AS "infantsEbfPromotion",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_months > 6 AND lr.age_years < 2) AS "infantsCfPromotion",
          COUNT(DISTINCT lr."beneficiaryId") FILTER (
            WHERE lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
            AND lr."reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
            AND lr."reportData"->>'edd' IS NOT NULL
            AND lr."reportData"->>'edd' != '' 
            AND to_date(lr."reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
            AND to_date(lr."reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days'
            AND lr."childId" IS NULL
          ) AS "womenDueForDelivery30Days",
 
          -- Episodes of Care
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (WHERE lr.age_years > 19) AS "adults",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (WHERE lr.age_years BETWEEN 10 AND 19) AS "adolescents",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_years < 6) AS "childrenUnder5",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_years >= 6 AND lr.age_years < 10) AS "children6To10",
 
          -- Activity Session Demographics
          COUNT(DISTINCT lr."beneficiaryId") FILTER (WHERE lr."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = lr."beneficiaryId" AND bg.name = 'Pregnant Women')) AS "pregnantWomen",
          COUNT(DISTINCT lr."beneficiaryId") FILTER (WHERE lr."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = lr."beneficiaryId" AND bg.name = 'Lactating Women')) AS "lactatingWomen",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr."reportData"->>'samMamStatus' = 'MAM' AND lr.age_years <= 5) AS "mam0to5",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr."reportData"->>'samMamStatus' = 'SAM' AND lr.age_years <= 5) AS "sam0to5",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (
            WHERE LOWER(TRIM(lr.gender)) = 'female' 
            AND lr."maritalStatus" = 'Married' 
            AND lr.age_years BETWEEN 15 AND 24 
            AND lr."childId" IS NULL
            AND (lr."reportData"->>'pregnancyStatus' IS NULL OR lr."reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          ) AS "youngMarriedWomen",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_years < 1) AS "infantsLessThan1",
          COUNT(DISTINCT lr."childId") FILTER (WHERE lr.age_years >= 1 AND lr.age_years < 3) AS "toddlers1To3",
          COUNT(DISTINCT lr."childId") FILTER (WHERE LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years >= 3 AND lr.age_years < 6) AS "childrenBelow6Girls",
          COUNT(DISTINCT lr."childId") FILTER (WHERE LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years >= 3 AND lr.age_years < 6) AS "childrenBelow6Boys",
          COUNT(DISTINCT lr."childId") FILTER (WHERE LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years >= 6 AND lr.age_years < 10) AS "childrenAbove6Girls",
          COUNT(DISTINCT lr."childId") FILTER (WHERE LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years >= 6 AND lr.age_years < 10) AS "childrenAbove6Boys",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years BETWEEN 10 AND 19) AS "adolescentBoys",
          COUNT(DISTINCT lr."beneficiaryId") FILTER (WHERE LOWER(TRIM(lr."typeof")) = 'stakeholder') AS "stakeholders",
          COUNT(DISTINCT COALESCE(lr."childId"::text, 'ben_' || lr."beneficiaryId"::text)) FILTER (
            WHERE NOT ((lr."reportData"->>'pregnancyStatus' IN ('Currently Pregnant', 'Baby Delivered') AND lr."childId" IS NULL)
            OR (lr."reportData"->>'samMamStatus' IN ('MAM', 'SAM') AND lr.age_years <= 5)
            OR (
              LOWER(TRIM(lr.gender)) = 'female' 
              AND lr."maritalStatus" = 'Married' 
              AND lr.age_years BETWEEN 15 AND 24 
              AND lr."childId" IS NULL 
              AND (lr."reportData"->>'pregnancyStatus' IS NULL OR lr."reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
            )
            OR (lr.age_years < 3)
            OR (LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years >= 3 AND lr.age_years < 6)
            OR (LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years >= 3 AND lr.age_years < 6)
            OR (LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years >= 6 AND lr.age_years < 10)
            OR (LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years >= 6 AND lr.age_years < 10)
            OR (LOWER(TRIM(lr.gender)) = 'female' AND lr.age_years BETWEEN 10 AND 19)
            OR (LOWER(TRIM(lr.gender)) = 'male' AND lr.age_years BETWEEN 10 AND 19)
            OR LOWER(TRIM(lr."typeof")) = 'stakeholder')
          ) AS "otherBeneficiaries"
        FROM LatestReports lr;
      `;
      statsRaw = await this.prisma.$queryRawUnsafe(uniqueQuery);
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
 
          -- Outreach Actions
          COUNT(*) FILTER (WHERE rd."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = rd."beneficiaryId" AND bg.name = 'Pregnant Women')) AS "activePregnantWomen",
          COUNT(*) FILTER (WHERE rd."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = rd."beneficiaryId" AND bg.name = 'Lactating Women')) AS "activeLactatingMothers",
          COUNT(*) FILTER (WHERE rd."reportData"->>'samMamStatus' = 'SAM') AS "activeSamChildren",
          COUNT(*) FILTER (WHERE rd."reportData"->>'samMamStatus' = 'MAM') AS "activeMamChildren",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years BETWEEN 10 AND 19) AS "adolescentGirls",
          COUNT(*) FILTER (WHERE rd.age_months <= 6) AS "infantsEbfPromotion",
          COUNT(*) FILTER (WHERE rd.age_months > 6 AND rd.age_years < 2) AS "infantsCfPromotion",
          COUNT(*) FILTER (
            WHERE rd."reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
            AND rd."reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
            AND rd."reportData"->>'edd' IS NOT NULL
            AND rd."reportData"->>'edd' != '' 
            AND to_date(rd."reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
            AND to_date(rd."reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days'
            AND rd."childId" IS NULL
          ) AS "womenDueForDelivery30Days",
 
          -- Episodes of Care
          COUNT(*) FILTER (WHERE rd.age_years > 19) AS "adults",
          COUNT(*) FILTER (WHERE rd.age_years BETWEEN 10 AND 19) AS "adolescents",
          COUNT(*) FILTER (WHERE rd.age_years < 6) AS "childrenUnder5",
          COUNT(*) FILTER (WHERE rd.age_years >= 6 AND rd.age_years < 10) AS "children6To10",
 
          -- Activity Session Demographics
          COUNT(*) FILTER (WHERE rd."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = rd."beneficiaryId" AND bg.name = 'Pregnant Women')) AS "pregnantWomen",
          COUNT(*) FILTER (WHERE rd."childId" IS NULL AND EXISTS (SELECT 1 FROM "GroupMember" gm INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id WHERE gm."beneficiaryId" = rd."beneficiaryId" AND bg.name = 'Lactating Women')) AS "lactatingWomen",
          COUNT(*) FILTER (WHERE rd."reportData"->>'samMamStatus' = 'MAM' AND rd.age_years <= 5) AS "mam0to5",
          COUNT(*) FILTER (WHERE rd."reportData"->>'samMamStatus' = 'SAM' AND rd.age_years <= 5) AS "sam0to5",
          COUNT(*) FILTER (
            WHERE LOWER(TRIM(rd.gender)) = 'female' 
            AND rd."maritalStatus" = 'Married' 
            AND rd.age_years BETWEEN 15 AND 24 
            AND rd."childId" IS NULL
            AND (rd."reportData"->>'pregnancyStatus' IS NULL OR rd."reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
          ) AS "youngMarriedWomen",
          COUNT(*) FILTER (WHERE rd.age_years < 1) AS "infantsLessThan1",
          COUNT(*) FILTER (WHERE rd.age_years >= 1 AND rd.age_years < 3) AS "toddlers1To3",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years >= 3 AND rd.age_years < 6) AS "childrenBelow6Girls",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years >= 3 AND rd.age_years < 6) AS "childrenBelow6Boys",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years >= 6 AND rd.age_years < 10) AS "childrenAbove6Girls",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years >= 6 AND rd.age_years < 10) AS "childrenAbove6Boys",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years BETWEEN 10 AND 19) AS "adolescentGirls2",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years BETWEEN 10 AND 19) AS "adolescentBoys",
          COUNT(*) FILTER (WHERE LOWER(TRIM(rd."typeof")) = 'stakeholder') AS "stakeholders",
          COUNT(*) FILTER (
            WHERE NOT ((rd."reportData"->>'pregnancyStatus' IN ('Currently Pregnant', 'Baby Delivered') AND rd."childId" IS NULL)
            OR (rd."reportData"->>'samMamStatus' IN ('MAM', 'SAM') AND rd.age_years <= 5)
            OR (
              LOWER(TRIM(rd.gender)) = 'female' 
              AND rd."maritalStatus" = 'Married' 
              AND rd.age_years BETWEEN 15 AND 24 
              AND rd."childId" IS NULL 
              AND (rd."reportData"->>'pregnancyStatus' IS NULL OR rd."reportData"->>'pregnancyStatus' NOT IN ('Currently Pregnant', 'Baby Delivered'))
            )
            OR (rd.age_years < 3)
            OR (LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years >= 3 AND rd.age_years < 6)
            OR (LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years >= 3 AND rd.age_years < 6)
            OR (LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years >= 6 AND rd.age_years < 10)
            OR (LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years >= 6 AND rd.age_years < 10)
            OR (LOWER(TRIM(rd.gender)) = 'female' AND rd.age_years BETWEEN 10 AND 19)
            OR (LOWER(TRIM(rd.gender)) = 'male' AND rd.age_years BETWEEN 10 AND 19)
            OR LOWER(TRIM(rd."typeof")) = 'stakeholder')
          ) AS "otherBeneficiaries"
        FROM ReportData rd;
      `;
      statsRaw = await this.prisma.$queryRawUnsafe(nonUniqueQuery);
    }

    return statsRaw[0] || {};
  }
}
