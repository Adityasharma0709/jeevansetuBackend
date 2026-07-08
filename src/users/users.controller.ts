import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UsersService } from './users.service';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AssignUserDto } from 'src/projects/dto/assign-user.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { CreateAnalystDto } from './dto/create-analyst.dto';
import { UpdateAnalystDto } from './dto/update-analyst.dto';
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) { }
  // =========================
  // CREATE ADMIN
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('create-admin')
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.usersService.createAdmin(dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  @Get('next-code')
  getNextCode(@Query('role') role: string, @Req() req) {
    return this.usersService.getNextUserCode(role, req.user);
  }


  // =========================
  // UPDATE ADMIN
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Put('admin/:id')
  updateAdmin(@Param('id') id: string, @Body() dto: UpdateAdminDto) {
    return this.usersService.updateAdmin(+id, dto);
  }

  // =========================
  // REMOVE ADMIN FROM PROJECT
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('admin/:id/project/:projectId')
  removeAdminFromProject(@Param('id') id: string, @Param('projectId') projectId: string) {
    return this.usersService.removeAdminFromProject(+id, +projectId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('analyst/:id/project/:projectId')
  removeAnalystFromProject(@Param('id') id: string, @Param('projectId') projectId: string) {
    return this.usersService.removeAnalystFromProject(+id, +projectId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete('manager/:id/project/:projectId')
  removeManagerFromProject(@Param('id') id: string, @Param('projectId') projectId: string) {
    return this.usersService.removeManagerFromProject(+id, +projectId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  @Delete('outreach/:id/project/:projectId')
  removeOutreachFromProject(@Param('id') id: string, @Param('projectId') projectId: string) {
    return this.usersService.removeOutreachFromProject(+id, +projectId);
  }

  // =========================
  // UPDATE ADMIN STATUS
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('admin/:id/status')
  updateAdminStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.usersService.updateAdminStatus(+id, status);
  }


  // =========================
  // SEARCH ADMIN
  // ⚠ Must come before :id route
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('admins/search')
  searchAdminByName(@Query('name') name: string) {
    return this.usersService.searchAdminByName(name);
  }


  // =========================
  // GET ALL ADMINS
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('admins')
  getAllAdmins() {
    return this.usersService.getAllAdmins();
  }


  // =========================
  // GET ADMIN BY ID
  // ⚠ Dynamic route — keep last
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('admins/:id')
  getAdminById(@Param('id') id: string) {
    return this.usersService.getAdminById(+id);
  }


  // =========================
  // ASSIGN USER
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('assign')
  assignUser(@Body() dto: AssignUserDto) {
    return this.usersService.assignUser(dto);
  }


  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Post('create-manager')
  createManager(@Body() dto: CreateManagerDto, @Req() req) {
    return this.usersService.createManager(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @Put('manager/:id')
  updateManager(
    @Param('id') id: string,
    @Body() dto: UpdateManagerDto,
    @Req() req,
  ) {
    return this.usersService.updateManager(+id, dto, req.user);
  }
  @UseGuards(AuthGuard('jwt'), RolesGuard)

  @Roles('SUPER_ADMIN', 'ADMIN', 'MANAGER')
  @Post('assign-project-location')
  assignProjectLocation(@Body() dto: AssignProjectDto, @Req() req) {
    return this.usersService.assignProjectLocation(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Get()
  findAll(
    @Req() req,
    @Query('role') role: string,
    @Query('search') search?: string,
  ) {
    if (role) {
      return this.usersService.findUsersByRole(role, search, req.user);
    }
    // If no role, maybe we shouldn't allow listing all users for security, 
    // or we can implement a generic search if needed.
    return [];
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('profile')
  updateProfile(@Req() req, @Body() dto: any) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  //super-admin dashboard
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('dashboard/super-admin')
  superAdminDashboard() {
    return this.usersService.superAdminDashboard();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch('outreach/:id/assign-manager')
  assignOutreachManager(
    @Param('id') outreachId: string,
    @Body('managerId') managerId: number,
    @Req() req
  ) {
    return this.usersService.assignOutreachManager(+outreachId, +managerId, req.user);
  }

  // =========================
  // ANALYST ENDPOINTS
  // =========================

  // ⚠ Static routes MUST come before dynamic :id routes
  // =========================
  // ANALYST DASHBOARD (static — keep above analyst/:id routes)
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ANALYST')
  @Get('analyst/dashboard/reports')
  getAnalystDashboardReports(@Req() req) {
    return this.usersService.getAnalystDashboardReports(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('create-analyst')
  createAnalyst(@Body() dto: CreateAnalystDto) {
    return this.usersService.createAnalyst(dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('analysts')
  getAllAnalysts() {
    return this.usersService.getAllAnalysts();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('analysts/:id')
  getAnalystById(@Param('id') id: string) {
    return this.usersService.getAnalystById(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Put('analyst/:id')
  updateAnalyst(@Param('id') id: string, @Body() dto: UpdateAnalystDto) {
    return this.usersService.updateAnalyst(+id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('analyst/:id/status')
  updateAnalystStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.usersService.updateAnalystStatus(+id, status);
  }

}
