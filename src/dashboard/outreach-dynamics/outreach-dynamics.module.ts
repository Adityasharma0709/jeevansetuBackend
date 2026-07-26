import { Module } from '@nestjs/common';
import { OutreachDynamicsService } from './outreach-dynamics.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OutreachDynamicsService],
  exports: [OutreachDynamicsService]
})
export class OutreachDynamicsModule {}
// 