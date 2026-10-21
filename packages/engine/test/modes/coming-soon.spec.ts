import { describe, expect, it } from 'vitest';
import { makeRig } from './fixture.ts';

/** AC-3: `engine/modes.comingSoon`. */
describe('built-in registry (A-06)', () => {
  it('lists story (order 1) and sandbox as available with no unlock, and racing, fighter, tycoon as comingSoon with orders 2, 3, 4', () => {
    const rig = makeRig();
    const list = rig.host.list();
    expect(list.map((m) => [m.id, m.order])).toEqual([['story', 1], ['racing', 2], ['fighter', 3], ['tycoon', 4], ['sandbox', 5]]);
    for (const id of ['story', 'sandbox'] as const) {
      const d = rig.host.descriptor(id);
      expect(d?.status).toBe('available');
      expect(d?.unlock).toBeNull();
    }
    for (const id of ['racing', 'fighter', 'tycoon'] as const) {
      const d = rig.host.descriptor(id);
      expect(d?.status).toBe('comingSoon');
      expect(d?.unlock).toBe(`unlock.${id}`);
      expect(d?.tile.art).toBe(`ui/mode-${id}`);
      expect(d?.standalone).toBe(true);
      expect(d?.embeddable).toBe(true);
    }
    expect(new Set(list.map((m) => m.order)).size).toBe(list.length);
  });

  it('refuses mode.start for the stubs, with the same answer after they are unlocked', () => {
    const rig = makeRig();
    for (const id of ['racing', 'fighter', 'tycoon'] as const) {
      expect(rig.host.start(id)).toEqual({ ok: false, reason: 'coming-soon' });
      rig.unlocks.emit(`unlock.${id}`, { kind: 'debug', ref: '' });
      expect(rig.host.start(id)).toEqual({ ok: false, reason: 'coming-soon' });
    }
    expect(rig.host.state).toBe('Idle');
    expect(rig.host.refusals.every((r) => r.reason === 'coming-soon')).toBe(true);
    expect(rig.host.refusals).toHaveLength(6);
  });

  it('?unlockAll=1 unlocks in memory only in a QA build', () => {
    const qa = makeRig({ qa: true });
    expect(qa.host.setUnlockAll(true)).toBe(true);
    expect(qa.unlocks.has('unlock.racing')).toBe(true);
    expect(qa.unlocks.list()).toEqual([]);
    expect(qa.slices.core.unlocks).toEqual([]);
    expect(qa.posted).toEqual([]);
    expect(qa.host.list().find((m) => m.id === 'racing')?.unlocked).toBe(true);
    const prod = makeRig({ qa: false });
    expect(prod.host.setUnlockAll(true)).toBe(false);
    expect(prod.unlocks.has('unlock.racing')).toBe(false);
    expect(prod.host.list().find((m) => m.id === 'racing')?.unlocked).toBe(false);
    expect(prod.posted).toEqual([]);
  });
});
