import { describe, expect, it } from 'vitest';
import { buildMonthlyDays, monthDayCount, parseDay, resolveYearMonth } from './statistics';

describe('statistics helpers', () => {
  it('counts days per month including leap-year February', () => {
    expect(monthDayCount(2024, 2)).toBe(29);
    expect(monthDayCount(2026, 2)).toBe(28);
    expect(monthDayCount(2026, 1)).toBe(31);
    expect(monthDayCount(2026, 4)).toBe(30);
    expect(monthDayCount(2026, 12)).toBe(31);
  });

  it('fills every day of the month and totals counts', () => {
    const inbound = new Map([
      ['2024-02-01', 2],
      ['2024-02-29', 1],
    ]);
    const outbound = new Map([['2024-02-29', 3]]);
    const { days, total } = buildMonthlyDays(2024, 2, inbound, outbound);
    expect(days).toHaveLength(29);
    expect(days[0]).toEqual({ date: '2024-02-01', inbound: 2, outbound: 0 });
    expect(days[28]).toEqual({ date: '2024-02-29', inbound: 1, outbound: 3 });
    expect(total).toEqual({ inbound: 3, outbound: 3, days: 29 });
  });

  it('returns zeros for an empty month', () => {
    const { days, total } = buildMonthlyDays(2026, 6, new Map(), new Map());
    expect(days).toHaveLength(30);
    expect(days.every((day) => day.inbound === 0 && day.outbound === 0)).toBe(true);
    expect(total).toEqual({ inbound: 0, outbound: 0, days: 30 });
  });

  it('resolves defaults and rejects invalid year or month', () => {
    const now = new Date(2026, 7, 6);
    expect(resolveYearMonth(undefined, undefined, now)).toEqual({ year: 2026, month: 8 });
    expect(resolveYearMonth('', '', now)).toEqual({ year: 2026, month: 8 });
    expect(resolveYearMonth('2026', '2', now)).toEqual({ year: 2026, month: 2 });
    expect(() => resolveYearMonth('abc', '1', now)).toThrow();
    expect(() => resolveYearMonth('2026', '13', now)).toThrow();
    expect(() => resolveYearMonth('2026', '0', now)).toThrow();
  });

  it('parses daily boundaries across month end', () => {
    const { start, end } = parseDay('2026-01-31');
    expect(start.getFullYear()).toBe(2026);
    expect(start.getDate()).toBe(31);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(1);
    expect(() => parseDay('2026/01/31')).toThrow();
    expect(() => parseDay('not-a-date')).toThrow();
    expect(() => parseDay(undefined)).toThrow();
  });
});
