import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  Put,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('states')
  getStates() {
    return this.locationsService.getStates();
  }

  @Get('districts/:stateId')
  getDistricts(@Param('stateId') stateId: string) {
    return this.locationsService.getDistricts(+stateId);
  }

  @Get('blocks/:districtId')
  getBlocks(@Param('districtId') districtId: string) {
    return this.locationsService.getBlocks(+districtId);
  }

  @Get('villages/:blockId')
  getVillages(@Param('blockId') blockId: string) {
    return this.locationsService.getVillages(+blockId);
  }

  @Get('villages/by-block-name/:districtId/:blockName')
  getVillagesByBlockName(
    @Param('districtId', ParseIntPipe) districtId: number,
    @Param('blockName') blockName: string,
  ) {
    return this.locationsService.getVillagesByBlockName(districtId, blockName);
  }

  @Get('project/:projectId/states')
  getProjectStates(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.locationsService.getProjectStates(projectId);
  }

  @Post('bulk-all-india')
  assignAllStates(@Body('projectId', ParseIntPipe) projectId: number) {
    return this.locationsService.assignAllStatesToProject(projectId);
  }

  @Post('project-states')
  assignStates(@Body() dto: { projectId: number; stateIds: number[] }) {
    return this.locationsService.assignStatesToProject(dto.projectId, dto.stateIds);
  }

  // =========================
  // CREATE LOCATION
  // =========================

  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locationsService.create(dto);
  }

  // =========================
  // CLUSTER MANAGEMENT (BLOCK & VILLAGE)
  // =========================

  @Post('blocks')
  createBlock(@Body() dto: { districtId: number; name: string }) {
    return this.locationsService.createBlock(dto.districtId, dto.name);
  }

  @Post('villages')
  createVillage(@Body() dto: { blockId: number; name: string }) {
    return this.locationsService.createVillage(dto.blockId, dto.name);
  }

  // =========================
  // UNIFIED INSTITUTION CREATION
  // =========================

  @Post('institutions')
  createInstitution(@Body() dto: CreateInstitutionDto) {
    return this.locationsService.createInstitution(dto);
  }

  // =========================
  // SCHOOL ENDPOINTS
  // =========================

  @Get('schools')
  findAllSchools(@Query('projectId') projectId?: string) {
    return this.locationsService.findAllSchools(projectId ? +projectId : undefined);
  }

  @Put('schools/:id')
  updateSchool(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLocationDto) {
    return this.locationsService.updateSchool(id, dto);
  }

  @Patch('schools/:id/status')
  updateSchoolStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.locationsService.updateSchoolStatus(id, status);
  }

  // =========================
  // HEALTH CENTER ENDPOINTS
  // =========================

  @Get('health-centers')
  findAllHealthCenters(@Query('projectId') projectId?: string) {
    return this.locationsService.findAllHealthCenters(projectId ? +projectId : undefined);
  }

  @Put('health-centers/:id')
  updateHealthCenter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLocationDto) {
    return this.locationsService.updateHealthCenter(id, dto);
  }

  @Patch('health-centers/:id/status')
  updateHealthCenterStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.locationsService.updateHealthCenterStatus(id, status);
  }

  // =========================
  // GET ALL LOCATIONS
  // (Optional filter by projectId)
  // =========================

  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.locationsService.findAll(projectId ? +projectId : undefined);
  }

  // =========================
  // UPDATE LOCATION
  // =========================

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locationsService.update(+id, dto);
  }

  // =========================
  // DISABLE LOCATION
  // (Soft delete)
  // =========================

  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.locationsService.disable(+id);
  }

  // =========================
  // UPDATE LOCATION STATUS
  // =========================

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.locationsService.updateStatus(+id, status);
  }

  // =========================
  // GET LOCATION BY ID
  // ⚠ Keep dynamic route last
  // =========================

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(+id);
  }
}
