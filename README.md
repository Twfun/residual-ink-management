# 余墨管理系统（Residual Ink Management）

一套面向印刷/油墨调色场景的**余墨库存管理系统**，独立简易版。包含 React Web 前端、NestJS API 后端、Prisma ORM、内置 MariaDB 数据库，以及 Tauri 打包的 Windows x64 桌面安装包，支持 X-Rite eXact 分光测色仪联机测量。

本项目与旧系统并行运行：旧项目代码和数据库不会被扫描、迁移或覆盖。

## 功能特性

- **余墨库存管理**：余墨建档、查询、编辑，支持 Lab 色度值与配方信息管理
- **出入库管理**：出库登记、出库记录追溯，库存联动扣减
- **测色仪联机**：内置 X-Rite 桥接程序与 `eXact.dll`，可直接连接 eXact 分光测色仪测量 Lab 值
- **智能配色/寻墨**：基于 Lab 色差（ΔE）在库存与 Pantone 色库中检索匹配
- **Pantone 色库**：内置 Pantone 标准色库查询
- **数据统计看板**：库存、出入库等指标的图表化统计
- **Excel 数据导入**：支持从旧版 Excel 工作簿导入库存表、出库表
- **用户与权限**：角色-权限模型，登录审计，操作日志，登录失败锁定
- **数据备份**：内置备份任务与恢复能力
- **桌面一体化安装**：单 exe 安装包，内置 API 服务与 MariaDB，无需单独部署数据库

## 安装使用（普通用户）

1. 前往 [Releases](https://github.com/Twfun/residual-ink-management/releases) 页面，下载最新版安装包 `余墨管理系统_x.x.x_x64-setup.exe`。
2. 双击运行安装程序，按向导完成安装（仅支持 Windows x64）。
3. 首次启动后使用默认账号登录：
   - 用户名：`admin`
   - 密码：`admin123`
   - **首次登录后必须修改密码。**

运行数据存放位置：`%LOCALAPPDATA%\ResidualInkManagementRuntime\data`

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React + TypeScript + Vite，ECharts |
| 后端 | NestJS + TypeScript |
| ORM | Prisma |
| 数据库 | MariaDB（安装包内置，端口 `39306`） |
| 桌面壳 | Tauri 2（Rust），NSIS 安装包 |
| 测色仪 | X-Rite eXact SDK（`eXact.dll` + 桥接程序） |

## 目录结构

```
apps/
  api/                NestJS 后端（认证、库存、出库、测色、统计、审计、备份等模块）
  web/                React 前端（主界面、测色弹窗、Pantone 色库等组件）
  desktop/src-tauri/  Tauri 桌面端（Rust 壳、打包配置、安装资源）
prisma/               数据库 schema 与种子脚本
scripts/              构建、校验、冒烟测试脚本
```

## 开发环境搭建

前置要求：

- Node.js >= 20
- Rust 工具链（桌面端开发需要）
- Windows x64

```powershell
# 1. 安装依赖
npm.cmd install

# 2. 生成 Prisma 客户端
npm.cmd run prisma:generate

# 3. 启动 Web + API 开发服务器
npm.cmd run dev

# 4. 桌面端开发 / 构建安装包
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

构建产物安装包位于：

```
apps/desktop/src-tauri/target/release/bundle/nsis/ResidualInkManagement_<version>_x64-setup.exe
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DATABASE_URL` | MariaDB 连接串 | `mysql://root:@127.0.0.1:39306/residual_ink_management` |
| `JWT_SECRET` | JWT 签名密钥（生产环境务必更换，至少 32 位随机字符） | 无 |
| `API_HOST` / `API_PORT` | API 监听地址与端口 | `127.0.0.1` / `39080` |
| `APP_DATA_DIR` | 运行数据目录（留空使用默认） | `%LOCALAPPDATA%\ResidualInkManagementRuntime\data` |
| `BACKUP_DIR` | 备份目录（留空使用默认） | 运行数据目录下 |

## 验收与测试

```powershell
npm.cmd run typecheck          # 前后端类型检查
npm.cmd run test               # 前后端单元测试
npm.cmd run excel:verify       # 旧版 Excel 工作簿只读校验
npm.cmd run xrite:verify       # X-Rite 测色仪桥接校验
npm.cmd run standalone:smoke   # 独立运行冒烟测试
```

说明：`excel:verify` 只读取旧工作簿的 `库存表` 和 `出库表`，不会执行宏，也不会把业务文件打入安装包。

## 端口约定

| 服务 | 端口 |
| --- | --- |
| API | `39080` |
| MariaDB | `39306` |

## 常见问题

- **测色仪无法连接**：确认 eXact 已通过 USB 连接并开机；桥接程序优先加载安装目录内的资源，不依赖 DataCatcher 安装路径。
- **忘记管理员密码**：删除运行数据目录中的数据库文件后重新初始化（会清空业务数据），或联系维护人员处理。
- **与旧系统共存**：本系统使用独立端口、独立数据目录，不会影响旧系统。