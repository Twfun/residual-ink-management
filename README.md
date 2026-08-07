# 余墨管理系统独立简易版

本目录是与旧系统并行运行的独立项目，包含 React Web、NestJS API、Prisma、内置 MariaDB 和 Tauri Windows x64 桌面端。旧项目代码和数据库不会被扫描、迁移或覆盖。

## 开发

```powershell
npm.cmd install
npm.cmd run dev
```

桌面端开发和构建：

```powershell
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

最终安装包位于 `apps/desktop/src-tauri/target/release/bundle/nsis/ResidualInkManagement_1.0.0_x64-setup.exe`。

## 验收

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run excel:verify
npm.cmd run xrite:verify
npm.cmd run standalone:smoke
```

`excel:verify` 使用 `C:\Users\qwq12\Desktop\紫金旧墨管理库.xlsm`，只读取 `库存表` 和 `出库表`，不会执行宏，也不会把业务文件打入安装包。

默认账号为 `admin / admin123`。首次登录必须修改密码。应用运行数据存放在 `%LOCALAPPDATA%\ResidualInkManagementRuntime\data`，API 端口为 `39080`，MariaDB 端口为 `39306`。

X-Rite 桥接程序和 `eXact.dll` 已内置在安装资源中，桥接程序优先加载安装目录资源，不依赖 DataCatcher 安装路径。
