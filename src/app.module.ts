import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { ProjectsModule } from './projects/projects.module';
import { LocationsModule } from './locations/locations.module';
// import { PrismaModule } from 'prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    RolesModule,
    ProjectsModule,
    LocationsModule,
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AdminModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
