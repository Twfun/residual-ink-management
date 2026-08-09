import { describe, expect, it } from 'vitest';
import {
  COLOR_FAMILY_OPTIONS,
  DASHBOARD_DIMENSIONS,
  DASHBOARD_PERIODS,
  INVENTORY_COLUMNS,
  MATCH_FORMULA_OPTIONS,
  PAGE_CONTRACT,
  WEIGHT_RANGES,
} from './contracts';

describe('simplified desktop UI contract', () => {
  it('contains the authorized pages', () => {
    expect(PAGE_CONTRACT.map(([, label]) => label)).toEqual([
      '智能工作台',
      '颜色匹配',
      '样品档案',
      '配方档案',
      '余墨库存',
      '余墨出库',
      '出入库统计',
      '数据字典',
      '用户权限',
      '备份恢复',
      '操作日志',
    ]);
  });

  it('defines dashboard dimension and period constants', () => {
    expect(DASHBOARD_DIMENSIONS.map(([value]) => value)).toEqual(['day', 'week', 'month', 'year']);
    expect(DASHBOARD_DIMENSIONS.map(([, label]) => label)).toEqual(['日', '周', '月', '年']);
    expect(DASHBOARD_PERIODS.map(([, label]) => label)).toEqual(['全部', '今日', '本周', '本月', '本年']);
    expect([...WEIGHT_RANGES]).toEqual(['0-1', '1-5', '5-10', '10-50', '50+']);
    expect([...MATCH_FORMULA_OPTIONS]).toEqual(['CIE76', 'CIE94', 'CIEDE2000']);
    expect(COLOR_FAMILY_OPTIONS).toContain('蓝');
    expect(COLOR_FAMILY_OPTIONS.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps the Excel inventory business headers in the required order', () => {
    expect(INVENTORY_COLUMNS.map(([, label]) => label)).toEqual([
      '库位',
      '版辊号+色序',
      '入库日期',
      '重量',
      'L',
      'a',
      'b',
      '色差',
      '色系',
      '备注2',
      '备注3',
    ]);
  });
});
