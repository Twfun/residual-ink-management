# 余墨管理系统 V4.0 — UI 一致性检测报告

**检测范围**：`apps/web` 前端全部源码（main.tsx、LegacyApp.tsx、components/、styles.css，共 5 个 TSX + 1 个 CSS，约 2500 行）
**检测方式**：静态代码扫描（颜色 / 字号 / 圆角 / 间距 / 内联样式量化统计）+ 人工走查 8 个页面的组件用法
**总体结论**：UI 方向正确（品牌绿 #16796d 贯穿、已有 `--rim-*` token 雏形、antd 5 主题机制在用），但**主题配置三处复制、色彩体系失控（35 个唯一色值）、间距字号无标尺、组件模式不统一**，属于"初具规范但未落地"的典型状态。

---

## 一、量化总览

| 指标                             | 现状                                                | 健康参考值       |
| -------------------------------- | --------------------------------------------------- | ---------------- |
| styles.css 唯一十六进制色值      | **35 个**                                           | ≤ 12（含语义色） |
| 其中"近亲重复"色（视觉几乎相同） | **约 20 个**                                        | 0                |
| 硬编码字号（styles.css）         | **13 种**（11~28px 散点分布）                       | 5~6 级阶梯       |
| 圆角值                           | **4 种**（4 / 6 / 8 / 14px）且与 antd token(6) 冲突 | 2 种（6 + 12）   |
| padding 写法                     | **19 种组合**，无 4px 基数约束                      | 8 档间距标尺     |
| TSX 内联 `style={{...}}`         | **35 处**（LegacyApp 27 + ServiceGate 6 + 其他 2）  | 趋近 0           |
| 表单控件宽度魔法数字             | **14 种**（76~320px）                               | 3~4 档           |
| ConfigProvider 主题定义          | **3 处复制粘贴**                                    | 1 处             |

---

## 二、关键发现（按严重度排序）

### 🔴 P0-1 主题配置三处复制，登录页与主界面"两套皮肤"

同一个 `colorPrimary: '#16796d'` 被手写了 **3 次**：

- `LegacyApp.tsx:150`（登录页分支）— 只有 colorPrimary + borderRadius
- `LegacyApp.tsx:169-179`（主界面）— 完整 token + Layout/Menu/Table 组件级覆盖
- `ServiceGate.tsx:76`（启动门）— 又是只有 colorPrimary + borderRadius

**后果**：登录页没有 `colorBgLayout: '#f3f6f7'`、没有 Menu/Table 覆盖；ServiceGate 背景手写了 `#f2f5f4`（与主界面 `#f3f6f7` 差一点点但肉眼可辨）。任何一次品牌色调整都要改 3 个地方，漏改一处立刻"掉色"。

### 🔴 P0-2 色彩体系失控：35 个色值，约 20 个是"近亲色"

文件底部已经定义了 `--rim-primary / --rim-text / --rim-border` 等 token（styles.css:462-470），但**文件上部 80% 的规则仍在硬编码**，同一个语义被写了多个几乎相同的值：

| 语义     | 实际用到的值（个数）                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 品牌绿   | `#16796d` `#12675c` `#062f2c` + 浅绿底 `#e4f3ee` `#edf2f2` `#f0faf6` `#f0f7f5` `#9ed1c0`（**8 个**）                       |
| 页面背景 | `#f3f6f7`（主界面）/ `#f2f5f4`（ServiceGate）/ `#f4f6f7`（登录页）（**3 个**）                                             |
| 主文本   | `#1d2e35` `#16323a` `#20363c`（**3 个**）                                                                                  |
| 次级文本 | `#74868b` `#698087` `#7d8d92` `#6a7f86` `#9aa8ab` `#9fb0b3`（**6 个**）                                                    |
| 边框灰   | `#dce5e6` `#e0e7e8` `#dfe7e8` `#e3e9ea` `#e2e8e7` `#e3e8e7` `#ced9db` `#b7c6c8` `#b7c5c8` `#edf1f2` `#eef2f2`（**11 个**） |

另有指标卡样式双轨冲突：`.metric-grid .ant-statistic-content`（28px / `#20363c`）与 `.metric-card .ant-statistic-content`（`--rim-primary-dark`）同时命中同一个组件，靠声明顺序"打架"决定最终颜色——`#20363c` 实际是死样式。

### 🟠 P1-1 图表配色双轨，与品牌脱节

