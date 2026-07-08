import { Controller, Get, Post, Body, Patch, Param, UseGuards, Put, Req, ParseIntPipe, Delete } from '@nestjs/common';
import { ManagerService } from './manager.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { Roles } from 'src/auth/roles.decorator';

import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('manager')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MANAGER')
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard/manager')
  getManagerDashboard(@Req() req) {
    return this.managerService.managerDashboard(Number(req.user.userId));
  }

  @Put('me')
  updateMyProfile(@Body() dto: UpdateProfileDto, @Req() req) {
    return this.managerService.updateProfile(Number(req.user.userId), dto);
  }

  @Post('create-worker')
  createWorker(@Body() dto: CreateWorkerDto, @Req() req) {
    return this.managerService.createWorker(dto, Number(req.user.userId));
  }

  @Put('worker/:id')
  updateWorker(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkerDto, @Req() req) {
    return this.managerService.updateWorker(id, dto, Number(req.user.userId));
  }

  @Patch('worker/:id/deactivate')
  deactivateWorker(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.managerService.deactivateWorker(id, Number(req.user.userId));
  }

  @Patch('worker/:id/activate')
  activateWorker(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.managerService.activateWorker(id, Number(req.user.userId));
  }

  @Get()
  getAll(@Req() req) {
    return this.managerService.getAll(Number(req.user.userId));
  }

  @Patch(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.managerService.approve(id, Number(req.user.userId));
  }

  @Patch(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectRequestDto, @Req() req) {
    return this.managerService.reject(id, dto, Number(req.user.userId));
  }

  @Get('beneficiary-requests')
  getBeneficiaryRequests(@Req() req) {
    return this.managerService.getBeneficiaryRequests(Number(req.user.userId));
  }

  @Patch('request/:id/approve')
  approveRequest(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.managerService.approveRequest(id, Number(req.user.userId));
  }

  @Patch('request/:id/reject')
  rejectRequest(@Param('id', ParseIntPipe) id: number, @Body() dto: { reason: string }, @Req() req) {
    return this.managerService.rejectRequest(id, dto, Number(req.user.userId));
  }

  @Get('outreach-workers')
  getOutreachWorkers(@Req() req) {
    return this.managerService.getOutreachWorkers(Number(req.user.userId));
  }

  @Get('projects/:projectId/locations')
  getAssignedLocationsForProject(@Param('projectId', ParseIntPipe) projectId: number, @Req() req) {
    return this.managerService.getAssignedLocations(Number(req.user.userId), projectId);
  }

  @Post('outreach-workers/:id/tag')
  tagOutreachWorkerProjectLocation(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req) {
    return this.managerService.tagWorkerProjectLocation(
      Number(req.user.userId),
      id,
      body?.projectId,
      body?.stateId || body?.locationId
    );
  }

  @Post('account-requests')
  submitAccountRequest(@Body() body: any, @Req() req) {
    return this.managerService.submitAccountRequest(body.type, body.data, Number(req.user.userId));
  }

  @Post('beneficiary/:id/request-update')
  submitBeneficiaryUpdateRequest(@Param('id', ParseIntPipe) id: number, @Body() changes: UpdateBeneficiaryDto, @Req() req) {
    return this.managerService.submitBeneficiaryUpdateRequest(id, changes, Number(req.user.userId));
  }

  @Get('profile-requests')
  getProfileRequests(@Req() req) {
    return this.managerService.getProfileRequests(Number(req.user.userId));
  }

  @Get('beneficiaries')
  getBeneficiaries(@Req() req) {
    return this.managerService.getBeneficiaries(Number(req.user.userId));
  }

  @Get('my-requests')
  getMyRequests(@Req() req) {
    return this.managerService.getMyRequests(Number(req.user.userId));
  }

  @Delete('my-requests/:id')
  cancelRequest(@Param('id', ParseIntPipe) id: number, @Req() req) {
    return this.managerService.cancelRequest(id, Number(req.user.userId));
  }

  @Patch('profile-requests/:id')
  updateRequestStatus(@Param('id', ParseIntPipe) id: number, @Body('status') status: 'APPROVED' | 'REJECTED', @Req() req) {
    return this.managerService.updateRequestStatus(id, status, Number(req.user.userId));
  }
}
