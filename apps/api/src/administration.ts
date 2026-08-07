import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { AuthRequest, AuthUser } from './common';
import { dateOrNull, RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { PERMISSIONS, PrismaService } from './prisma.service';

type UserInput = {
  username?: unknown;
  displayName?: unknown;
  password?: unknown;
  roleCode?: unknown;
  enabled?: unknown;
  mustChangePassword?: unknown;
};

export type LogQuery = { keyword?: string; operationType?: string; from?: string; to?: string };

export type UserQuery = { keyword?: string; roleCode?: string; enabled?: string };

export function buildUserWhere(query: UserQuery) {
  const keyword = String(query.keyword ?? '').trim();
  const roleCode = String(query.roleCode ?? '').trim();
  const enabledValue = String(query.enabled ?? '').trim();
  return {
    ...(roleCode ? { roleCode } : {}),
    ...(enabledValue === 'true' || enabledValue === 'false' ? { enabled: enabledValue === 'true' } : {}),
    ...(keyword ? { OR: [{ username: { contains: keyword } }, { displayName: { contains: keyword } }] } : {}),
  };
}

/** 审计快照剔除敏感字段（密码哈希等），避免明文/哈希落日志。 */
function auditSnapshot<T extends Record<string, unknown>>(row: T | null | undefined) {
  if (!row) return row;
  const { passwordHash: _passwordHash, ...rest } = row as Record<string, unknown>;
  return rest;
}

export function buildLogWhere(query: LogQuery) {
  const keyword = String(query.keyword ?? '').trim();
  const from = dateOrNull(query.from);
  const to = dateOrNull(query.to);
  return {
    ...(query.operationType ? { operationType: String(query.operationType) } : {}),
    ...(from || to ? { operationTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(keyword
      ? {
          OR: [
            { username: { contains: keyword } },
            { targetId: { contains: keyword } },
            { remark: { contains: keyword } },
          ],
        }
      : {}),
  };
}

@Injectable()
export class AdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async users(query: UserQuery = {}) {
    const rows = await this.prisma.userAccount.findMany({
      where: buildUserWhere(query),
      include: { role: true },
      orderBy: { username: 'asc' },
    });
    return {
      rows: rows.map((row) => ({
        id: row.id.toString(),
        username: row.username,
        displayName: row.displayName,
        roleCode: row.roleCode,
        roleName: row.role.name,
        enabled: row.enabled,
        mustChangePassword: row.mustChangePassword,
        lastLoginAt: row.lastLoginAt,
        createdAt: row.createdAt,
      })),
    };
  }

  async createUser(input: UserInput, actor: AuthUser) {
    const username = text(input.username, 80);
    const password = String(input.password ?? '');
    const roleCode = text(input.roleCode, 40) ?? 'user';
    if (!username || !/^[A-Za-z0-9_.-]+$/.test(username))
      throw new BadRequestException('用户名只能包含字母、数字、点、下划线或连字符。');
    const displayName = text(input.displayName, 120) ?? username;
    if (password.length < 8) throw new BadRequestException('初始密码至少需要 8 个字符。');
    await this.assertRole(roleCode);
    try {
      const row = await this.prisma.userAccount.create({
        data: {
          username,
          displayName,
          roleCode,
          passwordHash: await bcrypt.hash(password, 10),
          enabled: input.enabled !== false,
          mustChangePassword: input.mustChangePassword !== false,
        },
      });
      await this.audit.write({
        user: actor,
        operationType: 'user.create',
        targetTable: 'user_account',
        targetId: row.id.toString(),
        afterData: auditSnapshot(row),
      });
      return { id: row.id.toString() };
    } catch (error) {
      if (String(error).includes('Unique constraint')) throw new BadRequestException('用户名已存在。');
      throw error;
    }
  }

  async updateUser(id: string, input: UserInput, actor: AuthUser) {
    const userId = parseId(id);
    const before = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });
    const data: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(input, 'displayName'))
      data.displayName = text(input.displayName, 120) ?? before.displayName;
    if (Object.prototype.hasOwnProperty.call(input, 'roleCode')) {
      const role = text(input.roleCode, 40);
      if (!role) throw new BadRequestException('必须选择角色。');
      await this.assertRole(role);
      data.roleCode = role;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'enabled')) data.enabled = Boolean(input.enabled);
    const resettingPassword = Object.prototype.hasOwnProperty.call(input, 'password');
    if (resettingPassword) {
      const password = String(input.password ?? '');
      if (password.length < 8) throw new BadRequestException('新密码至少需要 8 个字符。');
      data.passwordHash = await bcrypt.hash(password, 10);
      data.mustChangePassword = input.mustChangePassword !== false;
    }
    if (before.id === BigInt(actor.id) && data.enabled === false)
      throw new BadRequestException('不能停用当前登录的管理员。');
    if (before.roleCode === 'admin' && (data.enabled === false || (data.roleCode && data.roleCode !== 'admin')))
      await this.ensureAnotherAdmin(before.id);
    const after = await this.prisma.userAccount.update({ where: { id: userId }, data });
    if (resettingPassword) await this.prisma.loginAttempt.deleteMany({ where: { username: before.username } });
    await this.audit.write({
      user: actor,
      operationType: 'user.update',
      targetTable: 'user_account',
      targetId: id,
      beforeData: auditSnapshot(before),
      afterData: auditSnapshot(after),
    });
    return { ok: true };
  }

  async deleteUser(id: string, actor: AuthUser) {
    const userId = parseId(id);
    const before = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });
    if (before.id === BigInt(actor.id)) throw new BadRequestException('不能删除当前登录的管理员。');
    if (before.roleCode === 'admin' && before.enabled) await this.ensureAnotherAdmin(before.id);
    await this.prisma.$transaction([
      this.prisma.userAccount.delete({ where: { id: userId } }),
      this.prisma.loginAttempt.deleteMany({ where: { username: before.username } }),
    ]);
    await this.audit.write({
      user: actor,
      operationType: 'user.delete',
      targetTable: 'user_account',
      targetId: id,
      beforeData: auditSnapshot(before),
      remark: `删除用户 ${before.username}（${before.displayName}）`,
    });
    return { ok: true };
  }

  async roles() {
    const rows = await this.prisma.role.findMany({ include: { permissions: true }, orderBy: { sortOrder: 'asc' } });
    return {
      permissions: PERMISSIONS,
      roles: rows.map((role) => ({ ...role, permissionCodes: role.permissions.map((item) => item.permissionCode) })),
    };
  }

  async updateRolePermissions(roleCode: string, values: unknown, actor: AuthUser) {
    if (roleCode === 'admin') throw new BadRequestException('管理员角色权限固定为全部权限。');
    if (!['operator', 'user'].includes(roleCode)) throw new BadRequestException('仅可配置操作员或普通用户。');
    const codes = Array.isArray(values) ? values.map((value) => String(value)) : [];
    const valid = new Set<string>(PERMISSIONS.map(([code]) => code));
    if (codes.some((code) => !valid.has(code))) throw new BadRequestException('包含未知权限。');
    const permissions = [...new Set([...codes, 'inventory.import'])];
    const before = await this.prisma.rolePermission.findMany({ where: { roleCode } });
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleCode } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((permissionCode) => ({ roleCode, permissionCode })),
      }),
    ]);
    await this.audit.write({
      user: actor,
      operationType: 'role.permissions.update',
      targetTable: 'role_permission',
      targetId: roleCode,
      beforeData: before,
      afterData: permissions,
    });
    return { ok: true, permissionCodes: permissions };
  }

  async logs(query: { keyword?: string; operationType?: string; from?: string; to?: string; limit?: string }) {
    const take = Math.min(Math.max(Number(query.limit) || 100, 1), 1000);
    const rows = await this.prisma.operationLog.findMany({
      where: buildLogWhere(query),
      orderBy: { operationTime: 'desc' },
      take,
    });
    return { rows: rows.map((row) => ({ ...row, id: row.id.toString(), userId: row.userId?.toString() ?? null })) };
  }

  async config() {
    return { rows: await this.prisma.desktopConfig.findMany({ orderBy: { configKey: 'asc' } }) };
  }

  async updateConfig(values: Record<string, unknown>, actor: AuthUser) {
    const allowed = new Set(['apiPort', 'databasePort', 'dataDirectory', 'backupDirectory', 'xriteBridgeStatus']);
    const changes: Record<string, string> = {};
    for (const [key, value] of Object.entries(values))
      if (allowed.has(key))
        changes[key] = String(value ?? '')
          .trim()
          .slice(0, 2000);
    await this.prisma.$transaction(
      Object.entries(changes).map(([configKey, configValue]) =>
        this.prisma.desktopConfig.upsert({
          where: { configKey },
          create: { configKey, configValue, updatedBy: actor.username },
          update: { configValue, updatedBy: actor.username },
        }),
      ),
    );
    await this.audit.write({
      user: actor,
      operationType: 'desktop.config.update',
      targetTable: 'desktop_config',
      afterData: changes,
    });
    return { ok: true };
  }

  private async assertRole(code: string) {
    if (!(await this.prisma.role.findUnique({ where: { code } }))) throw new BadRequestException('角色不存在。');
  }
  private async ensureAnotherAdmin(excluding: bigint) {
    if (
      (await this.prisma.userAccount.count({ where: { roleCode: 'admin', enabled: true, id: { not: excluding } } })) ===
      0
    )
      throw new BadRequestException('系统必须保留至少一个已启用管理员。');
  }
}

