import type { ThemeConfig } from 'antd';

/**
 * 单一主题真源：所有 ConfigProvider 统一引用 rimTheme。
 * RIM 常量与 styles.css 中的 --rim-* CSS 变量保持一致，改色只改这里 + styles.css :root。
 *
 * v2 采用“CMYK 多色体系”：深海蓝锚色负责骨架/主操作，印刷四色通道（C/M/Y/K）
 * 作为各业务模块的强调色（见 MODULE_COLORS），既专业统一又贴合印刷行业语境。
 */
export const rimTheme: ThemeConfig = {
  cssVar: true,
  token: {
    colorPrimary: '#2563a8',
    colorBgLayout: '#f6f8fb',
    colorText: '#1b2e2b',
    colorTextSecondary: '#5c6f68',
    colorBorder: '#e2e8ef',
    colorBorderSecondary: '#eef2f6',
    borderRadius: 6,
    fontFamily: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', system-ui, Arial, sans-serif",
  },
  components: {
    Layout: { siderBg: '#ffffff', headerBg: '#ffffff' },
    Menu: { itemSelectedBg: '#eaf1fa', itemSelectedColor: '#123964' },
    Table: { headerBg: '#eaf1fa' },
    Card: { borderRadiusLG: 12 },
  },
};

/** 与 styles.css :root 的 --rim-* 变量一一对应 */
export const RIM = {
  primary: '#2563a8',
  primaryDark: '#1a4a8a',
  primaryDeep: '#123964',
  primaryLight: '#3e7bc0',
  primaryBg: '#eaf1fa',
  primaryBorder: '#a9c4e8',
  bg: '#f6f8fb',
  text: '#1b2e2b',
  textSecondary: '#5c6f68',
  textTertiary: '#8fa39c',
  border: '#e2e8ef',
  borderStrong: '#a9c4e8',
  accent: '#d97706',
} as const;

/**
 * 各业务模块强调色（CMYK 多色体系）。
 * 侧边栏选中指示、页面标题左竖条、选中态浅底统一使用各模块强调色；
 * 骨架与主按钮仍用锚色，保证整体不花哨。
 */
export const MODULE_COLORS = {
  dashboard: '#2563a8',
  match: '#7c6ae8',
  samples: '#db2777',
  formulas: '#d97706',
  inventory: '#059669',
  outbound: '#0ba5c3',
  statistics: '#0ba5c3',
  dictionary: '#1f2937',
  users: '#0ba5c3',
  backup: '#d97706',
  logs: '#1f2937',
} as const;

/** 图表统一色板：锚蓝起手 + CMYK 通道强调色派生，禁止使用 G2 默认杂色 */
export const RIM_CHART_COLORS = [
  RIM.primary,
  '#0ba5c3',
  '#db2777',
  RIM.accent,
  '#059669',
  '#7c6ae8',
  '#3e7bc0',
  '#1f2937',
];