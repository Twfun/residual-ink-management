import { describe, expect, it } from 'vitest';
import { extractMeasuredLab, labToRgb, parseXriteMeasurement } from './labColor';

describe('labToRgb', () => {
  it('maps white and black Lab values to sRGB extremes', () => {
    expect(labToRgb(100, 0, 0)).toEqual({ r: 255, g: 255, b: 255, inGamut: true });
    expect(labToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0, inGamut: true });
  });

  it('maps neutral mid gray to equal channels near 128', () => {
    const { r, g, b, inGamut } = labToRgb(53.585, 0, 0);
    expect(inGamut).toBe(true);
    expect(Math.abs(r - 128)).toBeLessThanOrEqual(2);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('maps the sRGB red primary Lab value back to red', () => {
    const { r, g, b } = labToRgb(53.24, 80.09, 67.2);
    expect(r).toBeGreaterThanOrEqual(253);
    expect(g).toBeLessThanOrEqual(2);
    expect(b).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-gamut colors and flags them', () => {
    const result = labToRgb(60, 120, -120);
    expect(result.inGamut).toBe(false);
    for (const channel of [result.r, result.g, result.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('parseXriteMeasurement', () => {
  it('parses structured lab data with instrument metadata', () => {
    const parsed = parseXriteMeasurement({
      ok: true,
      measurement: { lab: { M0: { L: 50.1, a: 1.2, b: -3.4 } }, condition: 'M0', density: { T: 1.45 } },
      instrument: { serialNumber: 'SN-01', model: 'eXact' },
    });
    expect(parsed).toMatchObject({
      l: 50.1,
      a: 1.2,
      b: -3.4,
      densityT: 1.45,
      measureCondition: 'M0',
      instrumentModel: 'eXact',
      instrumentSerial: 'SN-01',
    });
  });

  it('parses string lab payloads', () => {
    expect(extractMeasuredLab({ lab: 'L: 48.2 a: -1.5 b: 6.75' })).toEqual({ l: 48.2, a: -1.5, b: 6.75 });
  });

  it('returns null when Lab data is incomplete', () => {
    expect(parseXriteMeasurement({ ok: true, measurement: {} })).toBeNull();
    expect(parseXriteMeasurement(null)).toBeNull();
  });
});
