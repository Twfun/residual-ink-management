import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { RequirePermissions } from './common';
import { dayKey, pad } from './dashboard';
import { PrismaService } from './prisma.service';

export function resolveYearMonth(yearValue?: unknown, monthValue?: unknown, now = new Date()) {
  const year =
    yearValue === undefined || yearValue === null || String(yearValue).trim() === ''
      ? now.getFullYear()
      : Number(yearValue);
  const month =
    monthValue === undefined || monthValue === null || String(monthValue).trim() === ''
      ? now.getMonth() + 1
      : Number(monthValue);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new BadRequestException('年份不正确。');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('月份不正确。');
  return { year, month };
}

export function monthDayCount(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function monthBounds(year: number, month: number) {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

type DailyCount = { date: string; inbound: number; outbound: number };

export function buildMonthlyDays(
  year: number,
  month: number,
  inboundCounts: Map<string, number>,
  outboundCounts: Map<string, number>,
) {
  const dayCount = monthDayCount(year, month);
  const days: DailyCount[] = [];
  let totalInbound = 0;
  let totalOutbound = 0;
  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const inbound = inboundCounts.get(date) ?? 0;
    const outbound = outboundCounts.get(date) ?? 0;
    totalInbound += inbound;
    totalOutbound += outbound;
    days.push({ date, inbound, outbound });
  }
  return { days, total: { inbound: totalInbound, outbound: totalOutbound, days: dayCount } };
}

export function parseDay(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('日期格式应为 YYYY-MM-DD。');
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime())) throw new BadRequestException('日期不正确。');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async monthly(yearValue?: unknown, monthValue?: unknown) {
    const { year, month } = resolveYearMonth(yearValue, monthValue);
    const { start, end } = monthBounds(year, month);
    const [inboundRows, outboundRows] = await Promise.all([
      this.prisma.residualInk.findMany({
        where: { inboundDate: { gte: start, lt: end }, deletedAt: null },
        select: { inboundDate: true },
      }),
      this.prisma.outboundRecord.findMany({
        where: { outboundDate: { gte: start, lt: end } },
        select: { outboundDate: true },
      }),
    ]);
    const inboundCounts = new Map<string, number>();
    for (const row of inboundRows) {
      if (!row.inboundDate) continue;
      const key = dayKey(row.inboundDate);
      inboundCounts.set(key, (inboundCounts.get(key) ?? 0) + 1);
    }
    const outboundCounts = new Map<string, number>();
    for (const row of outboundRows) {
      const key = dayKey(row.outboundDate);
      outboundCounts.set(key, (outboundCounts.get(key) ?? 0) + 1);
    }
    const { days, total } = buildMonthlyDays(year, month, inboundCounts, outboundCounts);
    return { year, month, days, total };
  }

  async daily(dateValue?: unknown, kindValue?: unknown) {
    const { start, end } = parseDay(dateValue);
    const kind =
      kindValue === undefined || kindValue === null || String(kindValue).trim() === '' ? 'inbound' : String(kindValue);
    if (kind !== 'inbound' && kind !== 'outbound') throw new BadRequestException('kind 应为 inbound 或 outbound。');
    if (kind === 'outbound') {
      const rows = await this.prisma.outboundRecord.findMany({
        where: { outboundDate: { gte: start, lt: end } },
        orderBy: [{ outboundNo: 'asc' }, { storageLocation: 'asc' }],
        select: {
          id: true,
          outboundNo: true,
          storageLocation: true,
          rollerColorCode: true,
          weightKg: true,
          colorFamily: true,
        },
      });
      return {
        kind,
        rows: rows.map((row) => ({ ...row, weightKg: row.weightKg === null ? null : Number(row.weightKg) })),
      };
    }
    const rows = await this.prisma.residualInk.findMany({
      where: { inboundDate: { gte: start, lt: end }, deletedAt: null },
      orderBy: { storageLocation: 'asc' },
      select: { id: true, storageLocation: true, rollerColorCode: true, weightKg: true, colorFamily: true },
    });
    return {
      kind,
      rows: rows.map((row) => ({ ...row, weightKg: row.weightKg === null ? null : Number(row.weightKg) })),
    };
  }
}

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @RequirePermissions('dashboard.view')
  @Get('monthly')
  monthly(@Query('year') year?: string, @Query('month') month?: string) {
    return this.statistics.monthly(year, month);
  }

  @RequirePermissions('dashboard.view')
  @Get('daily')
  daily(@Query('date') date?: string, @Query('kind') kind?: string) {
    return this.statistics.daily(date, kind);
  }
}
