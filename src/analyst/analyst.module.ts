import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';
import { OutreachDynamicsModule } from '../dashboard/outreach-dynamics/outreach-dynamics.module';

@Module({
  imports: [PrismaModule, OutreachDynamicsModule],
  controllers: [AnalystController],
  providers: [AnalystService],
  exports: [AnalystService],
})
export class AnalystModule {}
