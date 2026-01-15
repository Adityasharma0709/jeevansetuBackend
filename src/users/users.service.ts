import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AssignUserDto } from 'src/projects/dto/assign-user.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { UpdateManagerDto } from './dto/update-manager.dto';
import { AssignProjectDto } from './dto/assign-project.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createAdmin(dto: CreateAdminDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (exists) {
      throw new BadRequestException('Email already exists');
    }

    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        status: 'ACTIVE',
      },
    });

    const role = await this.prisma.role.findUnique({
      where: { name: 'ADMIN' },
    });

    if (!role) {
      throw new BadRequestException('ADMIN role does not exist');
    }

    await this.prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });
const { password, ...safeUser } = user;
    return {
      message: 'Admin created successfully',
      safeUser,
    };
  }
  async updateAdmin(id: number, dto: UpdateAdminDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateAdmin(id: number) {
    return this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  async getAllAdmins() {
    return this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              name: 'ADMIN',
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAdminById(id: number) {
    const admin = await this.prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: { name: 'ADMIN' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    return admin;
  }

  async searchAdminByName(name: string) {
    return this.prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
        roles: {
          some: {
            role: { name: 'ADMIN' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async assignUser(dto: AssignUserDto) {
    // check user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('User not found');

    // check project exists
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException('Project not found');

    // check location exists
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location) throw new NotFoundException('Location not found');

    // check duplicate assignment
    const exists = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: dto.userId,
        projectId: dto.projectId,
        locationId: dto.locationId,
      },
    });

    if (exists) {
      throw new BadRequestException('Already assigned');
    }

    return this.prisma.userProjectLocation.create({
      data: dto,
    });
  }

  async createManager(dto: CreateManagerDto, adminUser: any) {
    // 1. Check admin assignment
    const allowed = await this.prisma.userProjectLocation.findFirst({
      where: {
        userId: adminUser.id,
        projectId: dto.projectId,
        locationId: dto.locationId,
      },
    });

    if (!allowed) {
      throw new ForbiddenException(
        'You are not assigned to this project/location',
      );
    }

    // 2. Check email
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new BadRequestException('Email exists');

    // 3. Create user
    const hash = await bcrypt.hash(dto.password, 10);

    const manager = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        status: 'ACTIVE',
      },
    });

    // 4. Assign role
    const role = await this.prisma.role.findUnique({
      where: { name: 'MANAGER' },
    });

    if (!role) {
      throw new BadRequestException('MANAGER role does not exist');
    }

    await this.prisma.userRole.create({
      data: {
        userId: manager.id,
        roleId: role.id,
      },
    });

    // 5. Assign project & location
    await this.prisma.userProjectLocation.create({
      data: {
        userId: manager.id,
        projectId: dto.projectId,
        locationId: dto.locationId,
      },
    });
    const { password, ...safeManager } = manager;
    return {
      message: 'Manager created successfully',
      safeManager,
    };
  }

  async updateManager(
    managerId: number,
    dto: UpdateManagerDto,
    loggedUser: any,
  ) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      include: {
        roles: { include: { role: true } },
      },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    const isManager = manager.roles.some((r) => r.role.name === 'MANAGER');

    if (!isManager) {
      throw new BadRequestException('User is not a Manager');
    }

    // 🔥 CASE 1: MANAGER updating self
    if (loggedUser.role === 'MANAGER' && loggedUser.id !== managerId) {
      throw new ForbiddenException('You can update only your own profile');
    }

    // 🔥 CASE 2: ADMIN updating manager
    if (loggedUser.role === 'ADMIN') {
      const allowed = await this.prisma.userProjectLocation.findFirst({
        where: {
          userId: loggedUser.id,
          projectId: {
            in: (
              await this.prisma.userProjectLocation.findMany({
                where: { userId: managerId },
                select: { projectId: true },
              })
            ).map((p) => p.projectId),
          },
        },
      });

      if (!allowed) {
        throw new ForbiddenException('You cannot modify this manager');
      }
    }

    // Hash password if updating
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id: managerId },
      data: dto,
    });

    const { password, ...safe } = updated;

    return {
      message: 'Profile updated successfully',
      user: safe,
    };
  }

  async assignProjectLocation(dto: AssignProjectDto) {

  // check duplicate
  const exists = await this.prisma.userProjectLocation.findFirst({
    where: {
      userId: dto.userId,
      projectId: dto.projectId,
      locationId: dto.locationId,
    },
  });

  if (exists) {
    throw new ConflictException(
      'User already assigned to this project & location',
    );
  }

  return this.prisma.userProjectLocation.create({
    data: {
      userId: dto.userId,
      projectId: dto.projectId,
      locationId: dto.locationId,
    },
  });
}

}
