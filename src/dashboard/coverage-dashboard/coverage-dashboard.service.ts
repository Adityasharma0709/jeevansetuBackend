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

    const countFn = options.unique 
      ? (cond: string) => `COUNT(DISTINCT COALESCE(r."childId", r."beneficiaryId")) FILTER (WHERE ${cond})`
      : (cond: string) => `COUNT(*) FILTER (WHERE ${cond})`;

    const pregnantWomenCond = `r."childId" IS NULL AND r."reportData"->>'pregnancyStatus' = 'Currently Pregnant'`;
    const hrpCond = `
      r."childId" IS NULL 
      AND r."reportData"->>'pregnancyStatus' = 'Currently Pregnant' 
      AND (r."reportData"->>'pregnancyOutcome' IS NULL OR r."reportData"->>'pregnancyOutcome' = 'null' OR r."reportData"->>'pregnancyOutcome' = '')
      AND r."reportData"->>'highRiskPregnant' = 'Yes'
    `;
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
      (
        EXISTS (
          SELECT 1 FROM "GroupMember" gm_other
          INNER JOIN "BeneficiaryGroup" bg_other ON gm_other."groupId" = bg_other.id
          WHERE gm_other."beneficiaryId" = r."beneficiaryId"
            AND UPPER(TRIM(bg_other.name)) LIKE 'OTHER BENEFICIARIES%'
        ) OR EXISTS (
          SELECT 1 FROM "ChildGroupMember" cgm_other
          INNER JOIN "BeneficiaryGroup" bg_other ON cgm_other."groupId" = bg_other.id
          WHERE cgm_other."childId" = r."childId"
            AND UPPER(TRIM(bg_other.name)) LIKE 'OTHER BENEFICIARIES%'
        )
      )
    `;

    const adultsCond = `EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) > 19`;
    const adolescentsCond = `EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19`;
    const childrenUnder5Cond = `EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) < 6`;
    const children6To10Cond = `EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) >= 6 AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) < 10`;

    const hbCond = `r."reportData"->'screeningDetails'->>'hb' IS NOT NULL AND r."reportData"->'screeningDetails'->>'hb' <> ''`;
    const bpCond = `r."reportData"->'screeningDetails'->>'bp' IS NOT NULL AND r."reportData"->'screeningDetails'->>'bp' <> ''`;
    const padsAdolescentsCond = `
      LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' 
      AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19 
      AND r."reportData"->'screeningDetails'->>'pads' IS NOT NULL 
      AND r."reportData"->'screeningDetails'->>'pads' <> '' 
      AND (r."reportData"->'screeningDetails'->>'pads')::integer > 0
    `;
    const padsWomenCond = `
      LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' 
      AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) > 19 
      AND r."reportData"->'screeningDetails'->>'pads' IS NOT NULL 
      AND r."reportData"->'screeningDetails'->>'pads' <> '' 
      AND (r."reportData"->'screeningDetails'->>'pads')::integer > 0
    `;

    const query = `
      SELECT 
        COUNT(*)::integer AS "totalReports",
        ${countFn(pregnantWomenCond)}::integer AS "pregnantWomen",
        ${countFn(hrpCond)}::integer AS "hrpWomen",
        ${countFn(lactatingWomenCond)}::integer AS "lactatingWomen",
        ${countFn(mam0to5Cond)}::integer AS "mam0to5",
        ${countFn(sam0to5Cond)}::integer AS "sam0to5",
        ${countFn(youngMarriedWomenCond)}::integer AS "youngMarriedWomen",
        ${countFn(infantsLessThan1Cond)}::integer AS "infantsLessThan1",
        ${countFn(toddlers1To3Cond)}::integer AS "toddlers1To3",
        ${countFn(childrenBelow6GirlsCond)}::integer AS "childrenBelow6Girls",
        ${countFn(childrenBelow6BoysCond)}::integer AS "childrenBelow6Boys",
        ${countFn(childrenAbove6GirlsCond)}::integer AS "childrenAbove6Girls",
        ${countFn(childrenAbove6BoysCond)}::integer AS "childrenAbove6Boys",
        ${countFn(adolescentGirlsCond)}::integer AS "adolescentGirls2",
        ${countFn(adolescentBoysCond)}::integer AS "adolescentBoys",
        ${countFn(stakeholdersCond)}::integer AS "stakeholders",
        ${countFn(otherBeneficiariesCond)}::integer AS "otherBeneficiaries",
        ${countFn(adultsCond)}::integer AS "adults",
        ${countFn(`${adultsCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "adultsMale",
        ${countFn(`${adultsCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "adultsFemale",
        ${countFn(`${adultsCond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "adultsOthers",
        ${countFn(adolescentsCond)}::integer AS "adolescents",
        ${countFn(`${adolescentsCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "adolescentsMale",
        ${countFn(`${adolescentsCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "adolescentsFemale",
        ${countFn(`${adolescentsCond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "adolescentsOthers",
        ${countFn(childrenUnder5Cond)}::integer AS "childrenUnder5",
        ${countFn(`${childrenUnder5Cond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "childrenUnder5Male",
        ${countFn(`${childrenUnder5Cond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "childrenUnder5Female",
        ${countFn(`${childrenUnder5Cond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "childrenUnder5Others",
        ${countFn(children6To10Cond)}::integer AS "children6To10",
        ${countFn(`${children6To10Cond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "children6To10Male",
        ${countFn(`${children6To10Cond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "children6To10Female",
        ${countFn(`${children6To10Cond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "children6To10Others",
        ${countFn(hbCond)}::integer AS "hbTotal",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "hbMale",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "hbFemale",
        ${countFn(`${hbCond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "hbOthers",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19`)}::integer AS "hbFemaleAdolescent",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) > 19`)}::integer AS "hbFemaleAdult",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) > 19`)}::integer AS "hbMaleAdult",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) BETWEEN 10 AND 19`)}::integer AS "hbMaleAdolescent",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) < 10`)}::integer AS "hbFemaleChildUnder10",
        ${countFn(`${hbCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male' AND EXTRACT(YEAR FROM AGE(r.date, COALESCE(c."dateOfBirth", b."dateOfBirth"))) < 10`)}::integer AS "hbMaleChildUnder10",
        ${countFn(bpCond)}::integer AS "bpTotal",
        ${countFn(`${bpCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'male'`)}::integer AS "bpMale",
        ${countFn(`${bpCond} AND LOWER(TRIM(COALESCE(c.gender, b.gender))) = 'female'`)}::integer AS "bpFemale",
        ${countFn(`${bpCond} AND (LOWER(TRIM(COALESCE(c.gender, b.gender))) NOT IN ('male', 'female') OR COALESCE(c.gender, b.gender) IS NULL)`)}::integer AS "bpOthers",
        ${countFn(padsAdolescentsCond)}::integer AS "padsAdolescents",
        ${countFn(padsWomenCond)}::integer AS "padsWomen"
      FROM "ActivityReport" r
      INNER JOIN "Beneficiary" b ON r."beneficiaryId" = b.id
      LEFT JOIN "BeneficiaryChild" c ON r."childId" = c.id
      LEFT JOIN "Awc" a ON b."awcId" = a.id
      ${whereClause};
    `;

    statsRaw = await this.prisma.$queryRawUnsafe(query);

    return statsRaw[0] || { totalReports: 0 };
  }
}