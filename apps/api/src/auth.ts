import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { AuthRequest, AuthUser } from './common';
import { Public } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(usernameValue: unknown, passwordValue: unknown, request: AuthRequest) {
    const username = String(usernameValue ?? '').trim();
    const password = String(passwordValue ?? '');
    const attempt = username ? await this.prisma.loginAttempt.findUnique({ where: { username } }) : null;
    if (attempt?.lockedUntil && attempt.lockedUntil > new Date()) {
      throw new UnauthorizedException('登录失败次数过多，请稍后再试。');
    }
    const row = username ? await this.prisma.userAccount.findUnique({ where: { username } }) : null;
    const valid = Boolean(row?.enabled && (await bcrypt.compare(password, row.passwordHash)));
    if (!valid) {
      if (username) {
        const failures = (attempt?.failures ?? 0) + 1;
        await this.prisma.loginAttempt.upsert({
          where: { username },
          create: { username, failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
          update: { failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
        });
      }
      await this.audit.write({ username, request, operationType: 'auth.login.failed', remark: '用户名或密码错误' });
      throw new UnauthorizedException('用户名或密码错误。');
    }
    await this.prisma.loginAttempt.deleteMany({ where: { username } });
    await this.prisma.userAccount.update({ where: { id: row!.id }, data: { lastLoginAt: new Date() } });
    const user = await this.sessionUser(row!.id);
    const token = await this.jwt.signAsync({ sub: user.id, username: user.username });
    await this.audit.write({ user, request, operationType: 'auth.login.success' });
    return { token, user };
  }

  async sessionUser(id: bigint): Promise<AuthUser> {
    const row = await this.prisma.userAccount.findUnique({
      where: { id },
      include: { role: { include: { permissions: true } } },
    });
    if (!row?.enabled || !row.role.enabled) throw new UnauthorizedException('账号已停用。');
    return {
      id: row.id.toString(),
      username: row.username,
      displayName: row.displayName,
      roleCode: row.roleCode,
      mustChangePassword: row.mustChangePassword,
      permissions: row.role.permissions.map((item) => item.permissionCode),
    };
  }

  async changePassword(user: AuthUser, currentValue: unknown, nextValue: unknown) {
    const currentPassword = String(currentValue ?? '');
    const nextPassword = String(nextValue ?? '');
    if (nextPassword.length < 8) throw new BadRequestException('新密码至少需要 8 个字符。');
    const row = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: BigInt(user.id) } });
    if (!(await bcrypt.compare(currentPassword, row.passwordHash))) throw new BadRequestException('当前密码不正确。');
    if (await bcrypt.compare(nextPassword, row.passwordHash))
      throw new BadRequestException('新密码不能与当前密码相同。');
    await this.prisma.userAccount.update({
      where: { id: row.id },
      data: { passwordHash: await bcrypt.hash(nextPassword, 10), mustChangePassword: false },
    });
    await this.audit.write({
      user,
      operationType: 'auth.password.change',
      targetTable: 'user_account',
      targetId: user.id,
    });
    return { ok: true };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { username?: unknown; password?: unknown }, @Req() request: AuthRequest) {
    return this.auth.login(body.username, body.password, request);
  }

  @Get('me')
  me(@Req() request: AuthRequest) {
    return request.user;
  }

  @Post('change-password')
  changePassword(@Req() request: AuthRequest, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    return this.auth.changePassword(request.user!, body.currentPassword, body.newPassword);
  }
}
