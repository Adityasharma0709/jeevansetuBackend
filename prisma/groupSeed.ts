import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Beneficiary Groups...');

  const superAdminUser = await prisma.user.findUnique({
    where: { email: 'superadmin@jeevansetu.com' },
  });

  if (!superAdminUser) {
    throw new Error('Super Admin user (superadmin@jeevansetu.com) not found. Please seed roles and super admin first.');
  }

  const groupNames = [
    'Young Married Women',
    'Pregnant Women',
    'Lactating Women',
    'Adolescent Girls',
    'Adolescent Boys',
    'Children above 6(6-9 Years) - Girls',
    'Children above 6 (6-9 Years) - Boys',
    'Children below 6(3-6 Years) - Girls',
    'Children below 6(3-6 Years) - Boys',
    'Stakeholders',
    'Other Beneficiaries - Females',
    'Other Beneficiaries - Males',
    'SAM Children [0-5 Years]',
    'MAM Children [0-5 Years]',
    'Infant',
    'Toddler'
  ];

  for (const name of groupNames) {
    const group = await prisma.beneficiaryGroup.upsert({
      where: { name },
      update: { status: 'ACTIVE' },
      create: {
        name,
        createdById: superAdminUser.id,
        status: 'ACTIVE'
      }
    });
    console.log(`✅ Seeded group: ${group.name}`);
  }

  console.log('🌱 Seeding groups completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
