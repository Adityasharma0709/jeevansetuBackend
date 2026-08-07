import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface OutreachDynamicsOptions {
  projectIds: number[];
  reporterIds?: number[];
  creatorIds?: number[];
  state?: string;
  district?: string;
  block?: string;
  awc?: string;
  activityId?: number;
  sessionId?: number;
}

@Injectable()
export class OutreachDynamicsService {
  constructor(private prisma: PrismaService) {}

  async getStats(options: OutreachDynamicsOptions) {
    const projectIdsStr = options.projectIds.join(',') || '0';
    const reporterFilterStr = options.reporterIds && options.reporterIds.length > 0 
      ? `AND r."reportedById" IN (${options.reporterIds.join(',')})` 
      : '';
    const creatorFilterStr = options.creatorIds && options.creatorIds.length > 0 
      ? `AND b."createdById" IN (${options.creatorIds.join(',')})` 
      : '';

    const escapeStr = (val: string) => val.replace(/'/g, "''");
    let locFilterStr = '';
    if (options.state && options.state !== 'ALL') {
      locFilterStr += ` AND LOWER(b.state) = LOWER('${escapeStr(options.state)}')`;
    }
    if (options.district && options.district !== 'ALL') {
      locFilterStr += ` AND LOWER(b.district) = LOWER('${escapeStr(options.district)}')`;
    }
    if (options.block && options.block !== 'ALL') {
      locFilterStr += ` AND LOWER(b.block) = LOWER('${escapeStr(options.block)}')`;
    }
    if (options.awc && options.awc !== 'ALL') {
      locFilterStr += ` AND LOWER(a."awcName") = LOWER('${escapeStr(options.awc)}')`;
    }

    // a. Currently Pregnant Women
    const pregnantCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId", r.date
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${projectIdsStr})
          ${reporterFilterStr}
          ${locFilterStr}
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

    // a_hrp. High Risk Pregnant Women
    const hrpCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId", r.date
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${projectIdsStr})
          ${reporterFilterStr}
          ${locFilterStr}
        ORDER BY "beneficiaryId", r.date DESC
      )
      SELECT COUNT(*) AS count
      FROM LatestReports
      WHERE "childId" IS NULL
        AND "reportData"->>'pregnancyStatus' = 'Currently Pregnant'
        AND ("reportData"->>'pregnancyOutcome' IS NULL OR "reportData"->>'pregnancyOutcome' = 'null' OR "reportData"->>'pregnancyOutcome' = '')
        AND "reportData"->>'highRiskPregnant' = 'Yes';
    `;
    const hrpRaw: any[] = await this.prisma.$queryRawUnsafe(hrpCountQuery);
    const activeHighRiskPregnantWomen = Number(hrpRaw[0]?.count || 0);

    // b. Currently Lactating Mothers
    const lactatingCountQuery = `
      SELECT COUNT(DISTINCT id) AS count FROM (
        SELECT b.id
        FROM "Beneficiary" b
        INNER JOIN "BeneficiaryChild" c ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
          ${creatorFilterStr}
          ${locFilterStr}
        UNION
        SELECT "beneficiaryId" AS id
        FROM (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", date, "childId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr})
            ${reporterFilterStr}
            ${locFilterStr}
          ORDER BY "beneficiaryId", r.date DESC
        ) lr
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Baby Delivered'
          AND lr.date >= CURRENT_DATE - INTERVAL '2 years'
      ) combined;
    `;
    const lactatingRaw: any[] = await this.prisma.$queryRawUnsafe(lactatingCountQuery);
    const activeLactatingMothers = Number(lactatingRaw[0]?.count || 0);

    // c. SAM Children
    const samCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("childId") "childId", "reportData"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
          ${reporterFilterStr}
          ${locFilterStr}
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

    // d. MAM Children
    const mamCountQuery = `
      WITH LatestReports AS (
        SELECT DISTINCT ON ("childId") "childId", "reportData"
        FROM "ActivityReport" r
        INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
          ${reporterFilterStr}
          ${locFilterStr}
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

    // e. Adolescent Girls
    const adolescentCountQuery = `
      SELECT COUNT(*) AS count
      FROM "Beneficiary" b
      LEFT JOIN "Awc" a ON b."awcId" = a.id
      WHERE b."projectId" IN (${projectIdsStr})
        AND LOWER(TRIM(b.gender)) = 'female'
        AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) BETWEEN 10 AND 19
        ${creatorFilterStr}
        ${locFilterStr};
    `;
    const adolescentRaw: any[] = await this.prisma.$queryRawUnsafe(adolescentCountQuery);
    const adolescentGirls = Number(adolescentRaw[0]?.count || 0);

    // f. Infants for EBF Promotion
    const ebfCountQuery = `
      SELECT COUNT(*) AS count
      FROM "BeneficiaryChild" c
      INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
      LEFT JOIN "Awc" a ON b."awcId" = a.id
      WHERE b."projectId" IN (${projectIdsStr})
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '6 months'
        ${creatorFilterStr}
        ${locFilterStr};
    `;
    const ebfRaw: any[] = await this.prisma.$queryRawUnsafe(ebfCountQuery);
    const infantsEbfPromotion = Number(ebfRaw[0]?.count || 0);

    // g. Infants for CF Promotion
    const cfCountQuery = `
      SELECT COUNT(*) AS count
      FROM "BeneficiaryChild" c
      INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
      LEFT JOIN "Awc" a ON b."awcId" = a.id
      WHERE b."projectId" IN (${projectIdsStr})
        AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
        AND c."dateOfBirth" < CURRENT_DATE - INTERVAL '6 months'
        ${creatorFilterStr}
        ${locFilterStr};
    `;
    const cfRaw: any[] = await this.prisma.$queryRawUnsafe(cfCountQuery);
    const infantsCfPromotion = Number(cfRaw[0]?.count || 0);

    // h. Women due for delivery in next 30 days
    const dueCountQuery = `
      SELECT COUNT(DISTINCT r."beneficiaryId") AS count
      FROM "ActivityReport" r
      INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
      LEFT JOIN "Awc" a ON b."awcId" = a.id
      WHERE b."projectId" IN (${projectIdsStr})
        ${reporterFilterStr}
        ${locFilterStr}
        AND r."childId" IS NULL
        AND r."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
        AND r."reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
        AND r."reportData"->>'edd' IS NOT NULL
        AND r."reportData"->>'edd' != '' 
        AND to_date(r."reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
        AND to_date(r."reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days';
    `;
    const dueRaw: any[] = await this.prisma.$queryRawUnsafe(dueCountQuery);
    const womenDueForDelivery30Days = Number(dueRaw[0]?.count || 0);

    return {
      activePregnantWomen,
      activeHighRiskPregnantWomen,
      activeLactatingMothers,
      activeSamChildren,
      activeMamChildren,
      adolescentGirls,
      infantsEbfPromotion,
      infantsCfPromotion,
      womenDueForDelivery30Days
    };
  }

  async getDetails(groupName: string, options: OutreachDynamicsOptions) {
    const projectIdsStr = options.projectIds.join(',') || '0';
    const reporterFilterStr = options.reporterIds && options.reporterIds.length > 0 
      ? `AND r."reportedById" IN (${options.reporterIds.join(',')})` 
      : '';
    const creatorFilterStr = options.creatorIds && options.creatorIds.length > 0 
      ? `AND b."createdById" IN (${options.creatorIds.join(',')})` 
      : '';

    const escapeStr = (val: string) => val.replace(/'/g, "''");
    let locFilterStr = '';
    if (options.state && options.state !== 'ALL') {
      locFilterStr += ` AND LOWER(b.state) = LOWER('${escapeStr(options.state)}')`;
    }
    if (options.district && options.district !== 'ALL') {
      locFilterStr += ` AND LOWER(b.district) = LOWER('${escapeStr(options.district)}')`;
    }
    if (options.block && options.block !== 'ALL') {
      locFilterStr += ` AND LOWER(b.block) = LOWER('${escapeStr(options.block)}')`;
    }
    if (options.awc && options.awc !== 'ALL') {
      locFilterStr += ` AND LOWER(a."awcName") = LOWER('${escapeStr(options.awc)}')`;
    }

    const clean = (groupName || '').trim().toUpperCase();
    let rawRecords: any[] = [];
    let queryStr = '';

    if (clean.includes('HIGH RISK') || clean.includes('HRP')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId", r.date, r."activityId", r."sessionId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr})
            ${reporterFilterStr}
            ${locFilterStr}
          ORDER BY "beneficiaryId", r.date DESC
        )
        SELECT b.uid AS id, b.id AS "benId", b.name, b."typeof" AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "GroupMember" gm
                 INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
                 WHERE gm."beneficiaryId" = b.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 
               COALESCE(act.name, 'N/A') AS activity, 
               COALESCE(sess.name, 'N/A') AS session, 
               lr.date AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               'N/A' AS school,
               'N/A' AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "Beneficiary" b
        INNER JOIN LatestReports lr ON b.id = lr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "Activity" act ON lr."activityId" = act.id
        LEFT JOIN "Session" sess ON lr."sessionId" = sess.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
          AND (lr."reportData"->>'pregnancyOutcome' IS NULL OR lr."reportData"->>'pregnancyOutcome' = 'null' OR lr."reportData"->>'pregnancyOutcome' = '')
          AND lr."reportData"->>'highRiskPregnant' = 'Yes'
        ORDER BY lr.date DESC;
      `;
    } else if (clean.includes('PREGNANT') && !clean.includes('DUE') && !clean.includes('DELIVERY')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", "childId", r.date, r."activityId", r."sessionId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr})
            ${reporterFilterStr}
            ${locFilterStr}
          ORDER BY "beneficiaryId", r.date DESC
        )
        SELECT b.uid AS id, b.id AS "benId", b.name, b."typeof" AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "GroupMember" gm
                 INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
                 WHERE gm."beneficiaryId" = b.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 
               COALESCE(act.name, 'N/A') AS activity, 
               COALESCE(sess.name, 'N/A') AS session, 
               lr.date AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               'N/A' AS school,
               'N/A' AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "Beneficiary" b
        INNER JOIN LatestReports lr ON b.id = lr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "Activity" act ON lr."activityId" = act.id
        LEFT JOIN "Session" sess ON lr."sessionId" = sess.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE lr."childId" IS NULL
          AND lr."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
          AND (lr."reportData"->>'pregnancyOutcome' IS NULL OR lr."reportData"->>'pregnancyOutcome' = 'null' OR lr."reportData"->>'pregnancyOutcome' = '')
        ORDER BY lr.date DESC;
      `;
    } else if (clean.includes('LACTATING') || clean.includes('MOTHER')) {
      queryStr = `
        SELECT DISTINCT id, "benId", name, typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "GroupMember" gm
                 INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
                 WHERE gm."beneficiaryId" = "benId"
               ), 'N/A') AS group,
               awc, project, gender, "guardianName", age, "childNameAndAge", 
               COALESCE(activity, 'N/A') AS activity, 
               COALESCE(session, 'N/A') AS session, 
               latest_date AS "reportingDate",
               district, block, village, school, "motherName", "healthCenter"
        FROM (
          SELECT b.uid AS id, b.id AS "benId", b.name, COALESCE(a."awcName", 'N/A') AS awc,
                 p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
                 EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
                  (
                    SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
                    FROM "BeneficiaryChild" c_sub
                    WHERE c_sub."beneficiaryId" = b.id
                  ) AS "childNameAndAge",
                  (SELECT MAX(date) FROM "ActivityReport" r WHERE r."beneficiaryId" = b.id) AS latest_date,
                  b."typeof" AS typeof,
                  COALESCE((
                    SELECT act.name 
                    FROM "ActivityReport" r 
                    INNER JOIN "Activity" act ON r."activityId" = act.id 
                    WHERE r."beneficiaryId" = b.id 
                    ORDER BY r.date DESC LIMIT 1
                  ), 'N/A') AS activity,
                  COALESCE((
                    SELECT sess.name 
                    FROM "ActivityReport" r 
                    INNER JOIN "Session" sess ON r."sessionId" = sess.id 
                    WHERE r."beneficiaryId" = b.id 
                    ORDER BY r.date DESC LIMIT 1
                  ), 'N/A') AS session,
                  COALESCE(b.district, 'N/A') AS district,
                  COALESCE(b.block, 'N/A') AS block,
                  COALESCE(b.village, 'N/A') AS village,
                  'N/A' AS school,
                  'N/A' AS "motherName",
                  COALESCE(hc.name, 'N/A') AS "healthCenter"
           FROM "Beneficiary" b
           INNER JOIN "BeneficiaryChild" c ON c."beneficiaryId" = b.id
           LEFT JOIN "Awc" a ON b."awcId" = a.id
           LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
           LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
           WHERE b."projectId" IN (${projectIdsStr})
             AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
             ${creatorFilterStr}
             ${locFilterStr}
           GROUP BY b.uid, b.id, b.name, a."awcName", p_proj.name, b.gender, b."guardianName", b."dateOfBirth", b."typeof", b.district, b.block, b.village, hc.name
           UNION
          SELECT b.uid AS id, b.id AS "benId", b.name, COALESCE(a."awcName", 'N/A') AS awc,
                 p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
                 EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
                 (
                   SELECT STRING_AGG(c_sub.name || ' (' || EXTRACT(YEAR FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")) || 'y ' || (EXTRACT(MONTH FROM AGE(CURRENT_DATE, c_sub."dateOfBirth")))::integer % 12 || 'm)', ', ')
                   FROM "BeneficiaryChild" c_sub
                   WHERE c_sub."beneficiaryId" = b.id
                 ) AS "childNameAndAge",
                 lr.date AS latest_date,
                 b."typeof" AS typeof,
                 act.name AS activity,
                 sess.name AS session,
                 COALESCE(b.district, 'N/A') AS district,
                 COALESCE(b.block, 'N/A') AS block,
                 COALESCE(b.village, 'N/A') AS village,
                 'N/A' AS school,
                 'N/A' AS "motherName",
                 COALESCE(hc.name, 'N/A') AS "healthCenter"
          FROM "Beneficiary" b
          INNER JOIN (
            SELECT DISTINCT ON ("beneficiaryId") "beneficiaryId", "reportData", date, "childId", "activityId", "sessionId"
            FROM "ActivityReport" r
            INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
            LEFT JOIN "Awc" a ON b."awcId" = a.id
            WHERE b."projectId" IN (${projectIdsStr})
              ${reporterFilterStr}
              ${locFilterStr}
            ORDER BY "beneficiaryId", r.date DESC
          ) lr ON b.id = lr."beneficiaryId"
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
          LEFT JOIN "Activity" act ON lr."activityId" = act.id
          LEFT JOIN "Session" sess ON lr."sessionId" = sess.id
          LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
          WHERE lr."childId" IS NULL
            AND lr."reportData"->>'pregnancyStatus' = 'Baby Delivered'
            AND lr.date >= CURRENT_DATE - INTERVAL '2 years'
        ) combined
        ORDER BY latest_date DESC;
      `;
    } else if (clean.includes('SAM')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("childId") "childId", "reportData", r.date, r."activityId", r."sessionId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
            ${reporterFilterStr}
            ${locFilterStr}
          ORDER BY "childId", r.date DESC
        )
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Child' AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "ChildGroupMember" cgm
                 INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
                 WHERE cgm."childId" = c.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 
               COALESCE(act.name, 'N/A') AS activity, 
               COALESCE(sess.name, 'N/A') AS session, 
               lr.date AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               COALESCE(c."schoolingStatus", 'N/A') AS school,
               b.name AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM LatestReports lr
        INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "Activity" act ON lr."activityId" = act.id
        LEFT JOIN "Session" sess ON lr."sessionId" = sess.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE lr."reportData"->>'samMamStatus' = 'SAM'
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years'
        ORDER BY lr.date DESC;
      `;
    } else if (clean.includes('MAM')) {
      queryStr = `
        WITH LatestReports AS (
          SELECT DISTINCT ON ("childId") "childId", "reportData", r.date, r."activityId", r."sessionId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr}) AND r."childId" IS NOT NULL
            ${reporterFilterStr}
            ${locFilterStr}
          ORDER BY "childId", r.date DESC
        )
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Child' AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "ChildGroupMember" cgm
                 INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
                 WHERE cgm."childId" = c.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge", 
               COALESCE(act.name, 'N/A') AS activity, 
               COALESCE(sess.name, 'N/A') AS session, 
               lr.date AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               COALESCE(c."schoolingStatus", 'N/A') AS school,
               b.name AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM LatestReports lr
        INNER JOIN "BeneficiaryChild" c ON lr."childId" = c.id
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "Activity" act ON lr."activityId" = act.id
        LEFT JOIN "Session" sess ON lr."sessionId" = sess.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE lr."reportData"->>'samMamStatus' = 'MAM'
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '5 years'
        ORDER BY lr.date DESC;
      `;
    } else if (clean.includes('ADOLESCENT')) {
       queryStr = `
        SELECT b.uid AS id, b.id AS "benId", b.name, b."typeof" AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "GroupMember" gm
                 INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
                 WHERE gm."beneficiaryId" = b.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge",
               COALESCE((
                 SELECT act.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Activity" act ON r."activityId" = act.id 
                 WHERE r."beneficiaryId" = b.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS activity,
               COALESCE((
                 SELECT sess.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Session" sess ON r."sessionId" = sess.id 
                 WHERE r."beneficiaryId" = b.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS session,
               (
                 SELECT r.date 
                 FROM "ActivityReport" r 
                 WHERE r."beneficiaryId" = b.id 
                 ORDER BY r.date DESC LIMIT 1
               ) AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               'N/A' AS school,
               'N/A' AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "Beneficiary" b
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND LOWER(TRIM(b.gender)) = 'female'
          AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) BETWEEN 10 AND 19
          ${creatorFilterStr}
          ${locFilterStr}
        ORDER BY (SELECT MAX(date) FROM "ActivityReport" r WHERE r."beneficiaryId" = b.id) DESC NULLS LAST, b."createdAt" DESC;
      `;
    } else if (clean.includes('EBF')) {
      queryStr = `
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Child' AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "ChildGroupMember" cgm
                 INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
                 WHERE cgm."childId" = c.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge",
               COALESCE((
                 SELECT act.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Activity" act ON r."activityId" = act.id 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS activity,
               COALESCE((
                 SELECT sess.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Session" sess ON r."sessionId" = sess.id 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS session,
               (
                 SELECT r.date 
                 FROM "ActivityReport" r 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ) AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               COALESCE(c."schoolingStatus", 'N/A') AS school,
               b.name AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '6 months'
          ${creatorFilterStr}
          ${locFilterStr}
        ORDER BY (SELECT MAX(date) FROM "ActivityReport" r WHERE r."childId" = c.id) DESC NULLS LAST, c."dateOfBirth" DESC;
      `;
    } else if (clean.includes('CF')) {
      queryStr = `
        SELECT c.uid AS id, b.id AS "benId", c.name, 'Child' AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "ChildGroupMember" cgm
                 INNER JOIN "BeneficiaryGroup" bg ON cgm."groupId" = bg.id
                 WHERE cgm."childId" = c.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, c.gender AS gender, b.name AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, c."dateOfBirth")) || 'y ' || EXTRACT(MONTH FROM AGE(CURRENT_DATE, c."dateOfBirth"))::integer % 12 || 'm' AS age,
               'N/A' AS "childNameAndAge",
               COALESCE((
                 SELECT act.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Activity" act ON r."activityId" = act.id 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS activity,
               COALESCE((
                 SELECT sess.name 
                 FROM "ActivityReport" r 
                 INNER JOIN "Session" sess ON r."sessionId" = sess.id 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ), 'N/A') AS session,
               (
                 SELECT r.date 
                 FROM "ActivityReport" r 
                 WHERE r."childId" = c.id 
                 ORDER BY r.date DESC LIMIT 1
               ) AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               COALESCE(c."schoolingStatus", 'N/A') AS school,
               b.name AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "BeneficiaryChild" c
        INNER JOIN "Beneficiary" b ON c."beneficiaryId" = b.id
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        WHERE b."projectId" IN (${projectIdsStr})
          AND c."dateOfBirth" >= CURRENT_DATE - INTERVAL '2 years'
          AND c."dateOfBirth" < CURRENT_DATE - INTERVAL '6 months'
          ${creatorFilterStr}
          ${locFilterStr}
        ORDER BY (SELECT MAX(date) FROM "ActivityReport" r WHERE r."childId" = c.id) DESC NULLS LAST, c."dateOfBirth" DESC;
      `;
    } else if (clean.includes('DUE') || clean.includes('DELIVERY')) {
      queryStr = `
        WITH MatchingReports AS (
          SELECT DISTINCT ON (r."beneficiaryId") 
            r."beneficiaryId", r."reportData", r."childId", r.date, r."activityId", r."sessionId"
          FROM "ActivityReport" r
          INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
          LEFT JOIN "Awc" a ON b."awcId" = a.id
          WHERE b."projectId" IN (${projectIdsStr})
            ${reporterFilterStr}
            ${locFilterStr}
            AND r."childId" IS NULL
            AND r."reportData"->>'pregnancyStatus' = 'Currently Pregnant'
            AND r."reportData"->>'lmpDate' ~ '[0-9]{2}/[0-9]{2}/[0-9]{4}'
            AND r."reportData"->>'edd' IS NOT NULL
            AND r."reportData"->>'edd' != ''
            AND to_date(r."reportData"->>'edd', 'DD/MM/YYYY') >= CURRENT_DATE
            AND to_date(r."reportData"->>'edd', 'DD/MM/YYYY') < CURRENT_DATE + INTERVAL '30 days'
          ORDER BY r."beneficiaryId", r.date DESC
        )
        SELECT b.uid AS id, b.id AS "benId", b.name, b."typeof" AS typeof,
               COALESCE((
                 SELECT STRING_AGG(bg.name, ', ')
                 FROM "GroupMember" gm
                 INNER JOIN "BeneficiaryGroup" bg ON gm."groupId" = bg.id
                 WHERE gm."beneficiaryId" = b.id
               ), 'N/A') AS group,
               COALESCE(a."awcName", 'N/A') AS awc,
               p_proj.name AS project, b.gender AS gender, COALESCE(b."guardianName", 'N/A') AS "guardianName",
               EXTRACT(YEAR FROM AGE(CURRENT_DATE, b."dateOfBirth")) || ' Y' AS age,
               'N/A' AS "childNameAndAge", 
               COALESCE(act.name, 'N/A') AS activity, 
               COALESCE(sess.name, 'N/A') AS session, 
               mr.date AS "reportingDate",
               COALESCE(b.district, 'N/A') AS district,
               COALESCE(b.block, 'N/A') AS block,
               COALESCE(b.village, 'N/A') AS village,
               'N/A' AS school,
               'N/A' AS "motherName",
               COALESCE(hc.name, 'N/A') AS "healthCenter"
        FROM "Beneficiary" b
        INNER JOIN MatchingReports mr ON b.id = mr."beneficiaryId"
        LEFT JOIN "Awc" a ON b."awcId" = a.id
        LEFT JOIN "Project" p_proj ON b."projectId" = p_proj.id
        LEFT JOIN "Activity" act ON mr."activityId" = act.id
        LEFT JOIN "Session" sess ON mr."sessionId" = sess.id
        LEFT JOIN "HealthCenter" hc ON b."healthCenterId" = hc.id
        ORDER BY mr.date DESC;
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
      activity: record.activity || 'N/A',
      session: record.session || 'N/A',
      reportingDate: record.reportingDate,
      age: record.age || 'N/A',
      childNameAndAge: record.childNameAndAge || 'N/A',
      beneficiaryType: record.typeof || 'N/A',
      district: record.district || 'N/A',
      block: record.block || 'N/A',
      village: record.village || 'N/A',
      school: record.school || 'N/A',
      motherName: record.motherName || 'N/A',
      healthCenter: record.healthCenter || 'N/A'
    }));
  }
}
