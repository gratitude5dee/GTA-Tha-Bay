import { describe, expect, it } from 'vitest';
import { catalogFailureCode, worldIndexFailureCode } from '../src/world-failure.ts';

describe('world-load failure codes (BD-FU-A02)', () => {
  it('a catalog the media host does not serve, or that cannot be reached while online, is a world-load error', () => {
    expect(catalogFailureCode({ state: 'unavailable', failure: { stage: 'catalog', status: 404, offline: false } })).toBe('catalog-404');
    expect(catalogFailureCode({ state: 'unavailable', failure: { stage: 'pointer', status: 503, offline: false } })).toBe('pointer-503');
    expect(catalogFailureCode({ state: 'unavailable', failure: { stage: 'catalog', status: null, offline: false } })).toBe('catalog-network');
  });

  it('the offline path, a ready, disabled or invalid catalog and no catalog at all keep the boot as it was', () => {
    expect(catalogFailureCode({ state: 'unavailable', failure: { stage: 'catalog', status: null, offline: true } })).toBeNull();
    for (const state of ['ready', 'disabled', 'invalid', 'idle']) expect(catalogFailureCode({ state, failure: null })).toBeNull();
    expect(catalogFailureCode(null)).toBeNull();
  });

  it('a world index the store cannot deliver is an error unless offline or aborted; other errors are not', () => {
    const err = (reason: string): Error & { reason: string } => Object.assign(new Error(reason), { name: 'WorldIndexUnavailable', reason });
    expect(worldIndexFailureCode(err('http'))).toBe('index-http');
    expect(worldIndexFailureCode(err('hash-mismatch'))).toBe('index-hash-mismatch');
    expect(worldIndexFailureCode(err('offline'))).toBeNull();
    expect(worldIndexFailureCode(err('aborted'))).toBeNull();
    expect(worldIndexFailureCode(new Error('a renderer error'))).toBeNull();
    expect(worldIndexFailureCode(null)).toBeNull();
  });
});
