import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Put,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { CreateActivityDto } from './dto/create-activity.dto';
import { TagGroupActivityDto } from './dto/tag-group-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // =========================
  // STATES
  // =========================

  @Get('states')
  getStates() {
    return this.adminService.getStates();
  }

  // =========================
  // DASHBOARD
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('dashboard/admin')
  getAdminDashboard(@Req() req) {
    return this.adminService.adminDashboard(req.user);
  }

  // =========================
  // ACTIVITIES
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Post('activities')
  createActivity(@Body() dto: CreateActivityDto, @Req() req) {
    return this.adminService.createActivity(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Put('activity/:id')
  updateActivity(@Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.adminService.updateActivity(+id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('activity/:id/deactivate')
  deactivateActivity(@Param('id') id: string) {
    return this.adminService.deactivateActivity(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('activity/:id/activate')
  activateActivity(@Param('id') id: string) {
    return this.adminService.activateActivity(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'OUTREACH')
  @Get('activities/active')
  getActiveActivities(@Req() req) {
    return this.adminService.getActiveActivities(req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('activities')
  getAllActivities(@Req() req) {
    return this.adminService.getAllActivities(req.user);
  }

  // =========================
  // TAG GROUP WITH ACTIVITY
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Post('tag-group-activity')
  tagGroupWithActivity(@Body() dto: TagGroupActivityDto, @Req() req) {
    return this.adminService.tagGroupWithActivity(dto, req.user);
  }

  // =========================
  // GROUPS
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('groups')
  getAllGroups(@Req() req) {
    return this.adminService.getAllGroups(req.user);
  }

  // =========================
  // SESSIONS
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Post('session')
  createSession(@Body() dto: CreateSessionDto, @Req() req) {
    return this.adminService.createSession(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Put('session/:id')
  updateSession(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.adminService.updateSession(+id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('session/:id/deactivate')
  deactivateSession(@Param('id') id: string) {
    return this.adminService.deactivateSession(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('session/:id/activate')
  activateSession(@Param('id') id: string) {
    return this.adminService.activateSession(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'OUTREACH')
  @Get('activity/:id/sessions')
  getSessionsByActivity(@Param('id') id: string, @Req() req) {
    return this.adminService.getSessionsByActivity(+id, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('sessions')
  getAllSessions(@Req() req) {
    return this.adminService.getAllSessions(req.user);
  }

  // =========================
  // BENEFICIARY REQUESTS
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('beneficiary-requests')
  getManagerBeneficiaryRequests(@Req() req) {
    return this.adminService.getManagerBeneficiaryRequests(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('beneficiary-requests/:id/approve')
  approveManagerBeneficiaryRequest(@Param('id') id: string, @Req() req) {
    return this.adminService.approveManagerBeneficiaryRequest(
      +id,
      req.user.userId,
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('beneficiary-requests/:id/reject')
  rejectManagerBeneficiaryRequest(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    return this.adminService.rejectManagerBeneficiaryRequest(
      +id,
      req.user.userId,
      reason,
    );
  }

  // =========================
  // PROFILE REQUESTS
  // (Pending profile / worker updates)
  // =========================

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('profile-requests')
  getProfileRequests(@Req() req) {
    return this.adminService.getManagerBeneficiaryRequests(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('profile-requests/:id/approve')
  approveProfileRequest(@Param('id') id: string, @Req() req) {
    return this.adminService.approveManagerBeneficiaryRequest(
      +id,
      req.user.userId,
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Patch('profile-requests/:id/reject')
  rejectProfileRequest(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    return this.adminService.rejectManagerBeneficiaryRequest(
      +id,
      req.user.userId,
      reason,
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('beneficiary/:id')
  getBeneficiary(@Param('id') id: string) {
    return this.adminService.getBeneficiary(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('beneficiary/:id/family-members')
  getFamilyMembers(@Param('id') id: string) {
    return this.adminService.getFamilyMembers(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('beneficiary/:id/reports')
  getReportsByBeneficiary(@Param('id') id: string) {
    return this.adminService.getReportsByBeneficiary(+id);
  }
}
