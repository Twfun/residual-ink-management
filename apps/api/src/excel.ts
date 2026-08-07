import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { Workbook } from 'exceljs';
import type { AuthRequest, AuthUser } from './common';
import { assertLabTriple, cie76, dateOrNull, numberOrNull, RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { buildLogWhere, type LogQuery } from './administration';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';

type InventoryRow = {
  rowNumber: number;
  storageLocation: string | null;
  rollerColorCode: string | null;
  inboundDate: Date | null;
  weightKg: number | null;
  lStar: number | null;
  aStar: number | null;
  bStar: number | null;
  colorFamily: string | null;
  note2: string | null;
  note3: string | null;
  error?: string;
};
type OutboundRow = InventoryRow & { outboundDate: Date | null; outboundNo: string | null };
type ParsedImport = {
  token: string;
  fileName: string;
  sha256: string;
  inventory: InventoryRow[];
  outbound: OutboundRow[];
  expiresAt: number;
};
type UploadFile = { buffer: Buffer; originalname: string };

const INVENTORY_HEADERS = ['库位', '版辊号+色序', '入库日期', '重量', 'L', 'a', 'b', '色差', '色系', '备注2', '备注3'];
const OUTBOUND_HEADERS = ['出库日期', '出库单号', ...INVENTORY_HEADERS];

@Injectable()
export class ExcelImportService {
  private readonly pending = new Map<string, ParsedImport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(file: UploadFile | undefined, user: AuthUser, request: AuthRequest) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择 Excel 文件。');
    if (!/\.xls[xm]$/i.test(file.originalname)) throw new BadRequestException('仅支持 .xlsx 或 .xlsm 文件。');
    const parsed = await this.parse(file.buffer, file.originalname);
    const inventoryExisting = new Set(
      (await this.prisma.residualInk.findMany({ select: { storageLocation: true } })).map(
        (item) => item.storageLocation,
      ),
    );
    const outboundExisting = new Set(
      (await this.prisma.outboundRecord.findMany({ select: { outboundNo: true, storageLocation: true } })).map(
        (item) => `${item.outboundNo}\u0000${item.storageLocation}`,
      ),
    );
    const inventoryKeys = new Set<string>();
    const outboundKeys = new Set<string>();
    const stats = {
      inventory: summary(parsed.inventory, (row) => row.storageLocation, inventoryExisting, inventoryKeys),
      outbound: summary(
        parsed.outbound,
        (row) => (row.outboundNo && row.storageLocation ? `${row.outboundNo}\u0000${row.storageLocation}` : null),
        outboundExisting,
        outboundKeys,
      ),
    };
    this.pending.set(parsed.token, parsed);
    await this.audit.write({
      user,
      request,
      operationType: 'excel.preview',
      targetTable: 'import_job',
      targetId: parsed.token,
      afterData: { fileName: parsed.fileName, sha256: parsed.sha256, ...stats },
    });
    return {
      token: parsed.token,
      fileName: parsed.fileName,
      sha256: parsed.sha256,
      expiresAt: new Date(parsed.expiresAt),
      rows: { inventory: parsed.inventory.length, outbound: parsed.outbound.length },
      ...stats,
      samples: {
        inventoryErrors: parsed.inventory.filter((row) => row.error).slice(0, 20),
        outboundErrors: parsed.outbound.filter((row) => row.error).slice(0, 20),
      },
    };
  }

  async commit(token: unknown, user: AuthUser, request: AuthRequest) {
    const value = String(token ?? '');
    const parsed = this.pending.get(value);
    if (!parsed || parsed.expiresAt < Date.now()) {
      this.pending.delete(value);
      throw new BadRequestException('导入预检已失效，请重新上传文件。');
    }
    let result: {
      jobId: string;
      imported: number;
      skipped: number;
      errors: number;
      errorsList: Array<{ type: string; row: number; error: string }>;
    };
    try {
      let imported = 0;
      let skipped = 0;
      let errors = 0;
      const errorsList: Array<{ type: string; row: number; error: string }> = [];
      for (const row of parsed.inventory) {
        if (row.error) {
          errors++;
          errorsList.push({ type: 'inventory', row: row.rowNumber, error: row.error });
        }
      }
      for (const row of parsed.outbound) {
        if (row.error) {
          errors++;
          errorsList.push({ type: 'outbound', row: row.rowNumber, error: row.error });
        }
      }

      // Chunked batch inserts instead of one long interactive transaction: a
      // multi-thousand-row transaction can exceed engine timeouts. Imports are
      // idempotent (duplicates are skipped), so re-running an import is safe.
      const prisma = this.prisma;
      const inventoryRows = parsed.inventory.filter((row) => !row.error && row.storageLocation);
      const inventoryExisting = new Set(
        (
          await prisma.residualInk.findMany({
            where: { storageLocation: { in: inventoryRows.map((row) => row.storageLocation!) } },
            select: { storageLocation: true },
          })
        ).map((row) => row.storageLocation),
      );
      const inventorySeen = new Set<string>();
      const inventoryDataRows = [];
      for (const row of inventoryRows) {
        const key = row.storageLocation!;
        if (inventoryExisting.has(key) || inventorySeen.has(key)) {
          skipped++;
          continue;
        }
        inventorySeen.add(key);
        inventoryDataRows.push({
          ...inventoryData(row),
          createdBy: user.username,
          updatedBy: user.username,
          status: row.weightKg === 0 ? '已出清' : '在库',
        });
      }
      for (let i = 0; i < inventoryDataRows.length; i += 500) {
        const chunk = inventoryDataRows.slice(i, i + 500);
        const created = await prisma.residualInk.createMany({ data: chunk, skipDuplicates: true });
        imported += created.count;
        skipped += chunk.length - created.count;
      }

      const outboundRows = parsed.outbound.filter((row) => !row.error && row.outboundNo && row.storageLocation);
      const outboundExisting = new Set(
        (
          await prisma.outboundRecord.findMany({
            where: {
              OR: outboundRows.map((row) => ({ outboundNo: row.outboundNo!, storageLocation: row.storageLocation! })),
            },
            select: { outboundNo: true, storageLocation: true },
          })
        ).map((row) => `${row.outboundNo}\u0000${row.storageLocation}`),
      );
      const outboundSeen = new Set<string>();
      const outboundDataRows = [];
      for (const row of outboundRows) {
        const key = `${row.outboundNo!}\u0000${row.storageLocation!}`;
        if (outboundExisting.has(key) || outboundSeen.has(key)) {
          skipped++;
          continue;
        }
        outboundSeen.add(key);
        outboundDataRows.push({
          ...inventoryData(row),
          outboundDate: row.outboundDate!,
          outboundNo: row.outboundNo!,
          importedHistorical: true,
          createdBy: user.username,
        });
      }
      for (let i = 0; i < outboundDataRows.length; i += 500) {
        const chunk = outboundDataRows.slice(i, i + 500);
        const created = await prisma.outboundRecord.createMany({ data: chunk, skipDuplicates: true });
        imported += created.count;
        skipped += chunk.length - created.count;
      }
      const job = await prisma.importJob.create({
        data: {
          fileName: parsed.fileName,
          fileSha256: parsed.sha256,
          mode: 'commit',
          inventoryRows: parsed.inventory.length,
          outboundRows: parsed.outbound.length,
          importedRows: imported,
          skippedRows: skipped,
          errorRows: errors,
          createdBy: user.username,
        },
      });
      result = { jobId: job.id.toString(), imported, skipped, errors, errorsList: errorsList.slice(0, 100) };
    } catch (error) {
      throw new BadRequestException(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.pending.delete(value);
    await this.audit.write({
      user,
      request,
      operationType: 'excel.commit',
      targetTable: 'import_job',
      targetId: result.jobId,
      afterData: { fileName: parsed.fileName, sha256: parsed.sha256, ...result },
    });
    return result;
  }

  private async parse(buffer: Buffer, fileName: string): Promise<ParsedImport> {
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as never); // xlsm is parsed as a workbook only; no VBA code is executed.
    const inventorySheet = workbook.getWorksheet('库存表');
    const outboundSheet = workbook.getWorksheet('出库表');
    const inventory = inventorySheet ? parseInventory(inventorySheet) : [];
    const outbound = outboundSheet ? parseOutbound(outboundSheet) : [];
    if (!inventorySheet && !outboundSheet) throw new BadRequestException('文件中未找到“库存表”或“出库表”。');
    return {
      token: randomUUID(),
      fileName,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      inventory,
      outbound,
      expiresAt: Date.now() + 10 * 60_000,
    };
  }
}

function summary<T extends { error?: string }>(
  rows: T[],
  key: (row: T) => string | null,
  existing: Set<string>,
  seen: Set<string>,
) {
  let valid = 0;
  let errors = 0;
  let skipped = 0;
  for (const row of rows) {
    const value = key(row);
    if (row.error || !value) {
      errors++;
      continue;
    }
    valid++;
    if (existing.has(value) || seen.has(value)) skipped++;
    seen.add(value);
  }
  return { total: rows.length, valid, errors, willImport: valid - skipped, willSkip: skipped };
}

function parseInventory(sheet: import('exceljs').Worksheet): InventoryRow[] {
  const headerRow = findHeader(sheet, INVENTORY_HEADERS);
  if (!headerRow) throw new BadRequestException('库存表表头不符合要求。');
  const index = headerIndex(sheet, headerRow);
  const rows: InventoryRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const values = valuesFor(sheet, rowNumber, index);
    if (Object.values(values).every((value) => value === null || value === undefined || value === '')) continue;
    rows.push(toInventoryRow(rowNumber, values));
  }
  return rows;
}

