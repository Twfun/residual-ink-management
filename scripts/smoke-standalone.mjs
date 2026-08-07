import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const maria = resolve(root, 'apps/desktop/src-tauri/resources/database/mariadb');
const schemaPath = resolve(root, 'apps/desktop/src-tauri/resources/database/schema.sql');
const api = resolve(root, 'apps/desktop/src-tauri/binaries/residual-ink-api-x86_64-pc-windows-msvc.exe');
const reportPath = resolve(root, '.standalone-smoke-report.json');
const runtime = await mkdtemp(join(tmpdir(), 'rim-smoke-'));
const data = resolve(runtime, 'database/data');
const ini = resolve(runtime, 'database/my.ini');
const dbPort = 39316;
const apiPort = 39081;
let databaseProcess;
let apiProcess;
let apiOutput = '';

try {
  await mkdir(data, { recursive: true });
  await run(resolve(maria, 'bin/mariadb-install-db.exe'), [`--datadir=${data}`, '--password=', `--port=${dbPort}`]);
  await writeFile(
    ini,
    `[mysqld]\nbasedir=${iniPath(maria)}\ndatadir=${iniPath(data)}\nport=${dbPort}\nbind-address=127.0.0.1\ncharacter-set-server=utf8mb4\ncollation-server=utf8mb4_unicode_ci\ninnodb_buffer_pool_size=64M\nperformance_schema=OFF\nskip-name-resolve\nlog-error=${iniPath(resolve(runtime, 'mariadb.log'))}\n`,
    'utf8',
  );
  databaseProcess = spawn(resolve(maria, 'bin/mysqld.exe'), [`--defaults-file=${ini}`], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await waitForPort(dbPort, 60_000);
  await run(
    resolve(maria, 'bin/mariadb.exe'),
    ['--protocol=tcp', '--ssl=0', '--host=127.0.0.1', `--port=${dbPort}`, '--user=root'],
    await readFile(schemaPath),
  );
  apiProcess = spawn(api, [], {
    windowsHide: true,
    env: {
      ...process.env,
      RIM_API_PORT: String(apiPort),
      RIM_BACKUP_DIR: resolve(runtime, 'backups'),
      JWT_SECRET: 'standalone-smoke-secret-with-at-least-32-characters',
      DATABASE_URL: `mysql://root@127.0.0.1:${dbPort}/residual_ink_management?connection_limit=4`,
      PKG_CACHE_PATH: resolve(runtime, 'pkg-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (chunk) => {
    apiOutput += chunk;
  });
  apiProcess.stderr.on('data', (chunk) => {
    apiOutput += chunk;
  });
  try {
    await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, 90_000);
  } catch (error) {
    throw new Error(`${error}\n${apiOutput}`);
  }
  const login = await fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const payload = await login.json();
  if (!login.ok || !payload.token || payload.user?.mustChangePassword !== true)
    throw new Error(`Login smoke failed: ${JSON.stringify(payload)}`);
  const report = { ok: true, health: true, login: true, mustChangePassword: true, databasePort: dbPort, apiPort };
  if (process.env.RIM_IMPORT_SMOKE === '1') {
    const workbookPath = 'C:/Users/qwq12/Desktop/紫金旧墨管理库.xlsm';
    const form = new FormData();
    form.append('file', new Blob([await readFile(workbookPath)]), '紫金旧墨管理库.xlsm');
    const headers = { Authorization: `Bearer ${payload.token}` };
    const previewResponse = await fetch(`http://127.0.0.1:${apiPort}/api/excel/preview`, {
      method: 'POST',
      headers,
      body: form,
    });
    const preview = await previewResponse.json();
    if (!previewResponse.ok) throw new Error(`Import preview failed: ${JSON.stringify(preview)}`);
    if (preview.inventory.willImport !== 3371 || preview.outbound.willImport !== 1370) {
      throw new Error(`Unexpected import preview: ${JSON.stringify(preview)}`);
    }
    const commitResponse = await fetch(`http://127.0.0.1:${apiPort}/api/excel/commit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: preview.token }),
    });
    const commit = await commitResponse.json();
    if (!commitResponse.ok || commit.imported !== 4741 || commit.errors !== 0) {
      throw new Error(`Import commit failed: ${JSON.stringify(commit)}`);
    }
    const inventory = await fetch(`http://127.0.0.1:${apiPort}/api/inventory`, { headers }).then((response) =>
      response.json(),
    );
    const outbound = await fetch(`http://127.0.0.1:${apiPort}/api/outbound`, { headers }).then((response) =>
      response.json(),
    );
    if (inventory.rows?.length !== 3371 || outbound.rows?.length !== 1370) {
      throw new Error(
        `Imported rows are not visible: ${JSON.stringify({ inventory: inventory.rows?.length, outbound: outbound.rows?.length })}`,
      );
    }
    const repeatForm = new FormData();
    repeatForm.append('file', new Blob([await readFile(workbookPath)]), '紫金旧墨管理库.xlsm');
    const repeatPreview = await fetch(`http://127.0.0.1:${apiPort}/api/excel/preview`, {
      method: 'POST',
      headers,
      body: repeatForm,
    }).then((response) => response.json());
    const repeatCommit = await fetch(`http://127.0.0.1:${apiPort}/api/excel/commit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: repeatPreview.token }),
    }).then((response) => response.json());
    if (repeatCommit.imported !== 0 || repeatCommit.skipped !== 4779) {
      throw new Error(`Duplicate import was not fully skipped: ${JSON.stringify(repeatCommit)}`);
    }
    report.import = {
      previewed: 4741,
      imported: commit.imported,
      inventoryVisible: inventory.rows.length,
      outboundVisible: outbound.rows.length,
      duplicateSkipped: repeatCommit.skipped,
    };
    const monthSeries = await fetch(`http://127.0.0.1:${apiPort}/api/dashboard/series?dimension=month`, {
      headers,
    }).then((response) => response.json());
    const totals = (monthSeries.buckets ?? []).reduce(
      (acc, bucket) => ({ inbound: acc.inbound + bucket.inbound, outbound: acc.outbound + bucket.outbound }),
      { inbound: 0, outbound: 0 },
    );
    if (totals.inbound !== 3371 || totals.outbound !== 1370) {
      throw new Error(`Unexpected dashboard series totals: ${JSON.stringify({ totals })}`);
    }
    const rangeSeries = await fetch(
      `http://127.0.0.1:${apiPort}/api/dashboard/series?dimension=day&from=2020-01-01&to=2020-12-31`,
      { headers },
    ).then((response) => response.json());
    if (!Array.isArray(rangeSeries.buckets) || rangeSeries.buckets.length !== 366) {
      throw new Error(`Unexpected range series buckets: ${JSON.stringify({ length: rangeSeries.buckets?.length })}`);
    }
    const periodOverview = await fetch(`http://127.0.0.1:${apiPort}/api/dashboard?period=year`, { headers }).then(
      (response) => response.json(),
    );
    if (!Array.isArray(periodOverview.recentInventory) || !Array.isArray(periodOverview.recentOutbound)) {
      throw new Error('Dashboard period overview did not return recent lists.');
    }
    report.dashboard = { monthTotals: totals, rangeBucketCount: rangeSeries.buckets.length };
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ ok: false, error: String(error), apiOutput }, null, 2), 'utf8');
  throw error;
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill();
  try {
    await run(resolve(maria, 'bin/mariadb-admin.exe'), [
      '--protocol=tcp',
      '--ssl=0',
      '--host=127.0.0.1',
      `--port=${dbPort}`,
      '--user=root',
      'shutdown',
    ]);
  } catch {}
  if (databaseProcess && databaseProcess.exitCode === null) databaseProcess.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  if (!runtime.startsWith(resolve(tmpdir(), 'rim-smoke-')))
    throw new Error(`Refusing to remove unexpected path: ${runtime}`);
  await rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function run(program, args, stdin) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveRun(stdout) : reject(new Error(`${program} exited ${code}: ${stderr || stdout}`)),
    );
    if (stdin) child.stdin.end(stdin);
  });
}

function waitForPort(port, timeout) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolveWait();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeout) reject(new Error(`Port ${port} did not open.`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function waitForHttp(url, timeout) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`API health timeout: ${lastError}`);
}

function iniPath(path) {
  return path.replaceAll('\\', '/');
}
