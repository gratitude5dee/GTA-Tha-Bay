import { describe, expect, it } from 'vitest';
import type { SlotId } from '@dv/shared';
import { canWrite, capabilityFor, isSlotId, slotKind, type SaveCapability } from '../../src/sim/save/index.ts';
import { mkProfile, newStore, openSvc } from './helpers.ts';

const ALL: SlotId[] = ['core', 'settings', 'sandbox', 'story:auto', 'story:1', 'story:2', 'story:3', 'mode:racing', 'mode:fighter', 'mode:tycoon', 'mod:my.mod', 'mod:other'];
const writable = (cap: SaveCapability): SlotId[] => ALL.filter((s) => canWrite(cap, s));

describe('engine/save.capability', () => {
  it('story, sandbox, standalone and exp sessions may write exactly their slots', () => {
    expect(writable('story')).toEqual(['core', 'settings', 'story:auto', 'story:1', 'story:2', 'story:3']);
    expect(writable('sandbox')).toEqual(['settings', 'sandbox', 'mod:my.mod', 'mod:other']);
    expect(writable('standalone:racing')).toEqual(['core', 'settings', 'mode:racing']);
    expect(writable('standalone:fighter')).toEqual(['core', 'settings', 'mode:fighter']);
    expect(writable('standalone:tycoon')).toEqual(['core', 'settings', 'mode:tycoon']);
    expect(writable('exp:my.mod')).toEqual(['mod:my.mod']);
  });

  it('slot ids and kinds', () => {
    expect(isSlotId('story:auto')).toBe(true);
    expect(isSlotId('story:4')).toBe(false);
    expect(isSlotId('mod:UPPER')).toBe(false);
    expect(slotKind('mode:racing')).toBe('racing');
    expect(slotKind('mod:x')).toBe('mod');
    expect(slotKind('story:2')).toBe('story');
    for (const s of ALL) expect(canWrite(capabilityFor(s), s)).toBe(true);
  });

  it('a sandbox session writing story:auto or core gets NOT_ALLOWED and nothing is stored', async () => {
    const store = await newStore('memory');
    const svc = await openSvc(store, { capability: 'sandbox' });
    const p = await mkProfile(svc);
    expect(await svc.write('story:auto', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    expect(await svc.write('core', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    expect(await svc.write('sandbox', { a: 1 }, 'manual')).toMatchObject({ ok: true });
    expect((await store.listRecords(p.id)).map((r) => r.slot)).toEqual(['sandbox']);
  });

  it('a standalone:racing session writes only core, settings and mode:racing', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'standalone:racing' });
    await mkProfile(svc);
    for (const s of ['core', 'settings', 'mode:racing'] as const) expect(await svc.write(s, { a: 1 }, 'manual')).toMatchObject({ ok: true });
    for (const s of ['story:auto', 'sandbox', 'mode:fighter', 'mod:x'] as const) expect(await svc.write(s, { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
  });

  it('an exp:<id> session writes only its own mod slot', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'exp:my.mod' });
    await mkProfile(svc);
    expect(await svc.write('mod:my.mod', { a: 1 }, 'manual')).toMatchObject({ ok: true });
    for (const s of ['mod:other', 'core', 'settings', 'story:auto', 'sandbox', 'mode:racing'] as const) {
      expect(await svc.write(s, { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    }
  });

  it('writing without a loaded profile is NOT_ALLOWED and an unknown slot is INVALID', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox' });
    expect(await svc.write('sandbox', { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    await mkProfile(svc);
    expect(await svc.write('bogus' as SlotId, { a: 1 }, 'manual')).toMatchObject({ ok: false, error: 'INVALID' });
  });
});
