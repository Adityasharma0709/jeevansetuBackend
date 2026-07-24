import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

// Mock OutreachService.getMyReports logic to verify returned payload fields and values
async function getMyReportsMock(user: any, projectId?: number) {
  const roles = user.roles || [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const isAnalyst = roles.includes('ANALYST');
  const isAdmin = roles.includes('ADMIN');
  const isManager = roles.includes('MANAGER');

  let where: any = {};

  if (!isSuperAdmin) {
    if (isAnalyst) {
      if (!projectId) {
        throw new Error('projectId is required for Analyst role');
      }
      where.beneficiary = { projectId };
    }
  }

  return prisma.activityReport.findMany({
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
        }
      }
    }
  });
}

async function main() {
  const mockUser = {
    userId: 2, // Mock user ID
    roles: ['ANALYST']
  };

  console.log('Simulating getMyReports for Analyst with projectId = 1...');
  const reports = await getMyReportsMock(mockUser, 1);
  console.log(`Returned ${reports.length} reports.`);

  const match = reports.find((r) => r.beneficiaryId === 2192);
  console.log('Matching report for beneficiary 2192:', match ? {
    id: match.id,
    beneficiaryId: match.beneficiaryId,
    beneficiaryName: match.beneficiary?.name,
    beneficiaryDetails: match.beneficiary
  } : 'NOT FOUND!');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