function parseId(value: string) {
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException('用户编号无效。');
  }
}

@Controller()
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}
  @RequirePermissions('users.manage') @Get('users') users(@Query() query: UserQuery) {
    return this.administration.users(query);
  }
  @RequirePermissions('users.manage') @Post('users') createUser(@Body() body: UserInput, @Req() request: AuthRequest) {
    return this.administration.createUser(body, request.user!);
  }
  @RequirePermissions('users.manage') @Patch('users/:id') updateUser(
    @Param('id') id: string,
    @Body() body: UserInput,
    @Req() request: AuthRequest,
  ) {
    return this.administration.updateUser(id, body, request.user!);
  }
  @RequirePermissions('users.manage') @Delete('users/:id') deleteUser(
    @Param('id') id: string,
    @Req() request: AuthRequest,
  ) {
    return this.administration.deleteUser(id, request.user!);
  }
  @RequirePermissions('roles.manage') @Get('roles') roles() {
    return this.administration.roles();
  }
  @RequirePermissions('roles.manage') @Patch('roles/:code/permissions') updatePermissions(
    @Param('code') code: string,
    @Body() body: { permissionCodes?: unknown },
    @Req() request: AuthRequest,
  ) {
    return this.administration.updateRolePermissions(code, body.permissionCodes, request.user!);
  }
  @RequirePermissions('logs.view') @Get('logs') logs(
    @Query() query: { keyword?: string; operationType?: string; from?: string; to?: string; limit?: string },
  ) {
    return this.administration.logs(query);
  }
  @RequirePermissions('config.manage') @Get('desktop-config') config() {
    return this.administration.config();
  }
  @RequirePermissions('config.manage') @Patch('desktop-config') updateConfig(
    @Body() body: Record<string, unknown>,
    @Req() request: AuthRequest,
  ) {
    return this.administration.updateConfig(body, request.user!);
  }
}
