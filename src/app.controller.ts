import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt/jwt.guard';
import { RolesGuard } from './auth/roles/roles.guard';
import { Roles } from './auth/roles.decorator';

@Controller('test')
export class AppController {

  @Get('super-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  testSuperAdmin() {
    return {
      message: 'RBAC works. You are SUPER_ADMIN.',
    };
  }

  
}
