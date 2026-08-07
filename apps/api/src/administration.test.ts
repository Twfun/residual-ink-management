import { describe, expect, it } from 'vitest';
import { buildUserWhere } from './administration';

describe('buildUserWhere', () => {
  it('returns empty filter for empty query', () => {
    expect(buildUserWhere({})).toEqual({});
  });

  it('matches keyword against username and displayName', () => {
    expect(buildUserWhere({ keyword: ' sc ' })).toEqual({
      OR: [{ username: { contains: 'sc' } }, { displayName: { contains: 'sc' } }],
    });
  });

  it('filters by role and enabled state', () => {
    expect(buildUserWhere({ roleCode: 'operator', enabled: 'true' })).toEqual({ roleCode: 'operator', enabled: true });
    expect(buildUserWhere({ enabled: 'false' })).toEqual({ enabled: false });
  });

  it('ignores invalid enabled values and combines all filters', () => {
    expect(buildUserWhere({ keyword: 'a', roleCode: 'user', enabled: 'yes' })).toEqual({
      roleCode: 'user',
      OR: [{ username: { contains: 'a' } }, { displayName: { contains: 'a' } }],
    });
  });
});
