import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const PUBLIC_ROUTE = 'publicRoute';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
  mustChangePassword: boolean;
};

export type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
  ip?: string;
};

@Injectable()
export class JsonSafeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(jsonSafe));
  }
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return jsonSafe((value as { toJSON: () => unknown }).toJSON());
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  }
  return value;
}

function excelText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => String((part as { text?: unknown })?.text ?? '')).join('');
    if (cell.text !== undefined) return String(cell.text);
    if (cell.result !== undefined) return String(cell.result);
    return '';
  }
  return String(value);
}

export function text(value: unknown, max = 500) {
  const result = excelText(value).trim();
  return result ? result.slice(0, max) : null;
}

export function numberOrNull(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateOrNull(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function assertLabTriple(l: unknown, a: unknown, b: unknown) {
  const values = [numberOrNull(l), numberOrNull(a), numberOrNull(b)];
  if (values.every((item) => item === null)) return null;
  if (values.some((item) => item === null)) throw new Error('L、a、b 必须同时填写或同时留空。');
  const [lv, av, bv] = values as [number, number, number];
  if (lv < 0 || lv > 100 || av < -200 || av > 200 || bv < -200 || bv > 200) {
    throw new Error('Lab 数值超出允许范围。');
  }
  return { l: lv, a: av, b: bv };
}

export function cie76(left: { l: number; a: number; b: number }, right: { l: number; a: number; b: number }) {
  return Math.sqrt((left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2);
}

type LabColor = { l: number; a: number; b: number };

export const MATCH_FORMULAS = ['CIE76', 'CIE94', 'CIEDE2000'] as const;
export type MatchFormula = (typeof MATCH_FORMULAS)[number];

export function normalizeFormula(value: unknown): MatchFormula {
  const text = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (text === 'CIE94') return 'CIE94';
  if (text === 'CIEDE2000' || text === 'CIE2000' || text === 'DE2000') return 'CIEDE2000';
  return 'CIE76';
}

export function deltaE(formula: MatchFormula, left: LabColor, right: LabColor) {
  if (formula === 'CIE94') return cie94(left, right);
  if (formula === 'CIEDE2000') return ciede2000(left, right);
  return cie76(left, right);
}

// CIE94 with graphic-arts defaults (kL=1, K1=0.045, K2=0.015).
export function cie94(left: LabColor, right: LabColor, kL = 1, k1 = 0.045, k2 = 0.015) {
  const deltaL = left.l - right.l;
  const c1 = Math.hypot(left.a, left.b);
  const c2 = Math.hypot(right.a, right.b);
  const deltaC = c1 - c2;
  const deltaA = left.a - right.a;
  const deltaB = left.b - right.b;
  const deltaH = Math.sqrt(Math.max(0, deltaA * deltaA + deltaB * deltaB - deltaC * deltaC));
  const sL = 1;
  const sC = 1 + k1 * c1;
  const sH = 1 + k2 * c1;
  const termL = deltaL / (kL * sL);
  const termC = deltaC / sC;
  const termH = deltaH / sH;
  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2);
}

// CIEDE2000 as defined by Sharma et al. (2005), parametric factors 1:1:1.
export function ciede2000(left: LabColor, right: LabColor) {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(left.a, left.b);
  const c2 = Math.hypot(right.a, right.b);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1Prime = left.a * (1 + g);
  const a2Prime = right.a * (1 + g);
  const c1Prime = Math.hypot(a1Prime, left.b);
  const c2Prime = Math.hypot(a2Prime, right.b);
  const hPrime = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const angle = Math.atan2(b, a) / rad;
    return angle >= 0 ? angle : angle + 360;
  };
  const h1Prime = hPrime(a1Prime, left.b);
  const h2Prime = hPrime(a2Prime, right.b);
  const deltaLPrime = right.l - left.l;
  const deltaCPrime = c2Prime - c1Prime;
  let deltahPrime = 0;
  if (c1Prime * c2Prime !== 0) {
    const diff = h2Prime - h1Prime;
    if (Math.abs(diff) <= 180) deltahPrime = diff;
    else deltahPrime = diff > 180 ? diff - 360 : diff + 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltahPrime / 2) * rad);
  const lBarPrime = (left.l + right.l) / 2;
  const cBarPrime = (c1Prime + c2Prime) / 2;
  let hBarPrime = h1Prime + h2Prime;
  if (c1Prime * c2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) hBarPrime = (h1Prime + h2Prime) / 2;
    else hBarPrime = h1Prime + h2Prime < 360 ? (h1Prime + h2Prime + 360) / 2 : (h1Prime + h2Prime - 360) / 2;
  } else {
    hBarPrime = h1Prime + h2Prime;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarPrime - 30) * rad) +
    0.24 * Math.cos(2 * hBarPrime * rad) +
    0.32 * Math.cos((3 * hBarPrime + 6) * rad) -
    0.2 * Math.cos((4 * hBarPrime - 63) * rad);
  const deltaTheta = 30 * Math.exp(-(((hBarPrime - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarPrime ** 7 / (cBarPrime ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBarPrime - 50) ** 2) / Math.sqrt(20 + (lBarPrime - 50) ** 2);
  const sC = 1 + 0.045 * cBarPrime;
  const sH = 1 + 0.015 * cBarPrime * t;
  const rT = -Math.sin(2 * deltaTheta * rad) * rC;
  const termL = deltaLPrime / sL;
  const termC = deltaCPrime / sC;
  const termH = deltaHPrime / sH;
  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH);
}