function parseOutbound(sheet: import('exceljs').Worksheet): OutboundRow[] {
  const headerRow = findHeader(sheet, OUTBOUND_HEADERS);
  if (!headerRow) throw new BadRequestException('出库表表头不符合要求。');
  const index = headerIndex(sheet, headerRow);
  const rows: OutboundRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const values = valuesFor(sheet, rowNumber, index);
    if (Object.values(values).every((value) => value === null || value === undefined || value === '')) continue;
    const base = toInventoryRow(rowNumber, values);
    const outboundDate = parseExcelDate(values['出库日期']);
    const outboundNo = text(values['出库单号'], 80);
    if (!outboundDate) base.error ??= '出库日期不能为空且必须有效。';
    if (!outboundNo) base.error ??= '出库单号不能为空。';
    rows.push({ ...base, outboundDate, outboundNo });
  }
  return rows;
}

function findHeader(sheet: import('exceljs').Worksheet, expected: string[]) {
  for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
    const values = sheet.getRow(row).values as unknown[];
    const normalized = values.map((value) => String(value ?? '').trim());
    if (expected.every((header) => normalized.includes(header))) return row;
  }
  return null;
}

function headerIndex(sheet: import('exceljs').Worksheet, rowNumber: number) {
  const result = new Map<string, number>();
  sheet.getRow(rowNumber).eachCell((cell, column) => result.set(String(cell.text).trim(), column));
  return result;
}

