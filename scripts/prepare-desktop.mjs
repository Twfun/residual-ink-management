import { createHash } from 'node:crypto';
import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
// tar 可执行文件：优先系统自带（Node spawn 在多终端环境下可能找不到 PATH 中的 tar）
const tarCandidates = ['C:/Windows/System32/tar.exe', 'C:/Windows/System32/bsdtar.exe', 'tar'];
const tar = tarCandidates.find((candidate) => existsSync(candidate) || !candidate.includes('/')) ?? 'tar';
const resourceDir = resolve(root, 'apps/desktop/src-tauri/resources/xrite');
const databaseDir = resolve(root, 'apps/desktop/src-tauri/resources/database');
const mariaSource = resolve(root, '../apps/desktop/src-tauri/resources/database/mariadb');
const mariaTarget = resolve(databaseDir, 'mariadb');
const iconLocal = resolve(root, 'apps/desktop/src-tauri/icons/icon.ico');
const iconSource = resolve(root, '../apps/desktop/src-tauri/icons/icon.ico');
const bridgeZip = 'C:/Users/qwq12/Documents/Codex/2026-08-05/x-rite-datacatcher/outputs/xrite-exact-bridge.zip';
const bridgeSource = resolve(root, '../apps/desktop/src-tauri/resources/xrite/exact-bridge.exe');
const vendorDll = resolve(root, '../docs/X-Rite/Color_iControl/eXact.dll');
const expected = {
  'exact-bridge.exe': '3ff96cc24fc0083216d6cf32381d0742fa945c918f0e912b54b248b4e6512ec5',
  'eXact.dll': '46ff08e97a4d9c6fdd98f07e824b03f44e8581961c3e137e746233efb2a86435',
};
const bridge = resolve(resourceDir, 'exact-bridge.exe');
const dll = resolve(resourceDir, 'eXact.dll');

await mkdir(resourceDir, { recursive: true });
await mkdir(resolve(root, 'apps/desktop/src-tauri/icons'), { recursive: true });
// 图标同步：仓库内 icon.ico 为权威（已由 `tauri icon` 生成）。仅当缺失时才从仓库外源回填，
// 避免每次构建用仓库外旧图标覆盖新图标。
if (!(await exists(iconLocal))) {
  await copyFile(iconSource, iconLocal);
}
await rm(bridge, { force: true });
if (await exists(bridgeSource)) {
  await copyFile(bridgeSource, bridge);
} else {
  execFileSync(
    tar,
    ['-xf', bridgeZip, '-C', resourceDir, '--strip-components=1', 'xrite-exact-bridge/exact-bridge.exe'],
    { stdio: 'inherit' },
  );
}
await copyFile(vendorDll, dll);
for (const file of [bridge, dll]) {
  const digest = createHash('sha256')
    .update(await (await import('node:fs/promises')).readFile(file))
    .digest('hex');
  const name = file.endsWith('.dll') ? 'eXact.dll' : 'exact-bridge.exe';
  if (digest !== expected[name]) throw new Error(`${name} SHA256 mismatch: ${digest}`);
}
await mkdir(databaseDir, { recursive: true });
if (!(await exists(resolve(mariaTarget, 'bin/mysqld.exe')))) {
  await cp(mariaSource, mariaTarget, { recursive: true, force: false });
}
const prismaCli = resolve(root, 'node_modules/prisma/build/index.js');
const schema = execFileSync(
  process.execPath,
  [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  { cwd: root, encoding: 'utf8' },
);
const idempotentSchema = schema
  .replaceAll('CREATE TABLE `', 'CREATE TABLE IF NOT EXISTS `')
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('ALTER TABLE `'))
  .join('\n');
// Idempotent migrations for existing installations (fresh CREATE TABLEs already include these columns).
const manualMigrations = [
  'ALTER TABLE `color_measurement` ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME(3) NULL;',
  'ALTER TABLE `residual_ink` ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME(3) NULL;',
  'ALTER TABLE `residual_ink` ADD COLUMN IF NOT EXISTS `formula_id` BIGINT NULL;',
  'ALTER TABLE `residual_ink` ADD COLUMN IF NOT EXISTS `product_id` BIGINT NULL;',
].join('\n');
await writeFile(
  resolve(databaseDir, 'schema.sql'),
  `CREATE DATABASE IF NOT EXISTS residual_ink_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE residual_ink_management;\n${idempotentSchema}\n${manualMigrations}\n`,
  'utf8',
);
console.log(`Prepared X-Rite resources in ${resourceDir}`);
console.log(`Prepared embedded MariaDB and schema in ${databaseDir}`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
