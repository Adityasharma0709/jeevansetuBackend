import { Module } from '@nestjs/common';
import { CoverageDashboardService } from './coverage-dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CoverageDashboardService],
  exports: [CoverageDashboardService]
})
export class CoverageDashboardModule {}
