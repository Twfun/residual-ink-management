import { describe, expect, it } from 'vitest';
import { assertLabTriple, cie76, cie94, ciede2000, deltaE, normalizeFormula, numberOrNull } from './common';

describe('color and input rules', () => {
  it('calculates CIE76 delta E', () => {
    expect(cie76({ l: 50, a: 10, b: -4 }, { l: 53, a: 14, b: -4 })).toBe(5);
  });

  it('accepts an all-empty Lab triple and rejects incomplete Lab input', () => {
    expect(assertLabTriple('', null, undefined)).toBeNull();
    expect(() => assertLabTriple(50, '', 2)).toThrow();
  });

  it('keeps an unknown weight as null instead of zero', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
    expect(numberOrNull('0')).toBe(0);
  });
});

describe('cie94 and ciede2000', () => {
  it('matches the Sharma CIEDE2000 reference pairs', () => {
    expect(ciede2000({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 4);
    expect(ciede2000({ l: 50, a: 3.1571, b: -77.2803 }, { l: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.8615, 4);
    expect(ciede2000({ l: 50, a: 2.49, b: -0.001 }, { l: 50, a: -2.49, b: 0.0009 })).toBeCloseTo(7.1792, 4);
    expect(ciede2000({ l: 60.2574, a: -34.0099, b: 36.2677 }, { l: 60.4626, a: -34.1751, b: 39.4387 })).toBeCloseTo(
      1.2644,
      4,
    );
  });

  it('computes CIE94 with graphic-arts defaults and zero for identical colors', () => {
    expect(cie94({ l: 50, a: 10, b: -4 }, { l: 53, a: 14, b: -4 })).toBeCloseTo(4.0902, 4);
    expect(cie94({ l: 40, a: 5, b: 5 }, { l: 40, a: 5, b: 5 })).toBe(0);
    expect(ciede2000({ l: 40, a: 5, b: 5 }, { l: 40, a: 5, b: 5 })).toBe(0);
  });

  it('normalizes formula names and dispatches deltaE', () => {
    expect(normalizeFormula('cie94')).toBe('CIE94');
    expect(normalizeFormula('CIEDE2000')).toBe('CIEDE2000');
    expect(normalizeFormula('de2000')).toBe('CIEDE2000');
    expect(normalizeFormula(undefined)).toBe('CIE76');
    expect(normalizeFormula('unknown')).toBe('CIE76');
    const left = { l: 50, a: 2.6772, b: -79.7751 };
    const right = { l: 50, a: 0, b: -82.7485 };
    expect(deltaE('CIE76', left, right)).toBe(cie76(left, right));
    expect(deltaE('CIE94', left, right)).toBe(cie94(left, right));
    expect(deltaE('CIEDE2000', left, right)).toBeCloseTo(2.0425, 4);
  });
});
