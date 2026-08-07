import { describe, expect, it } from 'vitest';
import { bucketKey, bucketLabel, nextBucket } from './dashboard';

describe('dashboard bucket helpers', () => {
  it('buckets by day and rolls across month and year boundaries', () => {
    expect(bucketKey(new Date(2026, 0, 31), 'day')).toBe('2026-01-31');
    expect(nextBucket('2026-01-31', 'day')).toBe('2026-02-01');
    expect(nextBucket('2026-12-31', 'day')).toBe('2027-01-01');
    expect(nextBucket('2024-02-28', 'day')).toBe('2024-02-29');
  });

  it('aligns weeks to Monday', () => {
    // 2026-08-06 is a Thursday, its week starts on Monday 2026-08-03
    expect(bucketKey(new Date(2026, 7, 6), 'week')).toBe('2026-08-03');
    expect(bucketKey(new Date(2026, 7, 3), 'week')).toBe('2026-08-03');
    expect(bucketKey(new Date(2026, 7, 9), 'week')).toBe('2026-08-03');
    expect(nextBucket('2026-08-03', 'week')).toBe('2026-08-10');
    expect(nextBucket('2026-12-28', 'week')).toBe('2027-01-04');
  });

  it('rolls months and years and formats labels', () => {
    expect(bucketKey(new Date(2026, 7, 6), 'month')).toBe('2026-08');
    expect(nextBucket('2026-12', 'month')).toBe('2027-01');
    expect(nextBucket('2026-08', 'month')).toBe('2026-09');
    expect(bucketKey(new Date(2026, 7, 6), 'year')).toBe('2026');
    expect(nextBucket('2026', 'year')).toBe('2027');
    expect(bucketLabel('2026-08', 'month')).toBe('2026-08');
    expect(bucketLabel('2026', 'year')).toBe('2026');
    expect(bucketLabel('2026-08-06', 'day')).toBe('08-06');
    expect(bucketLabel('2026-08-03', 'week')).toBe('08-03');
  });
});
