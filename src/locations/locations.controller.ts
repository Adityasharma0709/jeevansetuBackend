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

  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locationsService.create(dto);
  }

  @Get()
  findAll(@Query('projectId') projectId?: string) {
    return this.locationsService.findAll(
      projectId ? +projectId : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(+id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(+id, dto);
  }

  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.locationsService.disable(+id);
  }
}