function valuesFor(sheet: import('exceljs').Worksheet, rowNumber: number, index: Map<string, number>) {
  const result: Record<string, unknown> = {};
  for (const [header, column] of index) result[header] = sheet.getRow(rowNumber).getCell(column).value;
  return result;
}

function toInventoryRow(rowNumber: number, values: Record<string, unknown>): InventoryRow {
  const storageLocation = text(values['库位'], 120);
  const weightKg = numberOrNull(values['重量']);
  const inboundDate = parseExcelDate(values['入库日期']);
  let error: string | undefined;
  if (!storageLocation) error = '库位不能为空。';
  if (
    values['重量'] !== null &&
    values['重量'] !== undefined &&
    String(values['重量']).trim() !== '' &&
    weightKg === null
  )
    error ??= '重量必须为数值。';
  if (weightKg !== null && weightKg < 0) error ??= '重量不能小于 0。';
  try {
    assertLabTriple(values.L, values.a, values.b);
  } catch (reason) {
    error ??= reason instanceof Error ? reason.message : 'Lab 数据无效。';
  }
  let lab: { l: number; a: number; b: number } | null = null;
  try {
    lab = assertLabTriple(values.L, values.a, values.b);
  } catch (reason) {
    error ??= reason instanceof Error ? reason.message : 'Invalid Lab data.';
  }
  return {
    rowNumber,
    storageLocation,
    rollerColorCode: text(values['版辊号+色序'], 200),
    inboundDate,
    weightKg,
    lStar: lab?.l ?? null,
    aStar: lab?.a ?? null,
    bStar: lab?.b ?? null,
    colorFamily: text(values['色系'], 120),
    note2: text(values['备注2'], 500),
    note3: text(values['备注3'], 500),
    error,
  };
}

function parseExcelDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && value > 0) return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  return dateOrNull(value);
}

function inventoryData(row: InventoryRow) {
  return {
    storageLocation: row.storageLocation!,
    rollerColorCode: row.rollerColorCode,
    inboundDate: row.inboundDate,
    weightKg: row.weightKg,
    lStar: row.lStar,
    aStar: row.aStar,
    bStar: row.bStar,
    colorFamily: row.colorFamily,
    note2: row.note2,
    note3: row.note3,
  };
}

@Controller('excel')
export class ExcelImportController {
  constructor(private readonly excel: ExcelImportService) {}

  @RequirePermissions('inventory.import')
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  preview(@UploadedFile() file: UploadFile | undefined, @Req() request: AuthRequest) {
    return this.excel.preview(file, request.user!, request);
  }

  @RequirePermissions('inventory.import')
  @Post('commit')
  commit(@Body() body: { token?: unknown }, @Req() request: AuthRequest) {
    return this.excel.commit(body.token, request.user!, request);
  }
}

export const INVENTORY_EXPORT_HEADERS = [
  '库位',
  '版辊号+色序',
  '入库日期',
  '重量(kg)',
  'L',
  'a',
  'b',
  '色差',
  '色系',
  '备注2',
  '备注3',
  '状态',
];
export const OUTBOUND_EXPORT_HEADERS = [
  '出库日期',
  '出库单号',
  '库位',
  '版辊号+色序',
  '入库日期',
  '重量(kg)',
  'L',
  'a',
  'b',
  '色差',
  '色系',
  '备注2',
  '备注3',
];
export const LOG_EXPORT_HEADERS = ['操作人', '操作类型', '目标表', '目标ID', '备注', '时间'];

type ExportCell = string | number | Date | null;
type DecimalLike = { toString(): string } | number | null;

type InventoryExportSource = {
  storageLocation: string;
  rollerColorCode: string | null;
  inboundDate: Date | null;
  weightKg: DecimalLike;
  lStar: DecimalLike;
  aStar: DecimalLike;
  bStar: DecimalLike;
  colorFamily: string | null;
  note2: string | null;
  note3: string | null;
  status: string;
};
type OutboundExportSource = Omit<InventoryExportSource, 'status'> & {
  outboundDate: Date | null;
  outboundNo: string;
  deltaE: DecimalLike;
};
type LogExportSource = {
  operationTime: Date;
  username: string | null;
  operationType: string;
  targetTable: string | null;
  targetId: string | null;
  remark: string | null;
};

const decimalCell = (value: DecimalLike): number | null => (value === null ? null : Number(value));

export function inventoryExportRow(row: InventoryExportSource, deltaE: number | null = null): ExportCell[] {
  return [
    row.storageLocation,
    row.rollerColorCode,
    row.inboundDate,
    decimalCell(row.weightKg),
    decimalCell(row.lStar),
    decimalCell(row.aStar),
    decimalCell(row.bStar),
    deltaE,
    row.colorFamily,
    row.note2,
    row.note3,
    row.status,
  ];
}

export function outboundExportRow(row: OutboundExportSource): ExportCell[] {
  return [
    row.outboundDate,
    row.outboundNo,
    row.storageLocation,
    row.rollerColorCode,
    row.inboundDate,
    decimalCell(row.weightKg),
    decimalCell(row.lStar),
    decimalCell(row.aStar),
    decimalCell(row.bStar),
    decimalCell(row.deltaE),
    row.colorFamily,
    row.note2,
    row.note3,
  ];
}

