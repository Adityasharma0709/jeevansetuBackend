import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const managerId = 11; // just picking a number
  console.log("Testing getBeneficiaries Prisma query...");
  try {
    // Mock getting project IDs
    const projectIds = [1, 2, 3];

    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        projectId: { in: projectIds },
        createdBy: { createdByAdminId: managerId }
      },
      include: {
        project: true,
        location: true,
        createdBy: { select: { name: true, email: true, mobileNumber: true } }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`Success! Found ${beneficiaries.length} beneficiaries.`);
  } catch (e) {
    console.error("PRISMA ERROR IS:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
