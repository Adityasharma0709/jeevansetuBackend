import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OutreachService } from '../src/outreach/outreach.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  console.log("Bootstrapping NestJS application context...");
  const app = await NestFactory.createApplicationContext(AppModule);
  const outreachService = app.get(OutreachService);
  const prismaService = app.get(PrismaService);

  try {
    console.log("Fetching beneficiaries with reported activities from the database...");
    const beneficiaries = await prismaService.beneficiary.findMany({
      where: {
        reports: {
          some: {}
        }
      },
      select: {
        id: true,
        name: true
      }
    });

    console.log(`Found ${beneficiaries.length} beneficiaries to process.`);
    let successCount = 0;

    for (let i = 0; i < beneficiaries.length; i++) {
      const b = beneficiaries[i];
      try {
        await outreachService.recalculateGroupsForBeneficiary(b.id);
        successCount++;
        if (successCount % 50 === 0 || successCount === beneficiaries.length) {
          console.log(`Processed ${successCount}/${beneficiaries.length} beneficiaries...`);
        }
      } catch (err) {
        console.error(`Error recalculating groups for beneficiary ID ${b.id} (${b.name}):`, err);
      }
    }

    console.log(`\nFinished recalculating groups. Successfully updated ${successCount} beneficiaries.`);
  } catch (error) {
    console.error("Failed to run recalculation:", error);
  } finally {
    await app.close();
  }
}

main();