- `LegacyApp.tsx:338-339` 自定义 `INBOUND_COLOR #16796d` / `OUTBOUND_COLOR #fa8c16`
- `EChart.tsx:11` 又内置了一套 8 色默认盘：`#5b8ff9` `#945fb9` `#e8684a` `#6dc8ec` `#9270ca` `#8a9a5b`——这是 G2 默认风格的杂色，饼图（色系分布）直接吃到这套默认盘，与全站墨绿风格明显不搭

### 🟠 P1-2 间距 / 字号 / 圆角全部无标尺

- **间距**：19 种 padding 组合（`9px 0`、`10px 12px`、`14px 16px`、`22px 28px`、`18px 20px`、`40px 38px 34px`…），未遵守 4px 基数；页面级 `<Space size>` 混用 12（库存页）与 16（其余 7 页）
- **字号**：11 / 12 / 13 / 14 / 16 / 17 / 18 / 19 / 20 / 21 / 25 / 26 / 28px 共 13 档散点；顶栏用 `Typography.Title level={1}` 却被 CSS 压到 21px——语义（H1）与视觉（21px）错位，且 H1 标题层级与登录页 H2(26px) 倒挂
- **圆角**：antd token 设了 6px，但 `.ant-card` 被全局 CSS 覆盖成 8px，菜单项 4px、登录卡 14px、测量弹窗内 6px——同一个 App 四种圆角语言

### 🟠 P1-3 组件模式不统一

- **空状态两种画法**：表格用 `<EmptyState>`（图标 + 文案），图表用 `.chart-empty`（纯文本"暂无数据"），视觉轻重不一致
- **弹窗底部按钮三种模式**：MeasureModal 用自定义 `.measure-actions` div；InventoryModal 只有"保存"没有"取消"且非 block；QuickOutboundModal 是 block 大按钮
- **按钮层级**：库存页工具栏"筛选"（primary）与"新增库存"（primary）并排——同一视觉层两个主按钮
- **表格两套皮肤**：库存页用 `.excel-style-table`（加粗表头 + 固定列描边），其余页面 SimpleTable 无此样式，同为数据表格观感不同
- **表单宽度 14 种魔法数字**：Select 126 / 130 / 104 / 100 / 110 / 92 / 320，InputNumber 84 / 90 / 80，操作列 168 / 76——毫无规律

### 🟡 P2-1 死代码与技术债

- `main.tsx:8-100` 有 **93 行注释掉的旧版 UI**（`.shell` `.brand` `.toolbar` `.modal` 等 class），对应样式早已从 styles.css 删除——纯干扰，且误导后来者以为这些 class 可用
- `.stats-total-row`（`#f0f7f5 !important`）、`.import-preview`（`#f0faf6`）等特殊区块硬编码 + `!important`，无法被主题切换接管
- `Login` 页有"忘记密码？"链接（LegacyApp.tsx:292）无任何点击行为——无效交互

---

## 三、修复建议

### Step 1（P0，半天）：建立单一主题入口

新建 `apps/web/src/theme.ts`，导出一份完整 theme 配置；`LegacyApp` 两个分支与 `ServiceGate` 全部改为引用它：

```ts
// theme.ts —— 唯一的主题真源
import type { ThemeConfig } from 'antd';

export const rimTheme: ThemeConfig = {
  token: {
    colorPrimary: '#16796d',
    colorBgLayout: '#f3f6f7',
    borderRadius: 6,
    colorText: '#1d2e35',
    colorTextSecondary: '#698087',
    colorBorder: '#dce5e6',
    colorBorderSecondary: '#e8eef0',
    fontFamily: "'Microsoft YaHei', Arial, sans-serif",
  },
  components: {
    Layout: { siderBg: '#ffffff', headerBg: '#ffffff' },
    Menu: { itemSelectedBg: '#e4f3ee', itemSelectedColor: '#12675c' },
    Table: { headerBg: '#edf2f2' },
    Card: { borderRadiusLG: 8 }, // 卡片统一 8px，与 CSS 对齐
  },
};
```

同时删除 `.ant-card` 全局圆角覆盖（交给 token），把 ServiceGate 内联样式挪进 styles.css 并复用 token。

### Step 2（P0，1 天）：收敛调色板

把 35 个色值收敛到 12 个，全部走 CSS 变量（现有的 `--rim-*` 扩充），近亲色按下表合并：

