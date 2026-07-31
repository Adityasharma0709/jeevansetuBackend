import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { LocationsModule } from './locations/locations.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './admin/admin.module';
import { ManagerModule } from './manager/manager.module';
import { OutreachModule } from './outreach/outreach.module';
import { AnalystModule } from './analyst/analyst.module';
import { OutreachDynamicsModule } from './dashboard/outreach-dynamics/outreach-dynamics.module';
import { CoverageDashboardModule } from './dashboard/coverage-dashboard/coverage-dashboard.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ProjectsModule,
    LocationsModule,
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AdminModule,
    ManagerModule,
    OutreachModule,
    AnalystModule,
    OutreachDynamicsModule,
    CoverageDashboardModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
