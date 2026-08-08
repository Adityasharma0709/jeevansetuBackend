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
  Query,
} from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { RequestBeneficiaryUpdateDto } from './dto/request-beneficiary-update.dto';
import { AddFamilyMemberDto } from './dto/add-family-member.dto';
import { UpdateFamilyMemberDto } from './dto/update-family-member.dto';

@Controller('outreach')
export class OutreachController {
  constructor(private readonly outreachService: OutreachService) { }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary')
  createBeneficiary(@Body() dto: CreateBeneficiaryDto, @Req() req) {
    return this.outreachService.createBeneficiary(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('request')
  create(@Body() dto: CreateRequestDto, @Req() req) {
    return this.outreachService.raiseRequest(dto, req.user);
  }

  //beneficiary update request
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary/:id/request-update')
  requestUpdate(
    @Param('id') id: string,
    @Body() dto: RequestBeneficiaryUpdateDto,
    @Req() req
  ) {
    return this.outreachService.requestBeneficiaryUpdate(+id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('my-requests')
  getMyRequests(@Req() req) {
    return this.outreachService.getMyRequests(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Delete('my-requests/:id')
  cancelRequest(@Param('id') id: string, @Req() req) {
    return this.outreachService.cancelRequest(+id, req.user.userId);
  }

  //report
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('activity-report/:id')
  getReport(@Param('id') id: string, @Req() req) {
    return this.outreachService.getReport(+id, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Patch('activity-report/:id')
  updateReport(@Param('id') id: string, @Body() dto: UpdateReportDto, @Req() req) {
    return this.outreachService.updateReport(+id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('activity-report')
  submitReport(
    @Body() dto: CreateReportDto,
    @Req() req
  ) {
    return this.outreachService.submitReport(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('dashboard/outreach')
  getOutreachDashboard(@Req() req) {
    return this.outreachService.outreachDashboard(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'ANALYST')
  @Get('dashboard/stats')
  getDashboardStats(
    @Req() req,
    @Query('projectId') projectId?: string,
    @Query('activityId') activityId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('unique') unique?: string,
  ) {
    return this.outreachService.getDashboardStats(
      req.user,
      projectId ? +projectId : undefined,
      activityId ? +activityId : undefined,
      sessionId ? +sessionId : undefined,
      unique === 'true',
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'ANALYST')
  @Get('dashboard/action-details')
  getActionDetails(
    @Req() req,
    @Query('group') group: string,
    @Query('activityId') activityId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('unique') unique?: string,
  ) {
    return this.outreachService.getActionDetails(
      req.user,
      group,
      activityId ? +activityId : undefined,
      sessionId ? +sessionId : undefined,
      unique === 'true',
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'ANALYST')
  @Get('dashboard/outreach-dynamics-details')
  getOutreachDynamicsDetails(
    @Req() req,
    @Query('group') group: string,
    @Query('unique') unique?: string,
  ) {
    return this.outreachService.getOutreachDynamicsDetails(
      req.user,
      group,
      unique === 'true',
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'ANALYST')
  @Get('my-reports')
  getMyReports(@Req() req, @Query('projectId') projectId?: string) {
    return this.outreachService.getMyReports(req.user, projectId ? +projectId : undefined);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Get('debug-info')
  debugInfo() {
    return this.outreachService.getDebugInfo();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'ANALYST')
  @Get('beneficiary-list')
  beneficiaryList(@Req() req, @Query('search') search?: string, @Query('projectId') projectId?: string) {
    return this.outreachService.getBeneficiaryList(req.user, search, projectId ? +projectId : undefined);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('beneficiary/:id')
  getBeneficiary(@Param('id') id: string, @Req() req) {
    return this.outreachService.getBeneficiary(+id, Number(req.user.userId));
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary/:id/tag-group')
  tagGroup(@Param('id') id: string, @Body() dto: { groupId: number }, @Req() req) {
    return this.outreachService.tagBeneficiaryGroup(+id, Number(dto.groupId), req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary/:id/tag-activity')
  tagActivity(@Param('id') id: string, @Body() dto: { activityId: number, sessionId: number }, @Req() req) {
    return this.outreachService.tagBeneficiaryActivity(+id, Number(dto.activityId), Number(dto.sessionId), req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('groups')
  getGroups() {
    return this.outreachService.getGroups();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('activities')
  getActivities(@Req() req) {
    return this.outreachService.getActivities(req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('activity/:id/sessions')
  getSessions(@Param('id') id: string) {
    return this.outreachService.getSessions(+id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH', 'ANALYST')
  @Get('assigned-locations/:projectId')
  getAssignedLocations(@Param('projectId') projectId: string, @Req() req) {
    return this.outreachService.getAssignedLocations(+projectId, req.user.userId);
  }

  // Family Members
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary/:id/family-member')
  addFamilyMember(
    @Param('id') id: string,
    @Body() dto: AddFamilyMemberDto,
    @Req() req,
  ) {
    return this.outreachService.addFamilyMember(+id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('beneficiary/:id/family-members')
  getFamilyMembers(@Param('id') id: string, @Req() req) {
    return this.outreachService.getFamilyMembers(+id, Number(req.user.userId));
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Get('beneficiary/:id/reports')
  getReportsByBeneficiary(@Param('id') id: string, @Req() req) {
    return this.outreachService.getReportsByBeneficiary(+id, Number(req.user.userId));
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Patch('family-member/:id')
  updateFamilyMember(
    @Param('id') id: string,
    @Body() dto: UpdateFamilyMemberDto,
    @Req() req,
  ) {
    return this.outreachService.updateFamilyMember(+id, dto, req.user);
  }
}
