import { describe, expect, it } from 'vitest';
import { MatchService } from './match';

const inventoryRows = [
  {
    id: 1n,
    storageLocation: 'A-01',
    rollerColorCode: 'R1',
    inboundDate: null,
    weightKg: 2.5,
    lStar: 50,
    aStar: 0,
    bStar: 0,
    colorFamily: '灰',
    note2: null,
    note3: null,
  },
  {
    id: 2n,
    storageLocation: 'A-02',
    rollerColorCode: null,
    inboundDate: null,
    weightKg: null,
    lStar: 52,
    aStar: 2,
    bStar: 1,
    colorFamily: '灰',
    note2: null,
    note3: null,
  },
  {
    id: 3n,
    storageLocation: 'B-01',
    rollerColorCode: null,
    inboundDate: null,
    weightKg: 1,
    lStar: 40,
    aStar: 30,
    bStar: -20,
    colorFamily: '红',
    note2: null,
    note3: null,
  },
];

function makeService() {
  const prisma = {
    residualInk: {
      findMany: async (args: any) => {
        const family = args?.where?.colorFamily;
        return family ? inventoryRows.filter((row) => row.colorFamily === family) : inventoryRows;
      },
    },
  };
  const audit = { write: async () => undefined };
  return new MatchService(prisma as any, audit as any);
}

describe('match search options', () => {
  it('defaults to CIE76 and sorts by deltaE ascending', async () => {
    const result = await makeService().search({ l: 50, a: 0, b: 0 });
    expect(result.formula).toBe('CIE76');
    expect(result.matches.map((match: any) => match.storageLocation)).toEqual(['A-01', 'A-02', 'B-01']);
    expect(result.matchCount).toBe(3);
  });

  it('switches formulas and changes deltaE values', async () => {
    const service = makeService();
    const cie76Result = await service.search({ l: 40, a: 28, b: -18 });
    const ciedeResult = await service.search({ l: 40, a: 28, b: -18, formula: 'CIEDE2000' });
    expect(ciedeResult.formula).toBe('CIEDE2000');
    const red76 = cie76Result.matches.find((match: any) => match.storageLocation === 'B-01');
    const red00 = ciedeResult.matches.find((match: any) => match.storageLocation === 'B-01');
    expect(red00.deltaE).not.toBe(red76.deltaE);
  });

  it('filters by maxDeltaE threshold', async () => {
    const result = await makeService().search({ l: 50, a: 0, b: 0, maxDeltaE: 3 });
    expect(result.matches.map((match: any) => match.storageLocation)).toEqual(['A-01', 'A-02']);
    expect(result.matchCount).toBe(2);
  });

  it('truncates to the requested top-N limit', async () => {
    const result = await makeService().search({ l: 50, a: 0, b: 0, limit: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].storageLocation).toBe('A-01');
    expect(result.matchCount).toBe(3);
  });

  it('filters by color family', async () => {
    const result = await makeService().search({ l: 50, a: 0, b: 0, colorFamily: '红' });
    expect(result.matches.map((match: any) => match.storageLocation)).toEqual(['B-01']);
    expect(result.availableCount).toBe(1);
  });
});
