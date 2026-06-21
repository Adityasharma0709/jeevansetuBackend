import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { OutreachModule } from '../outreach/outreach.module';

@Module({
  imports: [OutreachModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
