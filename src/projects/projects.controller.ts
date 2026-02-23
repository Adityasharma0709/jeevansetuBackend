import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Patch,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectService: ProjectsService) { }

  // =========================
  // CREATE PROJECT
  // =========================

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectService.create(dto);
  }

  // =========================
  // GET ALL PROJECTS
  // 🔍 Optional search by name/code
  // =========================

  @Get()
  findAll(@Query('search') search?: string) {
    return this.projectService.findAll(search);
  }

  // =========================
  // GET PROJECTS ASSIGNED TO USER
  // =========================

  @Get('user/:userId')
  findAssignedToUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.projectService.findAssignedToUser(userId);
  }

  // =========================
  // UPDATE PROJECT
  // =========================

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, dto);
  }

  // =========================
  // DISABLE PROJECT
  // (Soft delete)
  // =========================

  @Patch(':id/disable')
  disable(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.disable(id);
  }

  // =========================
  // UPDATE PROJECT STATUS
  // =========================

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.projectService.updateStatus(id, status);
  }

  // =========================
  // GET PROJECT BY ID
  // ⚠ Keep dynamic route last
  // =========================

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.findOne(id);
  }
}
