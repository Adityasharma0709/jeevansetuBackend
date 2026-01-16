import { Module } from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { OutreachController } from './outreach.controller';

@Module({
  controllers: [OutreachController],
  providers: [OutreachService],
})
export class OutreachModule {}
