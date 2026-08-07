import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthRequest } from './common';
import { assertLabTriple, deltaE, normalizeFormula, numberOrNull, RequirePermissions } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

type MatchInput = {
  l?: unknown;
  a?: unknown;
  b?: unknown;
  source?: unknown;
  densityT?: unknown;
  serial?: unknown;
  model?: unknown;
  measureCondition?: unknown;
  formula?: unknown;
  maxDeltaE?: unknown;
  limit?: unknown;
  colorFamily?: unknown;
};

@Injectable()
export class MatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async search(input: MatchInput) {
    const target = this.target(input);
    const formula = normalizeFormula(input.formula);
    const maxDeltaE = numberOrNull(input.maxDeltaE);
    if (maxDeltaE !== null && maxDeltaE < 0) throw new BadRequestException('色差阈值不能为负数。');
    const limit = Math.min(Math.max(Number(input.limit) || 0, 0), 500);
    const colorFamily = String(input.colorFamily ?? '').trim();
    const rows = await this.prisma.residualInk.findMany({
      where: {
        status: '在库',
        deletedAt: null,
        lStar: { not: null },
        aStar: { not: null },
        bStar: { not: null },
        ...(colorFamily ? { colorFamily } : {}),
      },
    });
    let matches = rows.map((row) => ({
      id: row.id.toString(),
      storageLocation: row.storageLocation,
      rollerColorCode: row.rollerColorCode,
      inboundDate: row.inboundDate,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      lStar: Number(row.lStar),
      aStar: Number(row.aStar),
      bStar: Number(row.bStar),
      colorFamily: row.colorFamily,
      note2: row.note2,
      note3: row.note3,
      deltaE: Number(
        deltaE(formula, target, { l: Number(row.lStar), a: Number(row.aStar), b: Number(row.bStar) }).toFixed(4),
      ),
    }));
    if (maxDeltaE !== null) matches = matches.filter((match) => match.deltaE <= maxDeltaE);
    matches.sort(
      (left, right) => left.deltaE - right.deltaE || left.storageLocation.localeCompare(right.storageLocation),
    );
    const matchCount = matches.length;
    if (limit > 0) matches = matches.slice(0, limit);
    return { target, formula, matches, availableCount: rows.length, matchCount };
  }

  async colorFamilies() {
    const rows = await this.prisma.residualInk.findMany({
      where: { status: '在库', colorFamily: { not: null }, deletedAt: null },
      distinct: ['colorFamily'],
      select: { colorFamily: true },
      orderBy: { colorFamily: 'asc' },
    });
    return { rows: rows.map((row) => row.colorFamily) };
  }

  async recordMeasurement(input: MatchInput, username: string) {
    const target = this.target(input);
    const density = numberOrNull(input.densityT);
    if (density !== null && (density < 0 || density > 10))
      throw new BadRequestException('密度 T 必须在 0 到 10 之间。');
    const row = await this.prisma.colorMeasurement.create({
      data: {
        lStar: target.l,
        aStar: target.a,
        bStar: target.b,
        densityT: density,
        source: String(input.source ?? 'instrument'),
        instrumentSerial: trim(input.serial, 80),
        instrumentModel: trim(input.model, 120),
        measureCondition: trim(input.measureCondition, 120),
        measuredBy: username,
      },
    });
    await this.audit.write({
      username,
      operationType: 'match.measurement.save',
      targetTable: 'color_measurement',
      targetId: row.id.toString(),
      afterData: row,
    });
    return row;
  }

  async history(limit?: unknown) {
    const take = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const rows = await this.prisma.colorMeasurement.findMany({ take, where: { deletedAt: null }, orderBy: { measuredAt: 'desc' } });
    return {
      rows: rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        lStar: Number(row.lStar),
        aStar: Number(row.aStar),
        bStar: Number(row.bStar),
        densityT: row.densityT === null ? null : Number(row.densityT),
      })),
    };
  }

  async removeMeasurement(idValue: string, username: string) {
    const id = this.measurementId(idValue);
    const row = await this.prisma.colorMeasurement.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('测量记录不存在或已被删除。');
    await this.prisma.colorMeasurement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.write({
      username,
      operationType: 'match.measurement.delete',
      targetTable: 'color_measurement',
      targetId: id.toString(),
      beforeData: row,
    });
    return { ok: true };
  }

  async restoreMeasurement(idValue: string, username: string) {
    const id = this.measurementId(idValue);
    const row = await this.prisma.colorMeasurement.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new NotFoundException('测量记录不存在或未被删除。');
    await this.prisma.colorMeasurement.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.write({
      username,
      operationType: 'match.measurement.restore',
      targetTable: 'color_measurement',
      targetId: id.toString(),
      afterData: row,
    });
    return { ok: true };
  }

  private measurementId(value: string) {
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException('测量记录编号无效。');
    }
  }

  private target(input: MatchInput) {
    try {
      const value = assertLabTriple(input.l, input.a, input.b);
      if (!value) throw new Error('请输入完整的目标 L、a、b。');
      return value;
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '目标 Lab 不正确。');
    }
  }
}

function trim(value: unknown, max: number) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

@Controller('match')
export class MatchController {
  constructor(private readonly match: MatchService) {}

  @RequirePermissions('match.view')
  @Post('search')
  search(@Body() body: MatchInput) {
    return this.match.search(body);
  }

  @RequirePermissions('match.view')
  @Post('measurements')
  measurement(@Body() body: MatchInput, @Req() request: AuthRequest) {
    return this.match.recordMeasurement(body, request.user!.username);
  }

  @RequirePermissions('match.view')
  @Get('measurements')
  history(@Query('limit') limit?: string) {
    return this.match.history(limit);
  }

  @RequirePermissions('match.view')
  @Delete('measurements/:id')
  removeMeasurement(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.match.removeMeasurement(id, request.user!.username);
  }

  @RequirePermissions('match.view')
  @Post('measurements/:id/restore')
  restoreMeasurement(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.match.restoreMeasurement(id, request.user!.username);
  }

  @RequirePermissions('match.view')
  @Get('color-families')
  colorFamilies() {
    return this.match.colorFamilies();
  }
}