| 保留 token                      | 合并掉的值                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `--rim-primary: #16796d`        | `#12675c`（hover 用 darken 派生）                                                               |
| `--rim-primary-dark: #062f2c`   | `#16323a` `#20363c`                                                                             |
| `--rim-bg: #f3f6f7`             | `#f2f5f4` `#f4f6f7`                                                                             |
| `--rim-text: #1d2e35`           | —                                                                                               |
| `--rim-text-secondary: #698087` | `#74868b` `#7d8d92` `#6a7f86`                                                                   |
| `--rim-text-tertiary: #9aa8ab`  | `#9fb0b3`                                                                                       |
| `--rim-border: #dce5e6`         | `#e0e7e8` `#dfe7e8` `#e3e9ea` `#e2e8e7` `#e3e8e7`                                               |
| `--rim-border-strong: #b7c6c8`  | `#ced9db` `#b7c5c8`                                                                             |
| `--rim-primary-bg: #e4f3ee`     | `#edf2f2` `#f0faf6` `#f0f7f5` `#edf1f2` `#eef2f2`                                               |
| `--rim-primary-border: #9ed1c0` | —                                                                                               |
| error/warning 色系              | `#cf1322` `#ffccc7` `#fff2f0` `#7a4a45` → 改用 antd token（`colorError` 系列），删除 CSS 硬编码 |

指标卡冲突：删掉 `.metric-grid .ant-statistic-content` 的颜色声明，统一由 `.metric-card` 管。

### Step 3（P1，1 天）：图表色板收编

把 `EChart.tsx` 的默认盘换成品牌派生序列，并复用 INBOUND/OUTBOUND 常量：

```ts
export const RIM_CHART_COLORS = [
  '#16796d',
  '#fa8c16',
  '#3f8f84',
  '#e0a458',
  '#6aa79e',
  '#c97b4a',
  '#94bdb3',
  '#8a9a5b',
]; // 主色 + 强调橙 + 它们的明暗派生，删掉 G2 杂色
```

### Step 4（P1，1~2 天）：标尺化 + 组件规范化

1. **间距**：页面级 Space 统一 `size={16}`；CSS 只保留 `4/8/12/16/20/24/32/48` 八档
2. **字号**：收敛到 `12 / 13 / 14 / 16 / 20 / 24` 六档；顶栏改 `Typography.Title level={3}`（语义与 20~21px 视觉匹配），删掉强制覆盖
3. **圆角**：全站只保留 6px（基础）与 8px（卡片/登录卡），登录卡 14px → 8px
4. **表单宽度**：定 3 档——紧凑 96 / 标准 160 / 宽松 320，替换全部魔法数字
5. **空状态**：图表的 `.chart-empty` 直接复用 `<EmptyState>` 组件
6. **弹窗规范**：所有 Modal 统一 `footer` 模式（或统一 footer=null + 内部按钮区），"取消 + 主操作"成对出现；主按钮每屏 ≤1 个（"新增库存"降级为 default 或挪出筛选区）
7. **表格**：决定保留 `.excel-style-table` 还是 SimpleTable 默认样式，二选一全站统一（建议保留 excel 风格仅用于库存这类"仿 Excel"场景，其余默认）

### Step 5（P2，半天）：清债

- 删除 `main.tsx` 中 93 行注释掉的旧 UI
- 移除无效的"忘记密码？"链接或补上交互
- 消除 `!important`（`.stats-total-row`、菜单项那几处），改用提高选择器优先级或 token
- 35 处内联 style 收敛到 ≤5 处（仅保留动态计算值，如色卡的 `labToCss` 背景）

---

## 四、优先级路线图

| 阶段            | 内容                                         | 预计工作量 | 收益                       |
| --------------- | -------------------------------------------- | ---------- | -------------------------- |
| 🚀 快赢（本周） | Step 1 + Step 5 死代码清理                   | 1 天       | 主题单源化，改色不再漏     |
| 第一阶段        | Step 2 调色板收敛                            | 1 天       | 视觉统一度提升约 70%       |
| 第二阶段        | Step 3 + Step 4                              | 2~3 天     | 组件级一致，建立可复用规范 |
| 持续            | 新增 UI 走 token，code review 检查硬编码 hex | —          | 防止回潮                   |

**验收指标**：styles.css 唯一 hex ≤ 12；内联 style ≤ 5；ConfigProvider 仅 1 处主题定义；页面 Space size 全部 16。

---

_检测人：UI Designer（像素君） · 2026-08-06 · 基于 apps/web @ 当前工作区源码_