export function logExportRow(row: LogExportSource): ExportCell[] {
  return [row.username, row.operationType, row.targetTable, row.targetId, row.remark, row.operationTime];
}

export async function buildSheet(headers: string[], rows: ExportCell[][]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((column, index) => {
    column.width = Math.max(12, String(headers[index] ?? '').length * 2 + 6);
    if (headers[index]?.includes('日期') || headers[index] === '时间') column.numFmt = 'yyyy-mm-dd hh:mm';
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFileName(prefix: string, now = new Date()) {
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${prefix}_${stamp}.xlsx`;
}

function sendWorkbook(response: Response, buffer: Buffer, fileName: string) {
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  response.end(buffer);
}

@Injectable()
export class ExcelExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async inventory(
    query: { keyword?: string; status?: string; targetL?: string; targetA?: string; targetB?: string },
    user: AuthUser,
  ) {
    const keyword = String(query.keyword ?? '').trim();
    const status = String(query.status ?? '').trim();
    const hasTarget = [query.targetL, query.targetA, query.targetB].every(
      (value) => value !== undefined && String(value).trim() !== '',
    );
    const target = hasTarget ? assertLabTriple(query.targetL, query.targetA, query.targetB) : null;
    const rows = await this.prisma.residualInk.findMany({
      where: {
        deletedAt: null,
        ...(status && status !== '全部' ? { status } : {}),
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
    await this.audit.write({
      user,
      operationType: 'excel.export.inventory',
      targetTable: 'residual_ink',
      afterData: { count: rows.length, keyword, status, withDeltaE: target !== null },
    });
    return buildSheet(
      INVENTORY_EXPORT_HEADERS,
      rows.map((row) =>
        inventoryExportRow(
          row,
          target && row.lStar !== null && row.aStar !== null && row.bStar !== null
            ? Number(cie76(target, { l: Number(row.lStar), a: Number(row.aStar), b: Number(row.bStar) }).toFixed(4))
            : null,
        ),
      ),
    );
  }

  async outbound(query: { keyword?: string; from?: string; to?: string }, user: AuthUser) {
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
    await this.audit.write({
      user,
      operationType: 'excel.export.outbound',
      targetTable: 'outbound_record',
      afterData: { count: rows.length, keyword },
    });
    return buildSheet(OUTBOUND_EXPORT_HEADERS, rows.map(outboundExportRow));
  }

  async logs(query: LogQuery, user: AuthUser) {
    const rows = await this.prisma.operationLog.findMany({
      where: buildLogWhere(query),
      orderBy: { operationTime: 'desc' },
      take: 5000,
    });
    await this.audit.write({
      user,
      operationType: 'excel.export.logs',
      targetTable: 'operation_log',
      afterData: { count: rows.length },
    });
    return buildSheet(LOG_EXPORT_HEADERS, rows.map(logExportRow));
  }
}

@Controller('excel/export')
export class ExcelExportController {
  constructor(private readonly excelExport: ExcelExportService) {}

  @RequirePermissions('inventory.export')
  @Get('inventory')
  async inventory(
    @Query() query: { keyword?: string; status?: string; targetL?: string; targetA?: string; targetB?: string },
    @Req() request: AuthRequest,
    @Res() response: Response,
  ) {
    sendWorkbook(response, await this.excelExport.inventory(query, request.user!), exportFileName('inventory'));
  }

  @RequirePermissions('outbound.export')
  @Get('outbound')
  async outbound(
    @Query() query: { keyword?: string; from?: string; to?: string },
    @Req() request: AuthRequest,
    @Res() response: Response,
  ) {
    sendWorkbook(response, await this.excelExport.outbound(query, request.user!), exportFileName('outbound'));
  }

  @RequirePermissions('logs.export')
  @Get('logs')
  async logs(@Query() query: LogQuery, @Req() request: AuthRequest, @Res() response: Response) {
    sendWorkbook(response, await this.excelExport.logs(query, request.user!), exportFileName('logs'));
  }
}
