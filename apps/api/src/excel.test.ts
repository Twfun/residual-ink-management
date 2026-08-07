import { describe, expect, it } from 'vitest';
import {
  buildSheet,
  exportFileName,
  INVENTORY_EXPORT_HEADERS,
  inventoryExportRow,
  LOG_EXPORT_HEADERS,
  logExportRow,
  OUTBOUND_EXPORT_HEADERS,
  outboundExportRow,
} from './excel';

describe('excel export contract', () => {
  it('keeps export headers aligned with the business columns', () => {
    expect(INVENTORY_EXPORT_HEADERS).toEqual([
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
    ]);
    expect(OUTBOUND_EXPORT_HEADERS).toEqual([
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
    ]);
    expect(LOG_EXPORT_HEADERS).toEqual(['操作人', '操作类型', '目标表', '目标ID', '备注', '时间']);
  });

  it('keeps unknown weight as an empty cell instead of zero', () => {
    const row = inventoryExportRow({
      storageLocation: 'A-01',
      rollerColorCode: null,
      inboundDate: null,
      weightKg: null,
      lStar: 50.5,
      aStar: 1.25,
      bStar: -2.5,
      colorFamily: '蓝',
      note2: null,
      note3: null,
      status: '在库',
    });
    expect(row).toHaveLength(INVENTORY_EXPORT_HEADERS.length);
    expect(row[0]).toBe('A-01');
    expect(row[3]).toBeNull();
    expect(row[4]).toBe(50.5);
    expect(row[7]).toBeNull();
    const withDelta = inventoryExportRow(
      {
        storageLocation: 'A-01',
        rollerColorCode: null,
        inboundDate: null,
        weightKg: 1,
        lStar: 50,
        aStar: 0,
        bStar: 0,
        colorFamily: null,
        note2: null,
        note3: null,
        status: '在库',
      },
      1.25,
    );
    expect(withDelta[7]).toBe(1.25);
  });

  it('prefixes outbound rows with date and order number', () => {
    const date = new Date('2026-08-01T00:00:00');
    const row = outboundExportRow({
      outboundDate: date,
      outboundNo: 'CK20260801120000',
      storageLocation: 'B-02',
      rollerColorCode: 'R1',
      inboundDate: null,
      weightKg: 3.5,
      lStar: null,
      aStar: null,
      bStar: null,
      deltaE: 1.2345,
      colorFamily: null,
      note2: null,
      note3: null,
    });
    expect(row).toHaveLength(OUTBOUND_EXPORT_HEADERS.length);
    expect(row[0]).toBe(date);
    expect(row[1]).toBe('CK20260801120000');
    expect(row[5]).toBe(3.5);
    expect(row[9]).toBe(1.2345);
  });

  it('maps log rows to the six export columns', () => {
    const time = new Date('2026-08-06T10:00:00');
    const row = logExportRow({
      operationTime: time,
      username: 'admin',
      operationType: 'auth.login',
      targetTable: null,
      targetId: null,
      remark: null,
    });
    expect(row).toEqual(['admin', 'auth.login', null, null, null, time]);
  });

  it('builds doc-style export file names', () => {
    const name = exportFileName('inventory', new Date('2026-08-06T17:20:30'));
    expect(name).toBe('inventory_20260806_172030.xlsx');
  });

  it('builds a valid xlsx buffer', async () => {
    const buffer = await buildSheet(INVENTORY_EXPORT_HEADERS, [
      ['A-01', null, null, null, null, null, null, null, null, null, '在库'],
    ]);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
