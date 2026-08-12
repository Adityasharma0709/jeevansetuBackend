import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.beneficiaryGroup.findMany();
  console.log('--- BENEFICIARY GROUPS ---');
  console.log(groups);
  console.log('--------------------------');

  // Let's also check user Sanjay's details
  const user = await prisma.user.findFirst({
    where: { email: { equals: 'Sanjay.Bhat@isdrr.org', mode: 'insensitive' } }
  });
  console.log('--- USER SANJAY ---');
  console.log(user);

  if (user) {
    const reportCount = await prisma.activityReport.count({
      where: { reportedById: user.id }
    });
    console.log(`Report count: ${reportCount}`);

    // Let's print unique groups associated with reports reported by Sanjay
    const reports = await prisma.activityReport.findMany({
      where: { reportedById: user.id },
      include: {
        beneficiary: {
          include: {
            groups: {
              include: { group: true }
            }
          }
        },
        child: {
          include: {
            childGroups: {
              include: { group: true }
            }
          }
        }
      }
    });

    const groupNames = new Set<string>();
    reports.forEach(r => {
      r.beneficiary?.groups?.forEach(g => groupNames.add(g.group.name));
      r.child?.childGroups?.forEach(cg => groupNames.add(cg.group.name));
    });
    console.log('--- GROUPS OF SANJAY\'S BENEFICIARIES IN REPORTS ---');
    console.log(Array.from(groupNames));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
