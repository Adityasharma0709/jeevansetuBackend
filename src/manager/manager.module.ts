import { Module } from '@nestjs/common';
import { ManagerService } from './manager.service';
import { ManagerController } from './manager.controller';
import { OutreachModule } from '../outreach/outreach.module';

@Module({
  imports: [OutreachModule],
  controllers: [ManagerController],
  providers: [ManagerService],
})
export class ManagerModule {}
