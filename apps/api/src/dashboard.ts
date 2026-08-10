import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { RequirePermissions } from './common';
import { PrismaService } from './prisma.service';
import type { Prisma } from './generated/client';

type Dimension = 'day' | 'week' | 'month' | 'year';
const DIMENSIONS: Dimension[] = ['day', 'week', 'month', 'year'];

export function pad(value: number) {
  return String(value).padStart(2, '0');
}
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function weekStart(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - dow);
  return copy;
}
export function bucketKey(date: Date, dimension: Dimension) {
  if (dimension === 'day') return dayKey(date);
  if (dimension === 'week') return dayKey(weekStart(date));
  if (dimension === 'month') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return String(date.getFullYear());
}
export function bucketLabel(key: string, dimension: Dimension) {
  if (dimension === 'day' || dimension === 'week') return key.slice(5);
  return key;
}
export function nextBucket(key: string, dimension: Dimension) {
  if (dimension === 'month') {
    const [y, m] = key.split('-').map(Number);
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    return `${next[0]}-${pad(next[1])}`;
  }
  if (dimension === 'year') return String(Number(key) + 1);
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + (dimension === 'day' ? 1 : 7));
  return dayKey(date);
}
function parseBoundary(value: unknown, end: boolean) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    limitValue?: unknown,
    periodValue?: unknown,
    inventoryPeriodValue?: unknown,
    outboundPeriodValue?: unknown,
  ) {
    const take = Math.min(Math.max(Number(limitValue) || 8, 1), 30);
    const toPeriod = (value: unknown, fallback: unknown) => {
      const candidate = value ?? fallback;
      return DIMENSIONS.includes(candidate as Dimension) ? (candidate as Dimension) : null;
    };
    const periodStart = (period: Dimension | null) => {
      if (!period) return null;
      const now = new Date();
      if (period === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (period === 'week') return weekStart(now);
      if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
      return new Date(now.getFullYear(), 0, 1);
    };
    const period = toPeriod(periodValue, null);
    const inventoryStart = periodStart(toPeriod(inventoryPeriodValue, periodValue));
    const outboundStart = periodStart(toPeriod(outboundPeriodValue, periodValue));
    const statsStart = periodStart(period);
    const inventoryWhere = inventoryStart ? { createdAt: { gte: inventoryStart } } : {};
    const outboundWhere = outboundStart ? { outboundDate: { gte: outboundStart } } : {};
    const statsWhere: Prisma.ResidualInkWhereInput = {
      status: '在库',
      deletedAt: null,
      ...(statsStart ? { createdAt: { gte: statsStart } } : {}),
    };
    const outboundStatsWhere: Prisma.OutboundRecordWhereInput = {
      importedHistorical: false,
      ...(outboundStart ? { outboundDate: { gte: outboundStart } } : {}),
    };
    const [inStockCount, weight, unknownWeight, outboundRows, outboundLines, recentInventory, recentOutbound] =
      await Promise.all([
        this.prisma.residualInk.count({ where: statsWhere }),
        this.prisma.residualInk.aggregate({
          where: { ...statsWhere, weightKg: { not: null } },
          _sum: { weightKg: true },
        }),
        this.prisma.residualInk.count({ where: { ...statsWhere, weightKg: null } }),
        this.prisma.outboundRecord.findMany({
          where: outboundStatsWhere,
          distinct: ['outboundNo'],
          select: { outboundNo: true },
        }),
        this.prisma.outboundRecord.count({ where: outboundStatsWhere }),
        this.prisma.residualInk.findMany({ take, where: { ...inventoryWhere, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
        this.prisma.outboundRecord.findMany({
          take,
          where: outboundWhere,
          orderBy: [{ outboundDate: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);
    return {
      period: period ?? 'all',
      statistics: {
        inStockCount,
        knownWeightKg: weight._sum.weightKg === null ? null : Number(weight._sum.weightKg),
        unknownWeightCount: unknownWeight,
        outboundOrders: outboundRows.length,
        outboundLines,
      },
      recentInventory: recentInventory.map((row) => ({
        ...row,
        id: row.id.toString(),
        weightKg: row.weightKg === null ? null : Number(row.weightKg),
        lStar: row.lStar === null ? null : Number(row.lStar),
        aStar: row.aStar === null ? null : Number(row.aStar),
        bStar: row.bStar === null ? null : Number(row.bStar),
      })),
      recentOutbound: recentOutbound.map((row) => ({
        ...row,
        id: row.id.toString(),
        residualInkId: row.residualInkId?.toString() ?? null,
        weightKg: row.weightKg === null ? null : Number(row.weightKg),
      })),
    };
  }

  async colorDistribution() {
    const rows = await this.prisma.residualInk.groupBy({
      by: ['colorFamily'],
      where: { status: '在库', deletedAt: null },
      _count: { _all: true },
      _sum: { weightKg: true },
    });
    return {
      rows: rows
        .map((row) => ({
          colorFamily: row.colorFamily ?? '未标注',
          count: row._count._all,
          weightKg: row._sum.weightKg === null ? null : Number(row._sum.weightKg),
        }))
        .sort((left, right) => right.count - left.count || left.colorFamily.localeCompare(right.colorFamily)),
    };
  }

  async locationRank(limitValue?: unknown) {
    const take = Math.min(Math.max(Number(limitValue) || 10, 1), 50);
    const rows = await this.prisma.residualInk.findMany({
      where: { status: '在库', weightKg: { not: null }, deletedAt: null },
      select: { storageLocation: true, weightKg: true },
    });
    return {
      rows: rows
        .map((row) => ({ storageLocation: row.storageLocation, weightKg: Number(row.weightKg) }))
        .sort(
          (left, right) => right.weightKg - left.weightKg || left.storageLocation.localeCompare(right.storageLocation),
        )
        .slice(0, take),
    };
  }

  async weightDistribution() {
    const rows = await this.prisma.residualInk.findMany({
      where: { status: '在库', weightKg: { not: null }, deletedAt: null },
      select: { weightKg: true },
    });
    const buckets = [
      { label: '0-1', min: 0, max: 1, count: 0 },
      { label: '1-5', min: 1, max: 5, count: 0 },
      { label: '5-10', min: 5, max: 10, count: 0 },
      { label: '10-50', min: 10, max: 50, count: 0 },
      { label: '50+', min: 50, max: null as number | null, count: 0 },
    ];
    for (const row of rows) {
      const weight = Number(row.weightKg);
      const bucket =
        weight < 1
          ? buckets[0]
          : weight < 5
            ? buckets[1]
            : weight < 10
              ? buckets[2]
              : weight < 50
                ? buckets[3]
                : buckets[4];
      bucket.count += 1;
    }
    return { buckets };
  }

  async series(dimensionValue?: unknown, fromValue?: unknown, toValue?: unknown) {
    const dimension: Dimension = DIMENSIONS.includes(dimensionValue as Dimension)
      ? (dimensionValue as Dimension)
      : 'day';
    const from = parseBoundary(fromValue, false);
    const to = parseBoundary(toValue, true);
    const [inventoryDates, outboundDates] = await Promise.all([
      this.prisma.residualInk.findMany({ where: { deletedAt: null }, select: { inboundDate: true, createdAt: true } }),
      this.prisma.outboundRecord.findMany({ select: { outboundDate: true, createdAt: true } }),
    ]);
    const pickDate = (row: { inboundDate?: Date | null; outboundDate?: Date | null; createdAt: Date }) =>
      row.inboundDate ?? row.outboundDate ?? row.createdAt;
    const inboundCounts = new Map<string, number>();
    const outboundCounts = new Map<string, number>();
    let min: Date | null = null;
    let max: Date | null = null;
    const track = (date: Date) => {
      if (!min || date < min) min = date;
      if (!max || date > max) max = date;
    };
    for (const row of inventoryDates) {
      const date = pickDate(row);
      if (from && date < from) continue;
      if (to && date > to) continue;
      track(date);
      const key = bucketKey(date, dimension);
      inboundCounts.set(key, (inboundCounts.get(key) ?? 0) + 1);
    }
    for (const row of outboundDates) {
      const date = pickDate(row);
      if (from && date < from) continue;
      if (to && date > to) continue;
      track(date);
      const key = bucketKey(date, dimension);
      outboundCounts.set(key, (outboundCounts.get(key) ?? 0) + 1);
    }
    const keys: string[] = [];
    const startSource = from ?? min;
    const endSource = to ?? max;
    if (startSource && endSource) {
      let key = bucketKey(startSource, dimension);
      const lastKey = bucketKey(endSource, dimension);
      let guard = 0;
      while (key <= lastKey && guard < 2000) {
        keys.push(key);
        key = nextBucket(key, dimension);
        guard += 1;
      }
    }
    return {
      dimension,
      buckets: keys.map((key) => ({
        key,
        label: bucketLabel(key, dimension),
        inbound: inboundCounts.get(key) ?? 0,
        outbound: outboundCounts.get(key) ?? 0,
      })),
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermissions('dashboard.view')
  @Get()
  overview(
    @Query('limit') limit?: string,
    @Query('period') period?: string,
    @Query('inventoryPeriod') inventoryPeriod?: string,
    @Query('outboundPeriod') outboundPeriod?: string,
  ) {
    return this.dashboard.overview(limit, period, inventoryPeriod, outboundPeriod);
  }

  @RequirePermissions('dashboard.view')
  @Get('color-distribution')
  colorDistribution() {
    return this.dashboard.colorDistribution();
  }

  @RequirePermissions('dashboard.view')
  @Get('location-rank')
  locationRank(@Query('limit') limit?: string) {
    return this.dashboard.locationRank(limit);
  }

  @RequirePermissions('dashboard.view')
  @Get('weight-distribution')
  weightDistribution() {
    return this.dashboard.weightDistribution();
  }

  @RequirePermissions('dashboard.view')
  @Get('series')
  series(@Query('dimension') dimension?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.series(dimension, from, to);
  }
}
