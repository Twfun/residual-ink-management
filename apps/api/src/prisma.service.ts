import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from './generated/client';

export const PERMISSIONS = [
  ['dashboard.view', '查看智能工作台', 'dashboard'],
  ['match.view', '使用标样匹配', 'match'],
  ['inventory.view', '查看余墨库存', 'inventory'],
  ['inventory.create', '新增余墨库存', 'inventory'],
  ['inventory.update', '编辑余墨库存', 'inventory'],
  ['inventory.delete', '删除余墨库存', 'inventory'],
  ['inventory.import', '导入余墨 Excel', 'inventory'],
  ['inventory.export', '导出余墨库存', 'inventory'],
  ['outbound.view', '查看余墨出库', 'outbound'],
  ['outbound.create', '执行余墨出库', 'outbound'],
  ['outbound.export', '导出余墨出库', 'outbound'],
  ['users.manage', '管理用户', 'users'],
  ['roles.manage', '管理角色权限', 'users'],
  ['backup.manage', '备份与恢复', 'backup'],
  ['logs.view', '查看操作日志', 'logs'],
  ['logs.export', '导出操作日志', 'logs'],
  ['config.manage', '管理桌面配置', 'config'],
  ['formula.view', '查看配方档案', 'formula'],
  ['formula.edit', '编辑配方档案', 'formula'],
  ['formula.publish', '发布与停用配方', 'formula'],
  ['material.edit', '维护配方物料', 'formula'],
] as const;

const OPERATOR_DEFAULTS = [
  'dashboard.view',
  'match.view',
  'inventory.view',
  'inventory.create',
  'inventory.update',
  'inventory.import',
  'inventory.export',
  'outbound.view',
  'outbound.create',
  'outbound.export',
  'formula.view',
  'formula.edit',
  'material.edit',
];
const USER_DEFAULTS = [
  'dashboard.view',
  'match.view',
  'inventory.view',
  'inventory.import',
  'inventory.export',
  'outbound.view',
  'outbound.export',
  'formula.view',
];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await this.ensureBaseline();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async ensureBaseline() {
    await this.role.createMany({
      data: [
        { code: 'admin', name: '管理员', description: '系统全部权限', sortOrder: 1 },
        { code: 'operator', name: '操作员', description: '库存与出库操作', sortOrder: 2 },
        { code: 'user', name: '普通用户', description: '查询、匹配与导入', sortOrder: 3 },
      ],
      skipDuplicates: true,
    });
    await this.permission.createMany({
      data: PERMISSIONS.map(([code, label, module], sortOrder) => ({ code, label, module, sortOrder })),
      skipDuplicates: true,
    });
    const allCodes = PERMISSIONS.map(([code]) => code);
    await this.ensureRolePermissions('admin', allCodes, true);
    await this.ensureRolePermissions('operator', OPERATOR_DEFAULTS, false);
    await this.ensureRolePermissions('user', USER_DEFAULTS, false);
    for (const roleCode of ['admin', 'operator', 'user']) {
      await this.rolePermission.upsert({
        where: { roleCode_permissionCode: { roleCode, permissionCode: 'inventory.import' } },
        create: { roleCode, permissionCode: 'inventory.import' },
        update: {},
      });
    }
    if ((await this.userAccount.count()) === 0) {
      await this.userAccount.create({
        data: {
          username: 'admin',
          passwordHash: await bcrypt.hash('admin123', 10),
          displayName: '系统管理员',
          roleCode: 'admin',
          mustChangePassword: true,
        },
      });
    }
  }

  private async ensureRolePermissions(roleCode: string, codes: readonly string[], force: boolean) {
    const count = await this.rolePermission.count({ where: { roleCode } });
    if (!force && count > 0) return;
    await this.rolePermission.createMany({
      data: codes.map((permissionCode) => ({ roleCode, permissionCode })),
      skipDuplicates: true,
    });
  }
}
