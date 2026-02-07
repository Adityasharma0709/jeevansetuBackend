import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  // =========================
  // CREATE LOCATION
  // =========================

  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locationsService.create(dto);
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
