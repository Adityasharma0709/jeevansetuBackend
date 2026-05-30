import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import geoData from './india_states_districts.json';

const prisma = new PrismaClient();

function toStateLocationCode(stateId: number) {
  const minDigits = 2;
  const numeric = String(stateId);
  const padded =
    numeric.length >= minDigits ? numeric : numeric.padStart(minDigits, '0');
  return `LC${padded}`;
}

async function main() {
  console.log('🌱 Seeding database...');

  /* ================= ROLES ================= */

  const roles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OUTREACH', 'ANALYST'];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
  }

  console.log('✅ Roles seeded');

  /* ================= SUPER ADMIN ================= */

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

  console.log('✅ Super Admin created');

  /* ================= ROLE MAPPING ================= */

  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' },
  });

  if (!superAdminRole) {
    throw new Error('SUPER_ADMIN role not found');
  }

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

  console.log('✅ SUPER_ADMIN role assigned');

  /* ================= STATES & DISTRICTS ================= */

  console.log('📍 Seeding States and Districts...');

  for (const stateData of geoData as Array<{
    id: number;
    name: string;
    districts: string[];
  }>) {
    const locationCode = toStateLocationCode(stateData.id);

    const state = await prisma.state.upsert({
      where: { id: stateData.id },
      update: { name: stateData.name, locationCode },
      create: { id: stateData.id, name: stateData.name, locationCode },
    });

    // Seed districts idempotently without requiring a unique constraint.
    const existing = await prisma.district.findMany({
      where: { stateId: state.id },
      select: { name: true },
    });

    const existingNames = new Set(existing.map((d) => d.name));
    const districtsToCreate = stateData.districts
      .filter((name) => !existingNames.has(name))
      .map((name) => ({ name, stateId: state.id }));

    if (districtsToCreate.length > 0) {
      await prisma.district.createMany({ data: districtsToCreate });
    }
  }

  console.log(
    `✅ ${geoData.length} States seeded with districts (locationCode: LC##)`,
  );
}

main()
  .then(async () => {
    console.log('🎉 Seeding completed successfully');
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

