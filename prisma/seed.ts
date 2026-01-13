import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  /* =====================
     1. Create Roles
     ===================== */

  const roles = [
    'SUPER_ADMIN',
    'ADMIN',
    'MANAGER',
    'OUTREACH_WORKER',
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
  }

  console.log('✅ Roles seeded');

  /* =====================
     2. Create Super Admin
     ===================== */

  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@jeevansetu.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'superadmin@jeevansetu.com',
      password: passwordHash,
      status: 'ACTIVE',
    },
  });

  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: superAdmin.id,
          roleId: superAdminRole.id,
        },
      },
      update: {},
      create: {
        userId: superAdmin.id,
        roleId: superAdminRole.id,
      },
    });
  }

  console.log('✅ Super Admin created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
