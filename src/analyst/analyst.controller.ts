import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { AnalystService } from './analyst.service';

@Controller('analyst')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ANALYST')
export class AnalystController {
  constructor(private readonly analystService: AnalystService) {}

  @Get('dashboard/reports')
  getDashboardReports(@Req() req) {
    return this.analystService.getDashboardReports(req.user.userId);
  }

  @Get('dashboard/stats')
  getDashboardStats(
    @Req() req,
    @Query('projectId') projectId?: string,
    @Query('activityId') activityId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('adminId') adminId?: string,
    @Query('managerId') managerId?: string,
    @Query('workerId') workerId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('state') state?: string,
    @Query('district') district?: string,
    @Query('block') block?: string,
    @Query('awc') awc?: string,
    @Query('unique') unique?: string,
  ) {
    return this.analystService.getDashboardStats(
      req.user.userId,
      projectId ? +projectId : undefined,
      activityId ? +activityId : undefined,
      sessionId ? +sessionId : undefined,
      adminId ? +adminId : undefined,
      managerId ? +managerId : undefined,
      workerId ? +workerId : undefined,
      year,
      month,
      state,
      district,
      block,
      awc,
      unique === 'true',
    );
  }

  @Get('dashboard/outreach-dynamics-details')
  getOutreachDynamicsDetails(
    @Req() req,
    @Query('group') group: string,
  ) {
    return this.analystService.getOutreachDynamicsDetails(
      req.user.userId,
      group,
    );
  }

  @Get('dashboard/action-details')
  getActionDetails(
    @Req() req,
    @Query('group') group: string,
    @Query('activityId') activityId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('adminId') adminId?: string,
    @Query('managerId') managerId?: string,
    @Query('workerId') workerId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('state') state?: string,
    @Query('district') district?: string,
    @Query('block') block?: string,
    @Query('awc') awc?: string,
    @Query('unique') unique?: string,
  ) {
    return this.analystService.getActivityDemographicsDetails(
      req.user.userId,
      group,
      activityId ? +activityId : undefined,
      sessionId ? +sessionId : undefined,
      adminId ? +adminId : undefined,
      managerId ? +managerId : undefined,
      workerId ? +workerId : undefined,
      year,
      month,
      state,
      district,
      block,
      awc,
      unique === 'true',
    );
  }

  @Get('dashboard/users')
  getDashboardUsers() {
    return this.analystService.getDashboardUsers();
  }

  @Get('dashboard/activities')
  getActivities() {
    return this.analystService.getActivities();
  }

  @Get('dashboard/activity/:id/sessions')
  getSessions(@Param('id') id: string) {
    return this.analystService.getSessions(+id);
  }

  @Get('assigned-locations/:projectId')
  getAssignedLocations(@Param('projectId') projectId: string, @Req() req) {
    return this.analystService.getAssignedLocations(+projectId, req.user.userId);
  }

  @Get('beneficiary-list')
  getBeneficiaryList(
    @Req() req,
    @Query('search') search?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.analystService.getBeneficiaryList(
      req.user.userId,
      search,
      projectId ? +projectId : undefined,
    );
  }

  @Get('beneficiary/:id')
  getBeneficiary(@Param('id') id: string, @Req() req) {
    return this.analystService.getBeneficiary(+id, req.user.userId);
  }

  @Get('beneficiary/:id/family-members')
  getFamilyMembers(@Param('id') id: string, @Req() req) {
    return this.analystService.getFamilyMembers(+id, req.user.userId);
  }

  @Get('beneficiary/:id/reports')
  getReportsByBeneficiary(@Param('id') id: string, @Req() req) {
    return this.analystService.getReportsByBeneficiary(+id, req.user.userId);
  }
}
