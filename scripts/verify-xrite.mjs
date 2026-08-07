import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const xrite = resolve(root, 'apps/desktop/src-tauri/resources/xrite');
const expected = {
  'exact-bridge.exe': '14b3af60c6f929ea2859d17db7857fe864e6eaf4602a64ec11cfbc128ae9269e',
  'eXact.dll': '46ff08e97a4d9c6fdd98f07e824b03f44e8581961c3e137e746233efb2a86435',
};
for (const [name, checksum] of Object.entries(expected)) {
  const actual = createHash('sha256')
    .update(await readFile(resolve(xrite, name)))
    .digest('hex');
  if (actual !== checksum) throw new Error(`${name} SHA256 mismatch: ${actual}`);
}
const result = spawnSync(resolve(xrite, 'exact-bridge.exe'), ['probe'], {
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, EXACT_DLL_PATH: resolve(xrite, 'eXact.dll') },
});
if (result.status !== 0) throw new Error(`Offline eXact probe failed: ${result.stderr || result.stdout}`);
const probe = JSON.parse(result.stdout);
if (probe.dll !== resolve(xrite, 'eXact.dll')) throw new Error(`Bridge did not load the bundled DLL: ${probe.dll}`);
console.log(result.stdout.trim());
