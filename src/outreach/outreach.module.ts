import { Module } from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { OutreachController } from './outreach.controller';
import { OutreachDynamicsModule } from '../dashboard/outreach-dynamics/outreach-dynamics.module';
import { CoverageDashboardModule } from '../dashboard/coverage-dashboard/coverage-dashboard.module';

@Module({
  imports: [OutreachDynamicsModule, CoverageDashboardModule],
  controllers: [OutreachController],
  providers: [OutreachService],
  exports: [OutreachService],
})
export class OutreachModule {}
