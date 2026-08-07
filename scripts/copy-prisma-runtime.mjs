import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'apps/api/src/generated/client');
const target = resolve(root, 'apps/api/dist/generated/client');
await mkdir(resolve(root, 'apps/api/dist/generated'), { recursive: true });
await cp(source, target, { recursive: true, force: true });
console.log(`Copied Prisma runtime to ${target}`);
