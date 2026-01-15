// src/admin/admin.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { TagGroupActivityDto } from './dto/tag-group-activity.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async createGroup(dto: CreateGroupDto, user: any) {
    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    const exists = await this.prisma.beneficiaryGroup.findFirst({
      where: { name: dto.name },
    });

    if (exists) {
      throw new ConflictException('Group already exists');
    }

    return this.prisma.beneficiaryGroup.create({
      data: {
        name: dto.name,
        minAge: dto.minAge,
        maxAge: dto.maxAge,
        createdById: user.userId, // 🔥 FIXED
      },
    });
  }

  async createActivity(dto: CreateActivityDto, user: any) {
    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    // check duplicate
    const exists = await this.prisma.activity.findFirst({
      where: { name: dto.name },
    });

    if (exists) {
      throw new ConflictException('Activity already exists');
    }

    return this.prisma.activity.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdById: user.userId, // from JWT
      },
    });
  }

  async updateActivity(id: number, dto: UpdateActivityDto) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    // prevent duplicate activity name
    if (dto.name) {
      const exists = await this.prisma.activity.findFirst({
        where: {
          name: dto.name,
          NOT: { id },
        },
      });

      if (exists) {
        throw new ConflictException('Activity name already exists');
      }
    }

    return this.prisma.activity.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateActivity(id: number) {

  const activity = await this.prisma.activity.findUnique({
    where: { id }
  });

  if (!activity) {
    throw new NotFoundException('Activity not found');
  }

  if (activity.status === 'INACTIVE') {
    throw new BadRequestException('Activity already inactive');
  }

  return this.prisma.activity.update({
    where: { id },
    data: { status: 'INACTIVE' }
  });
}

async activateActivity(id: number) {

  const activity = await this.prisma.activity.findUnique({
    where: { id }
  });

  if (!activity) {
    throw new NotFoundException('Activity not found');
  }

  if (activity.status === 'ACTIVE') {
    throw new BadRequestException('Activity already active');
  }

  return this.prisma.activity.update({
    where: { id },
    data: { status: 'ACTIVE' }
  });
}
async getActiveActivities() {
  return this.prisma.activity.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' }
  });
}


  async tagGroupWithActivity(dto: TagGroupActivityDto, user: any) {
    if (!user?.userId) {
      throw new UnauthorizedException('User not found');
    }

    // check group exists
    const group = await this.prisma.beneficiaryGroup.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new NotFoundException('Group not found');

    // check activity exists
    const activity = await this.prisma.activity.findUnique({
      where: { id: dto.activityId },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // check duplicate mapping
    const exists = await this.prisma.groupActivity.findFirst({
      where: {
        groupId: dto.groupId,
        activityId: dto.activityId,
      },
    });

    if (exists) {
      throw new ConflictException('Already tagged');
    }

    return this.prisma.groupActivity.create({
      data: {
        groupId: dto.groupId,
        activityId: dto.activityId,
      },
    });
  }
  async getAllGroups() {
    return this.prisma.beneficiaryGroup.findMany({
      include: {
        activities: {
          include: {
            activity: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateGroup(id: number, dto: UpdateGroupDto) {
    return this.prisma.beneficiaryGroup.update({
      where: { id },
      data: dto,
    });
  }

  // src/admin/admin.service.ts

  async deactivateGroup(id: number) {
    const group = await this.prisma.beneficiaryGroup.findUnique({
      where: { id },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (group.status === 'INACTIVE') {
      throw new BadRequestException('Group already inactive');
    }

    return this.prisma.beneficiaryGroup.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  async activateGroup(id: number) {
    const group = await this.prisma.beneficiaryGroup.findUnique({
      where: { id },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (group.status === 'ACTIVE') {
      throw new BadRequestException('Group already active');
    }

    return this.prisma.beneficiaryGroup.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }
}
