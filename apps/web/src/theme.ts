import type { ThemeConfig } from 'antd';

/**
 * 单一主题真源：所有 ConfigProvider 统一引用 rimTheme。
 * RIM 常量与 styles.css 中的 --rim-* CSS 变量保持一致，改色只改这里 + styles.css :root。
 */
export const rimTheme: ThemeConfig = {
  cssVar: true,
  token: {
    colorPrimary: '#16796d',
    colorBgLayout: '#f3f6f7',
    colorText: '#1d2e35',
    colorTextSecondary: '#698087',
    colorBorder: '#c6cecf',
    colorBorderSecondary: '#e8eef0',
    borderRadius: 6,
    fontFamily: "'Microsoft YaHei', Arial, sans-serif",
  },
  components: {
    Layout: { siderBg: '#ffffff', headerBg: '#ffffff' },
    Menu: { itemSelectedBg: '#e4f3ee', itemSelectedColor: '#12675c' },
    Table: { headerBg: '#edf2f2' },
    Card: { borderRadiusLG: 8 },
  },
};

/** 与 styles.css :root 的 --rim-* 变量一一对应 */
export const RIM = {
  primary: '#16796d',
  primaryDark: '#062f2c',
  primaryBg: '#e4f3ee',
  primaryBorder: '#9ed1c0',
  bg: '#f3f6f7',
  text: '#1d2e35',
  textSecondary: '#698087',
  textTertiary: '#9aa8ab',
  border: '#c6cecf',
  borderStrong: '#b7c6c8',
  accent: '#fa8c16',
} as const;

/** 图表统一色板：品牌绿 + 强调橙 + 明暗派生，禁止使用 G2 默认杂色 */
export const RIM_CHART_COLORS = [
  RIM.primary,
  RIM.accent,
  '#3f8f84',
  '#e0a458',
  '#6aa79e',
  '#c97b4a',
  '#94bdb3',
  '#8a9a5b',
];
