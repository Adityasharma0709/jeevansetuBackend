import { Module } from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { OutreachController } from './outreach.controller';
import { OutreachDynamicsModule } from '../dashboard/outreach-dynamics/outreach-dynamics.module';

@Module({
  imports: [OutreachDynamicsModule],
  controllers: [OutreachController],
  providers: [OutreachService],
  exports: [OutreachService],
})
export class OutreachModule {}
