import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnalystController],
  providers: [AnalystService],
  exports: [AnalystService],
})
export class AnalystModule {}
