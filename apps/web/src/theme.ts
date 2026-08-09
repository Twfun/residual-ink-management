import type { ThemeConfig } from 'antd';

/**
 * 单一主题真源：所有 ConfigProvider 统一引用 rimTheme。
 * RIM 常量与 styles.css 中的 --rim-* CSS 变量保持一致，改色只改这里 + styles.css :root。
 */
export const rimTheme: ThemeConfig = {
  cssVar: true,
  token: {
    colorPrimary: '#4caf7d',
    colorBgLayout: '#f6faf8',
    colorText: '#1f2e2a',
    colorTextSecondary: '#5c6f68',
    colorBorder: '#dce8e2',
    colorBorderSecondary: '#eef4f1',
    borderRadius: 6,
    fontFamily: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', system-ui, Arial, sans-serif",
  },
  components: {
    Layout: { siderBg: '#ffffff', headerBg: '#ffffff' },
    Menu: { itemSelectedBg: '#eaf6f0', itemSelectedColor: '#2e7d5b' },
    Table: { headerBg: '#f3faf6' },
    Card: { borderRadiusLG: 12 },
  },
};

/** 与 styles.css :root 的 --rim-* 变量一一对应 */
export const RIM = {
  primary: '#4caf7d',
  primaryDark: '#2e7d5b',
  primaryDeep: '#235f47',
  primaryLight: '#7cc9a2',
  primaryBg: '#eaf6f0',
  primaryBorder: '#c4e8d6',
  bg: '#f6faf8',
  text: '#1f2e2a',
  textSecondary: '#5c6f68',
  textTertiary: '#94a69f',
  border: '#dce8e2',
  borderStrong: '#c4e8d6',
  accent: '#f5a623',
} as const;

/** 图表统一色板：主绿 + 强调琥珀 + 明暗派生，禁止使用 G2 默认杂色 */
export const RIM_CHART_COLORS = [
  RIM.primary,
  RIM.accent,
  RIM.primaryLight,
  '#e2b45c',
  '#9fd4bd',
  '#c98a4a',
  '#b8e0cc',
  '#a8b45b',
];
