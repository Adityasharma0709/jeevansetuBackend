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
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) AS "totalReports",
 
          -- Outreach Actions
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '')) AS "activePregnantWomen",
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Baby Delivered' AND "childId" IS NULL) AS "activeLactatingMothers",
          COUNT(DISTINCT "childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'SAM') AS "activeSamChildren",
          COUNT(DISTINCT "childId") FILTER (WHERE "reportData"->>'samMamStatus' = 'MAM') AS "activeMamChildren",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (WHERE LOWER(TRIM(gender)) = 'female' AND age_years BETWEEN 10 AND 19) AS "adolescentGirls",
          COUNT(DISTINCT "childId") FILTER (WHERE age_months <= 6) AS "infantsEbfPromotion",
          COUNT(DISTINCT "childId") FILTER (WHERE age_months > 6 AND age_years < 2) AS "infantsCfPromotion",
          COUNT(DISTINCT "beneficiaryId") FILTER (
            WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
            AND "reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
            AND "reportData"->>'edd' IS NOT NULL
            AND "reportData"->>'edd' != '' 
            AND to_date("reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
            AND to_date("reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days'
            AND "childId" IS NULL
          ) AS "womenDueForDelivery30Days",
 
          -- Episodes of Care
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (WHERE age_years > 19) AS "adults",
          COUNT(DISTINCT COALESCE("childId"::text, 'ben_' || "beneficiaryId"::text)) FILTER (WHERE age_years BETWEEN 10 AND 19) AS "adolescents",
          COUNT(DISTINCT "childId") FILTER (WHERE age_years < 6) AS "childrenUnder5",
          COUNT(DISTINCT "childId") FILTER (WHERE age_years >= 6 AND age_years < 10) AS "children6To10",
 
          -- Activity Session Demographics
          COUNT(DISTINCT "beneficiaryId") FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '')) AS "pregnantWomen",
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
        FROM LatestReports;
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
          COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '')) AS "activePregnantWomen",
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
          COUNT(*) FILTER (WHERE "reportData"->>'pregnancyStatus' = 'Currently Pregnant' AND "childId" IS NULL AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '')) AS "pregnantWomen",
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
      statsRaw = await this.prisma.$queryRawUnsafe(nonUniqueQuery);
    }

    return statsRaw[0] || {};
  }
}
