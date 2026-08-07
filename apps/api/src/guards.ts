import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { AuthRequest } from './common';
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS } from './common';
import { AuthService } from './auth';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('请先登录。');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      request.user = await this.auth.sessionUser(BigInt(payload.sub));
      return true;
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录。');
    }
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (required.some((permission) => request.user?.permissions.includes(permission))) return true;
    throw new ForbiddenException('当前账号没有执行此操作的权限。');
  }
}
