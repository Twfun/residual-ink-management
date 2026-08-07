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
import type { AuthRequest, AuthUser } from './common';
import { assertLabTriple, cie76, dateOrNull, numberOrNull, RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

export type InventoryInput = {
  storageLocation?: unknown;
  rollerColorCode?: unknown;
  inboundDate?: unknown;
  weightKg?: unknown;
  lStar?: unknown;
  aStar?: unknown;
  bStar?: unknown;
  colorFamily?: unknown;
  note2?: unknown;
  note3?: unknown;
};

type TargetLab = { l: number; a: number; b: number } | null;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    keyword?: string;
    status?: string;
    targetL?: string;
    targetA?: string;
    targetB?: string;
    from?: string;
    to?: string;
  }) {
    const target = this.target(query.targetL, query.targetA, query.targetB);
    const keyword = String(query.keyword ?? '').trim();
    const status = String(query.status ?? '').trim();
    const from = dateOrNull(query.from);
    const to = dateOrNull(query.to);
    const rows = await this.prisma.residualInk.findMany({
      where: {
        deletedAt: null,
        ...(status && status !== '全部' ? { status } : {}),
        ...(from || to ? { inboundDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(keyword
          ? {
              OR: [
                { storageLocation: { contains: keyword } },
                { rollerColorCode: { contains: keyword } },
                { colorFamily: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { storageLocation: 'asc' }],
    });
    const result = rows.map((row) => this.serialize(row, target));
    if (target)
      result.sort(
        (left, right) => (left.deltaE ?? Number.POSITIVE_INFINITY) - (right.deltaE ?? Number.POSITIVE_INFINITY),
      );
    return { rows: result, target };
  }

  async activeForOutbound() {
    const rows = await this.prisma.residualInk.findMany({
      where: { status: '在库', deletedAt: null },
      orderBy: { storageLocation: 'asc' },
    });
    return rows.map((row) => this.serialize(row, null));
  }

  async create(input: InventoryInput, user: AuthUser) {
    const data = this.inputData(input);
    if (!data.storageLocation) throw new BadRequestException('库位不能为空。');
    try {
      const row = await this.prisma.residualInk.create({
        data: { ...data, storageLocation: data.storageLocation!, createdBy: user.username, updatedBy: user.username },
      });
      await this.audit.write({
        user,
        operationType: 'inventory.create',
        targetTable: 'residual_ink',
        targetId: row.id.toString(),
        afterData: row,
      });
      return this.serialize(row, null);
    } catch (error) {
      if (String(error).includes('Unique constraint')) throw new BadRequestException('库位已存在，不能重复新增。');
      throw error;
    }
  }

  async update(id: string, input: InventoryInput, user: AuthUser) {
    const rowId = this.id(id);
    const before = await this.prisma.residualInk.findUniqueOrThrow({ where: { id: rowId } });
    const data = this.patchData(input, before);
    if (data.storageLocation === '') throw new BadRequestException('库位不能为空。');
    try {
      const after = await this.prisma.residualInk.update({
        where: { id: rowId },
        data: { ...data, updatedBy: user.username },
      });
      await this.audit.write({
        user,
        operationType: 'inventory.update',
        targetTable: 'residual_ink',
        targetId: id,
        beforeData: before,
        afterData: after,
      });
      return this.serialize(after, null);
    } catch (error) {
      if (String(error).includes('Unique constraint')) throw new BadRequestException('库位已存在，不能重复使用。');
      throw error;
    }
  }

  async remove(id: string, user: AuthUser) {
    const rowId = this.id(id);
    const before = await this.prisma.residualInk.findUniqueOrThrow({ where: { id: rowId } });
    if (before.deletedAt) throw new BadRequestException('该库存已在最近删除中。');
    const after = await this.prisma.residualInk.update({
      where: { id: rowId },
      data: { deletedAt: new Date(), updatedBy: user.username },
    });
    await this.audit.write({
      user,
      operationType: 'inventory.delete',
      targetTable: 'residual_ink',
      targetId: id,
      beforeData: before,
      afterData: after,
    });
    return { ok: true };
  }

  async deletedList() {
    const rows = await this.prisma.residualInk.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 50,
    });
    return { rows: rows.map((row) => this.serialize(row, null)) };
  }

  async restore(id: string, user: AuthUser) {
    const rowId = this.id(id);
    const before = await this.prisma.residualInk.findUniqueOrThrow({ where: { id: rowId } });
    if (!before.deletedAt) throw new BadRequestException('该库存未被删除。');
    const after = await this.prisma.residualInk.update({
      where: { id: rowId },
      data: { deletedAt: null, updatedBy: user.username },
    });
    await this.audit.write({
      user,
      operationType: 'inventory.restore',
      targetTable: 'residual_ink',
      targetId: id,
      beforeData: before,
      afterData: after,
    });
    return this.serialize(after, null);
  }

  async purge(id: string, user: AuthUser) {
    const rowId = this.id(id);
    const before = await this.prisma.residualInk.findUniqueOrThrow({ where: { id: rowId } });
    if (!before.deletedAt) throw new BadRequestException('仅最近删除中的库存可以清理。');
    const outboundCount = await this.prisma.outboundRecord.count({ where: { residualInkId: rowId } });
    if (outboundCount > 0)
      throw new BadRequestException('已有出库记录的库存不能彻底清理，恢复后可保留为已出清状态。');
    await this.prisma.residualInk.delete({ where: { id: rowId } });
    await this.audit.write({
      user,
      operationType: 'inventory.purge',
      targetTable: 'residual_ink',
      targetId: id,
      beforeData: before,
    });
    return { ok: true };
  }

  toSnapshot(row: {
    id: bigint;
    storageLocation: string;
    rollerColorCode: string | null;
    inboundDate: Date | null;
    weightKg: unknown;
    lStar: unknown;
    aStar: unknown;
    bStar: unknown;
    colorFamily: string | null;
    note2: string | null;
    note3: string | null;
  }) {
    return {
      residualInkId: row.id,
      storageLocation: row.storageLocation,
      rollerColorCode: row.rollerColorCode,
      inboundDate: row.inboundDate,
      lStar: row.lStar,
      aStar: row.aStar,
      bStar: row.bStar,
      colorFamily: row.colorFamily,
      note2: row.note2,
      note3: row.note3,
    };
  }

  serialize(row: Record<string, unknown>, target: TargetLab) {
    const l = row.lStar === null ? null : Number(row.lStar);
    const a = row.aStar === null ? null : Number(row.aStar);
    const b = row.bStar === null ? null : Number(row.bStar);
    const deltaE =
      target && l !== null && a !== null && b !== null ? Number(cie76(target, { l, a, b }).toFixed(4)) : null;
    return {
      ...row,
      id: String(row.id),
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      lStar: l,
      aStar: a,
      bStar: b,
      deltaE,
    };
  }

  private inputData(input: InventoryInput) {
    try {
      const lab = assertLabTriple(input.lStar, input.aStar, input.bStar);
      const weight = numberOrNull(input.weightKg);
      if (weight !== null && weight < 0) throw new Error('重量不能小于 0。');
      const base = {
        storageLocation: text(input.storageLocation, 120),
        rollerColorCode: text(input.rollerColorCode, 200),
        inboundDate: dateOrNull(input.inboundDate),
        weightKg: weight,
        lStar: lab?.l ?? null,
        aStar: lab?.a ?? null,
        bStar: lab?.b ?? null,
        colorFamily: text(input.colorFamily, 120),
        note2: text(input.note2, 500),
        note3: text(input.note3, 500),
      };
      return { ...base, status: weight === 0 ? '已出清' : '在库' };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '库存数据不正确。');
    }
  }

  private patchData(input: InventoryInput, existing: { lStar: unknown; aStar: unknown; bStar: unknown }) {
    try {
      const has = (key: keyof InventoryInput) => Object.prototype.hasOwnProperty.call(input, key);
      const labChanged = has('lStar') || has('aStar') || has('bStar');
      const lab = labChanged
        ? assertLabTriple(
            has('lStar') ? input.lStar : existing.lStar,
            has('aStar') ? input.aStar : existing.aStar,
            has('bStar') ? input.bStar : existing.bStar,
          )
        : undefined;
      const data: Record<string, unknown> = {};
      if (has('storageLocation')) data.storageLocation = text(input.storageLocation, 120);
      if (has('rollerColorCode')) data.rollerColorCode = text(input.rollerColorCode, 200);
      if (has('inboundDate')) data.inboundDate = dateOrNull(input.inboundDate);
      if (has('weightKg')) {
        const weight = numberOrNull(input.weightKg);
        if (weight !== null && weight < 0) throw new Error('重量不能小于 0。');
        data.weightKg = weight;
      }
      if (labChanged) {
        data.lStar = lab?.l ?? null;
        data.aStar = lab?.a ?? null;
        data.bStar = lab?.b ?? null;
      }
      if (has('colorFamily')) data.colorFamily = text(input.colorFamily, 120);
      if (has('note2')) data.note2 = text(input.note2, 500);
      if (has('note3')) data.note3 = text(input.note3, 500);
      return data;
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '库存数据不正确。');
    }
  }

  private target(l: unknown, a: unknown, b: unknown): TargetLab {
    try {
      return assertLabTriple(l, a, b);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '目标 Lab 不正确。');
    }
  }

  private id(value: string) {
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException('库存编号无效。');
    }
  }
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermissions('inventory.view')
  @Get()
  list(
    @Query()
    query: {
      keyword?: string;
      status?: string;
      targetL?: string;
      targetA?: string;
      targetB?: string;
      from?: string;
      to?: string;
    },
  ) {
    return this.inventory.list(query);
  }

  @RequirePermissions('outbound.create')
  @Get('active')
  active() {
    return this.inventory.activeForOutbound();
  }

  @RequirePermissions('inventory.create')
  @Post()
  create(@Body() body: InventoryInput, @Req() request: AuthRequest) {
    return this.inventory.create(body, request.user!);
  }

  @RequirePermissions('inventory.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: InventoryInput, @Req() request: AuthRequest) {
    return this.inventory.update(id, body, request.user!);
  }

  @RequirePermissions('inventory.delete')
  @Get('deleted')
  deleted() {
    return this.inventory.deletedList();
  }

  @RequirePermissions('inventory.delete')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.inventory.remove(id, request.user!);
  }

  @RequirePermissions('inventory.delete')
  @Post(':id/restore')
  restore(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.inventory.restore(id, request.user!);
  }

  @RequirePermissions('inventory.delete')
  @Delete(':id/purge')
  purge(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.inventory.purge(id, request.user!);
  }
}
