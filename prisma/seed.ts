import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  /* ================= ROLES ================= */

  const roles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "OUTREACH"];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
  }

  console.log("✅ Roles seeded");

  /* ================= SUPER ADMIN ================= */

  const passwordHash = await bcrypt.hash("Admin@123", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@jeevansetu.com" },
    update: {},
    create: {
      name: "Super Admin",
      email: "superadmin@jeevansetu.com",
      password: passwordHash,
      status: "ACTIVE",
    },
  });

  console.log("✅ Super Admin created");

  /* ================= ROLE MAPPING ================= */

  const superAdminRole = await prisma.role.findUnique({
    where: { name: "SUPER_ADMIN" },
  });

  if (!superAdminRole) {
    throw new Error("SUPER_ADMIN role not found");
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

  console.log("✅ SUPER_ADMIN role assigned");
}

main()
  .then(async () => {
    console.log("🎉 Seeding completed successfully");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
