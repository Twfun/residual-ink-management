export const PAGE_CONTRACT = [
  ['dashboard', '智能工作台', 'dashboard.view'],
  ['match', '颜色匹配', 'match.view'],
  ['formulas', '配方档案', 'formula.view'],
  ['inventory', '余墨库存', 'inventory.view'],
  ['outbound', '余墨出库', 'outbound.view'],
  ['statistics', '出入库统计', 'dashboard.view'],
  ['users', '用户权限', 'users.manage'],
  ['backup', '备份恢复', 'backup.manage'],
  ['logs', '操作日志', 'logs.view'],
] as const;

export const INVENTORY_COLUMNS = [
  ['storageLocation', '库位'],
  ['rollerColorCode', '版辊号+色序'],
  ['inboundDate', '入库日期'],
  ['weightKg', '重量'],
  ['lStar', 'L'],
  ['aStar', 'a'],
  ['bStar', 'b'],
  ['deltaE', '色差'],
  ['colorFamily', '色系'],
  ['note2', '备注2'],
  ['note3', '备注3'],
] as const;

export const DASHBOARD_DIMENSIONS = [
  ['day', '日'],
  ['week', '周'],
  ['month', '月'],
  ['year', '年'],
] as const;

export const DASHBOARD_PERIODS = [
  ['all', '全部'],
  ['day', '今日'],
  ['week', '本周'],
  ['month', '本月'],
  ['year', '本年'],
] as const;

export const WEIGHT_RANGES = ['0-1', '1-5', '5-10', '10-50', '50+'] as const;

export const MATCH_FORMULA_OPTIONS = ['CIE76', 'CIE94', 'CIEDE2000'] as const;

export const COLOR_FAMILY_OPTIONS = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '黑', '白', '灰', '棕'] as const;
