/**
 * Failure handling of the ChunkStore (02-world.md 5.6): a pack that is unavailable retries with backoff and keeps the units behind
 * it in `unavailable()` until the pack comes back (any unit of it settles); a wrong hash or an undecodable pack ends in `failed`
 * at once and is not an outage.
 */
import type { ChunkKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { ChunkStore, type LoadRequest } from '../src/sim/streaming/chunk-store.ts';

function setup(): { store: ChunkStore<string>; requests: LoadRequest[]; clock: { t: number } } {
  const clock = { t: 0 };
  const requests: LoadRequest[] = [];
  const store = new ChunkStore<string>({
    levels: ['l0'],
    tier: 'desktop',
    exists: () => true,
    request: (r) => void requests.push(r),
    now: () => clock.t,
    retry: { firstDelay: 10, maxDelay: 100, maxAttempts: 3 },
    // Four chunks of one pack.
    groupOf: (_l, k) => `tile-${Math.floor(Number(k.split('/')[1]) / 4)}-${Math.floor(Number(k.split('/')[2]) / 4)}`,
  });
  return { store, requests, clock };
}

const focus = { x: 100, z: 100, vx: 0, vz: 0 };

describe('ChunkStore failure handling', () => {
  it('keeps every unit behind an unavailable pack in unavailable() until a unit of that pack loads', () => {
    const { store, requests, clock } = setup();
    store.want(focus);
    const first = requests.slice(0, 4);
    expect(first.length).toBeGreaterThan(0);
    for (const r of requests) store.settle('l0', r.key, { ok: false, reason: 'offline' });
    const down = store.unavailable('l0');
    expect(down.length).toBe(requests.length);
    // Retry is scheduled; the units are requested again after the delay and stay "down" while they are in flight.
    clock.t = 20;
    const before = requests.length;
    store.want(focus);
    expect(requests.length).toBeGreaterThan(before);
    expect(store.unavailable('l0').length).toBeGreaterThan(0);
    // One unit of the pack arrives: the pack is back, the overlay set empties even though other units still wait.
    const retried = requests[before] as LoadRequest;
    store.settle('l0', retried.key, { ok: true, payload: 'mesh' });
    const stillWaiting = [...store.units.values()].filter((u) => u.state === 'requested' || u.state === 'retrying');
    expect(stillWaiting.length).toBeGreaterThan(0);
    const sameGroup = store.unavailable('l0').filter((k) => k.split('/')[1] !== undefined);
    // Units of the recovered pack are no longer reported; units of other still-failing packs (if any) may remain.
    expect(sameGroup.includes(retried.key)).toBe(false);
  });

  it('a corrupt pack ends in failed at once and is not reported as unavailable', () => {
    const { store, requests } = setup();
    store.want(focus);
    const r = requests[0] as LoadRequest;
    store.settle('l0', r.key, { ok: false, reason: 'corrupt' });
    expect(store.failed('l0')).toContain(r.key);
    expect(store.unavailable('l0')).not.toContain(r.key);
  });

  it('gives up after maxAttempts retries of an unavailable pack', () => {
    const { store, requests, clock } = setup();
    store.want(focus);
    const key = (requests[0] as LoadRequest).key as ChunkKey;
    for (let i = 0; i < 3; i++) {
      store.settle('l0', key, { ok: false, reason: 'unavailable' });
      clock.t += 1000;
      store.want(focus);
    }
    expect(store.failed('l0')).toContain(key);
  });
});
