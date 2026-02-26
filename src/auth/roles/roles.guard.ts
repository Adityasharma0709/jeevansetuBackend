import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();

    const hasRole = requiredRoles.some(role => user.roles.includes(role));
    if (!hasRole) {
      console.log('RolesGuard failed! User roles:', user.roles, 'Required:', requiredRoles, 'Path:', context.switchToHttp().getRequest().url);
    }
    return hasRole;
  }
}
