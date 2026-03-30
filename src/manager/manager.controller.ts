import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Put, Req } from '@nestjs/common';
import { ManagerService } from './manager.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Roles } from 'src/auth/roles.decorator';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { RejectRequestDto } from './dto/reject-request.dto';
import { UpdateBeneficiaryDto } from './dto/update-beneficiary.dto';

@Controller('manager')
export class ManagerController {
  constructor(private readonly managerService: ManagerService, private prisma: PrismaService) { }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('dashboard/manager')
  getManagerDashboard(@Req() req) {
    return this.managerService.managerDashboard(req.user.userId);
  }


  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Put('me')
  updateMyProfile(
    @Body() dto: UpdateProfileDto,
    @Req() req
  ) {
    return this.managerService.updateProfile(req.user.userId, dto);
  }


  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Post('create-worker')
  createWorker(
    @Body() dto: CreateWorkerDto,
    @Req() req
  ) {
    return this.managerService.createWorker(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Put('worker/:id')
  updateWorker(
    @Param('id') id: string,
    @Body() dto: UpdateWorkerDto,
    @Req() req
  ) {
    return this.managerService.updateWorker(+id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch('worker/:id/deactivate')
  deactivateWorker(@Param('id') id: string, @Req() req) {
    return this.managerService.deactivateWorker(+id, req.user);
  }

  // @Patch('approve/:id')
  // approve(@Param('id') id: string, @Req() req) {
  //   return this.prisma.approvalRequest.update({
  //     where: { id: +id },
  //     data: {
  //       status: 'APPROVED',
  //       approvedById: req.user.userId,
  //       approvedAt: new Date()
  //     }
  //   });
  // }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch('worker/:id/activate')
  activateWorker(@Param('id') id: string, @Req() req) {
    return this.managerService.activateWorker(+id, req.user);
  }

  // Manager → view requests
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get()
  getAll(@Req() req) {
    return this.managerService.getAll(req.user.userId);
  }

  // Approve
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @Req() req) {
    return this.managerService.approve(+id, req.user);
  }

  // Reject
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @Req() req
  ) {
    return this.managerService.reject(+id, dto, req.user);
  }


  //request beneficiary update

  /**
   * 1️⃣ View pending beneficiary update requests
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('beneficiary-requests')
  getBeneficiaryRequests() {
    return this.managerService.getBeneficiaryRequests();
  }

  /**
   * 2️⃣ Approve request
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch('request/:id/approve')
  approveRequest(
    @Param('id') id: string,
    @Req() req
  ) {
    return this.managerService.approveRequest(
      +id,
      req.user
    );
  }

  /**
   * 3️⃣ Reject request
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch('request/:id/reject')
  rejectRequest(
    @Param('id') id: string,
    @Body() dto: { reason: string },
    @Req() req
  ) {
    return this.managerService.rejectRequest(
      +id,
      dto,
      req.user
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('outreach-workers')
  getOutreachWorkers(@Req() req) {
    return this.managerService.getOutreachWorkers(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('projects/:projectId/locations')
  getAssignedLocationsForProject(@Param('projectId') projectId: string, @Req() req) {
    return this.managerService.getAssignedLocations(req.user.userId, +projectId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Post('outreach-workers/:id/tag')
  tagOutreachWorkerProjectLocation(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.managerService.tagWorkerProjectLocation(
      req.user.userId,
      +id,
      body?.projectId,
      body?.locationId
    );
  }
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Post('account-requests')
  submitAccountRequest(@Body() body: any, @Req() req) {
    return this.managerService.submitAccountRequest(body.type, body.data, req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Post('beneficiary/:id/request-update')
  submitBeneficiaryUpdateRequest(@Param('id') id: string, @Body() changes: UpdateBeneficiaryDto, @Req() req) {
    return this.managerService.submitBeneficiaryUpdateRequest(+id, changes, req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('profile-requests')
  getProfileRequests(@Req() req) {
    return this.managerService.getProfileRequests(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('beneficiaries')
  getBeneficiaries(@Req() req) {
    return this.managerService.getBeneficiaries(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Get('my-requests')
  getMyRequests(@Req() req) {
    return this.managerService.getMyRequests(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MANAGER')
  @Patch('profile-requests/:id')
  updateRequestStatus(@Param('id') id: string, @Body('status') status: 'APPROVED' | 'REJECTED', @Req() req) {
    return this.managerService.updateRequestStatus(+id, status, req.user.userId);
  }
}

