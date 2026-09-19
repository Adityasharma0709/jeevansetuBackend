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
import { CreateBlockDto, CreateVillageDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { LocationQueryDto } from './dto/location-query.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  // ===================================
  // 1. HIERARCHY & BOUNDARY ENDPOINTS
  // ===================================

  @Get('states')
  getStates() {
    return this.locationsService.getStates();
  }

  @Get('districts/:stateId')
  getDistricts(@Param('stateId', ParseIntPipe) stateId: number) {
    return this.locationsService.getDistricts(stateId);
  }

  @Get('blocks/:districtId')
  getBlocks(@Param('districtId', ParseIntPipe) districtId: number) {
    return this.locationsService.getBlocks(districtId);
  }

  @Get('villages/:blockId')
  getVillages(@Param('blockId', ParseIntPipe) blockId: number) {
    return this.locationsService.getVillages(blockId);
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

  @Post('blocks')
  createBlock(@Body() dto: CreateBlockDto) {
    return this.locationsService.createBlock(dto.districtId, dto.name);
  }

  @Post('villages')
  createVillage(@Body() dto: CreateVillageDto) {
    return this.locationsService.createVillage(dto.blockId, dto.name);
  }

  // ===================================
  // 2. UNIFIED INSTITUTION API (/locations/institutions/...)
  // ===================================

  @Get('institutions')
  findAllInstitutions(@Query() query: LocationQueryDto) {
    return this.locationsService.findAllInstitutions(query);
  }

  @Get('institutions/:type/:id')
  findInstitutionByTypeAndId(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.locationsService.findInstitutionByTypeAndId(type, id);
  }

  @Post('institutions')
  createInstitution(@Body() dto: CreateInstitutionDto) {
    return this.locationsService.createInstitution(dto);
  }

  @Put('institutions/:type/:id')
  updateInstitutionByTypeAndId(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.updateInstitutionByTypeAndId(type, id, dto);
  }

  @Patch('institutions/:type/:id/status')
  updateInstitutionStatusByTypeAndId(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.locationsService.updateInstitutionStatusByTypeAndId(type, id, status);
  }

  // ===================================
  // 3. TYPE-SPECIFIC INSTITUTION ENDPOINTS
  // ===================================

  // AWCs
  @Get('awcs')
  findAllAwcs(
    @Query('projectId') projectId?: string,
    @Query('stateId') stateId?: string,
    @Query('districtId') districtId?: string,
    @Query('blockId') blockId?: string,
    @Query('villageId') villageId?: string,
  ) {
    return this.locationsService.findAll(
      projectId ? +projectId : undefined,
      stateId ? +stateId : undefined,
      districtId ? +districtId : undefined,
      blockId ? +blockId : undefined,
      villageId ? +villageId : undefined,
    );
  }

  @Get('awcs/:id')
  findOneAwc(@Param('id', ParseIntPipe) id: number) {
    return this.locationsService.findOne(id);
  }

  @Put('awcs/:id')
  updateAwc(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLocationDto) {
    return this.locationsService.update(id, dto);
  }

  @Patch('awcs/:id/status')
  updateAwcStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.locationsService.updateStatus(id, status);
  }

  // SCHOOLS
  @Get('schools')
  findAllSchools(
    @Query('projectId') projectId?: string,
    @Query('stateId') stateId?: string,
    @Query('districtId') districtId?: string,
    @Query('blockId') blockId?: string,
    @Query('villageId') villageId?: string,
  ) {
    return this.locationsService.findAllSchools(
      projectId ? +projectId : undefined,
      stateId ? +stateId : undefined,
      districtId ? +districtId : undefined,
      blockId ? +blockId : undefined,
      villageId ? +villageId : undefined,
    );
  }

  @Get('schools/:id')
  findOneSchool(@Param('id', ParseIntPipe) id: number) {
    return this.locationsService.findOneSchool(id);
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

  // HEALTH CENTERS
  @Get('health-centers')
  findAllHealthCenters(
    @Query('projectId') projectId?: string,
    @Query('stateId') stateId?: string,
    @Query('districtId') districtId?: string,
    @Query('blockId') blockId?: string,
    @Query('villageId') villageId?: string,
  ) {
    return this.locationsService.findAllHealthCenters(
      projectId ? +projectId : undefined,
      stateId ? +stateId : undefined,
      districtId ? +districtId : undefined,
      blockId ? +blockId : undefined,
      villageId ? +villageId : undefined,
    );
  }

  @Get('health-centers/:id')
  findOneHealthCenter(@Param('id', ParseIntPipe) id: number) {
    return this.locationsService.findOneHealthCenter(id);
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
}
