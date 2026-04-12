import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService, private prisma: PrismaService) { }

  async login(email: string, password: string) {
    console.log(`[AUTH] Attempting login for email: ${email}`);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      console.log(`[AUTH] User not found for email: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`[AUTH] Passwords comparison result: ${isPasswordValid}`);
    if (!isPasswordValid) {
      console.log(`[AUTH] Password mismatch for email: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = user.roles.map(r => r.role.name);

    const payload = {
      sub: user.id,
      email: user.email,
      roles,
    };

    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mobileNumber: user.mobileNumber,
        usercode: user.usercode,
        roles,
      },
    };
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mobileNumber: user.mobileNumber,
      usercode: user.usercode,
      roles: user.roles.map(r => r.role.name),
    };
  }
}


