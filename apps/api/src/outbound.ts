import { BadRequestException, Body, Controller, Get, Injectable, Post, Query, Req } from '@nestjs/common';
import type { AuthRequest, AuthUser } from './common';
import { dateOrNull, numberOrNull, RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

type OutboundLine = { residualInkId?: unknown; weightKg?: unknown };
type OutboundInput = { outboundNo?: unknown; outboundDate?: unknown; lines?: OutboundLine[] };

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { keyword?: string; from?: string; to?: string }) {
    const keyword = String(query.keyword ?? '').trim();
    const from = dateOrNull(query.from);
    const to = dateOrNull(query.to);
    const rows = await this.prisma.outboundRecord.findMany({
      where: {
        ...(keyword
          ? {
              OR: [
                { outboundNo: { contains: keyword } },
                { storageLocation: { contains: keyword } },
                { rollerColorCode: { contains: keyword } },
              ],
            }
          : {}),
        ...(from || to ? { outboundDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: [{ outboundDate: 'desc' }, { outboundNo: 'desc' }, { storageLocation: 'asc' }],
    });
    return { rows: rows.map((row) => this.serialize(row)) };
  }

  async create(input: OutboundInput, user: AuthUser) {
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) throw new BadRequestException('至少需要一条出库明细。');
    const outboundDate = dateOrNull(input.outboundDate) ?? new Date();
    const outboundNo = text(input.outboundNo, 80) ?? this.nextNumber();
    const parsed = lines.map((line) => ({ id: parseBigInt(line.residualInkId), weight: numberOrNull(line.weightKg) }));
    if (parsed.some((line) => line.weight === null || line.weight! <= 0))
      throw new BadRequestException('每条出库明细必须填写大于 0 的重量。');
    if (new Set(parsed.map((line) => line.id.toString())).size !== parsed.length)
      throw new BadRequestException('同一库存不能在同一张出库单中重复出现。');
    const created = await this.prisma.$transaction(async (tx) => {
      const records = [];
      for (const line of parsed) {
        const inventory = await tx.residualInk.findUnique({ where: { id: line.id } });
        if (!inventory || inventory.deletedAt || inventory.status !== '在库') throw new BadRequestException('存在不可出库的库存记录。');
        if (inventory.weightKg === null)
          throw new BadRequestException(`库位 ${inventory.storageLocation} 的库存重量未知，请先补录重量。`);
        const beforeWeight = Number(inventory.weightKg);
        if (line.weight! > beforeWeight + 0.000001)
          throw new BadRequestException(`库位 ${inventory.storageLocation} 的出库重量超过当前库存。`);
        const remaining = Number((beforeWeight - line.weight!).toFixed(3));
        const outbound = await tx.outboundRecord.create({
          data: {
            ...snapshot(inventory),
            outboundDate,
            outboundNo,
            weightKg: line.weight!,
            importedHistorical: false,
            createdBy: user.username,
          },
        });
        await tx.residualInk.update({
          where: { id: inventory.id },
          data: { weightKg: remaining, status: remaining === 0 ? '已出清' : '在库', updatedBy: user.username },
        });
        records.push({ outbound, inventory, remaining });
      }
      return records;
    });
    await this.audit.write({
      user,
      operationType: 'outbound.create',
      targetTable: 'outbound_record',
      targetId: outboundNo,
      afterData: created.map((item) => ({
        id: item.outbound.id,
        storageLocation: item.inventory.storageLocation,
        weightKg: item.outbound.weightKg,
        remaining: item.remaining,
      })),
      remark: `出库单 ${outboundNo}`,
    });
    return { outboundNo, rows: created.map((item) => this.serialize(item.outbound)) };
  }

  private nextNumber() {
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, '0');
    return `CK${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  }

  private serialize(row: Record<string, unknown>) {
    return {
      ...row,
      id: String(row.id),
      residualInkId: row.residualInkId === null ? null : String(row.residualInkId),
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      lStar: row.lStar === null ? null : Number(row.lStar),
      aStar: row.aStar === null ? null : Number(row.aStar),
      bStar: row.bStar === null ? null : Number(row.bStar),
      deltaE: row.deltaE === null ? null : Number(row.deltaE),
    };
  }
}

function parseBigInt(value: unknown) {
  try {
    return BigInt(String(value));
  } catch {
    throw new BadRequestException('出库库存编号无效。');
  }
}

function snapshot(inventory: {
  id: bigint;
  storageLocation: string;
  rollerColorCode: string | null;
  inboundDate: Date | null;
  lStar: unknown;
  aStar: unknown;
  bStar: unknown;
  colorFamily: string | null;
  note2: string | null;
  note3: string | null;
}) {
  return {
    residualInkId: inventory.id,
    storageLocation: inventory.storageLocation,
    rollerColorCode: inventory.rollerColorCode,
    inboundDate: inventory.inboundDate,
    lStar: inventory.lStar === null ? null : Number(inventory.lStar),
    aStar: inventory.aStar === null ? null : Number(inventory.aStar),
    bStar: inventory.bStar === null ? null : Number(inventory.bStar),
    colorFamily: inventory.colorFamily,
    note2: inventory.note2,
    note3: inventory.note3,
  };
}

@Controller('outbound')
export class OutboundController {
  constructor(private readonly outbound: OutboundService) {}

  @RequirePermissions('outbound.view')
  @Get()
  list(@Query() query: { keyword?: string; from?: string; to?: string }) {
    return this.outbound.list(query);
  }

  @RequirePermissions('outbound.create')
  @Post()
  create(@Body() body: OutboundInput, @Req() request: AuthRequest) {
    return this.outbound.create(body, request.user!);
  }
}
