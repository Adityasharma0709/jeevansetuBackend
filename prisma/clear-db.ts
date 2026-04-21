import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log("🗑️ Clearing database data...");

  try {
    // Get all table names in the 'public' schema, excluding Prisma's migration table
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename != '_prisma_migrations'
    `;

    if (tables.length === 0) {
      console.log("ℹ️ No tables found to clear.");
      return;
    }

    // Wrap table names in quotes and join them
    const tableNames = tables
      .map((t) => `"${t.tablename}"`)
      .join(", ");

    // Execute the truncate command
    // RESTART IDENTITY: Resets the auto-incrementing IDs
    // CASCADE: Automatically truncates all tables that have foreign-key references to any of the named tables
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`
    );

    console.log("✅ All data cleared successfully, schema preserved.");
  } catch (error) {
    console.error("❌ Failed to clear database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearDatabase();
