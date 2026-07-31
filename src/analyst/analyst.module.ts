import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';
import { OutreachDynamicsModule } from '../dashboard/outreach-dynamics/outreach-dynamics.module';
import { CoverageDashboardModule } from '../dashboard/coverage-dashboard/coverage-dashboard.module';

@Module({
  imports: [PrismaModule, OutreachDynamicsModule, CoverageDashboardModule],
  controllers: [AnalystController],
  providers: [AnalystService],
  exports: [AnalystService],
})
export class AnalystModule {}
