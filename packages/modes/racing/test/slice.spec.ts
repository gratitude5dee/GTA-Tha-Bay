/**
 * AC-10: the slice goldens validate and round-trip; a slice pushed over 1,572,864 B evicts the oldest ghost first; a standalone
 * session writes only `core`, `settings` and `mode:racing` (the engine's capability rule, checked here against the mode's slot).
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { canonicalize, type GhostEntry, type SlotId } from '@dv/shared';
import { canWrite, capabilityFor } from '@dv/engine/sim';
import { validateSlice } from '@dv/engine/save';
import { racingDescriptor } from '../src';
import {
  applyRun, defaultRacingSlice, evictToFit, readRacingSlice, RACING_SLICE_MAX_BYTES, sliceBytes, STALE_EVENT_MS, type RacingSlice, type RunRecord,
} from '../src/sim/slice.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const golden = read('../../../../tests/golden/saves/racing/slice.v1.json') as RacingSlice;
const schema = read('../../../shared/schemas/racing/racing-slice.schema.json') as object;

const ghost = (ms: number, savedAt: number, pad: number): GhostEntry => ({
  vehicleDef: 'vehicle.kestrel-quill', ms, profile: 'canonical', buildId: 'b', worldBake: 'ab'.repeat(32), inputsB64: null, trackB64: 'A'.repeat(pad), savedAt,
});

const run = (raceId: string, ms: number, g: GhostEntry | null = null): RunRecord => ({
  raceId, kind: 'sprint', outcome: 'finish', ms, place: 1, medals: 2, rep: 100, cashCents: 250000, ghost: g,
});

describe('RacingSlice', () => {
  it('the golden slice.v1.json validates (the engine validator and Ajv agree) and round-trips', () => {
    expect(validateSlice('racing', 1, golden)).toBeNull();
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const v = ajv.compile(schema);
    expect(v(golden), JSON.stringify(v.errors)).toBe(true);
    const back = readRacingSlice(JSON.parse(JSON.stringify(golden)));
    expect(canonicalize(back)).toBe(canonicalize(golden));
    expect(sliceBytes(golden)).toBeLessThan(RACING_SLICE_MAX_BYTES);
    expect(Object.keys(golden.ghosts)).toEqual(['sf.downhill.twin-peaks-mission']);
    expect(golden.events['sf.pursuit.bayview-escape']?.plays).toBe(1);
  });

  it('the default slice validates, and a broken one is refused with its path', () => {
    expect(validateSlice('racing', 1, defaultRacingSlice())).toBeNull();
    expect(validateSlice('racing', 1, { ...defaultRacingSlice(), purseCents: -1 })).toMatch(/purseCents/);
    expect(validateSlice('racing', 1, { ...defaultRacingSlice(), schema: 2 })).not.toBeNull();
    const bad = defaultRacingSlice();
    (bad.settings as { difficulty: string }).difficulty = 'insane';
    expect(validateSlice('racing', 1, bad)).toMatch(/difficulty/);
  });

  it('readRacingSlice takes nothing, a slice from the future or junk as the default', () => {
    expect(readRacingSlice(null)).toEqual(defaultRacingSlice());
    expect(readRacingSlice({ schema: 2 })).toEqual(defaultRacingSlice());
    expect(readRacingSlice('x')).toEqual(defaultRacingSlice());
    expect(readRacingSlice({ schema: 1, rep: 40 }).rep).toBe(40);
  });

  it('a slice over the cap evicts the oldest ghost first, one at a time, and keeps the newest', () => {
    const s = defaultRacingSlice();
    const now = 1_800_000_000_000;
    // four ghosts of 450 KB each: 1.8 MB, over the 1.5 MB cap
    s.ghosts['sf.sprint.a-oldest'] = ghost(300000, now - 4000, 450_000);
    s.ghosts['sf.sprint.b-older'] = ghost(300000, now - 3000, 450_000);
    s.ghosts['sf.sprint.c-newer'] = ghost(300000, now - 2000, 450_000);
    s.ghosts['sf.sprint.d-newest'] = ghost(300000, now - 1000, 450_000);
    expect(sliceBytes(s)).toBeGreaterThan(RACING_SLICE_MAX_BYTES);
    const gone = evictToFit(s, now);
    expect(gone).toEqual(['ghost:sf.sprint.a-oldest']);
    expect(Object.keys(s.ghosts).sort()).toEqual(['sf.sprint.b-older', 'sf.sprint.c-newer', 'sf.sprint.d-newest']);
    expect(sliceBytes(s)).toBeLessThanOrEqual(RACING_SLICE_MAX_BYTES);
  });

  it('applyRun evicts through the cap, keeps the best time and the best medal, and pays the wallet', () => {
    const s = defaultRacingSlice();
    const now = 1_800_000_000_000;
    for (let i = 0; i < 4; i++) s.ghosts[`sf.sprint.old-${i}`] = ghost(200000, now - 10_000 + i, 500_000);
    const out = applyRun(s, run('sf.sprint.new', 150000, ghost(150000, now, 100)), now);
    expect(out.newBest).toBe(true);
    expect(out.evicted).toEqual(['ghost:sf.sprint.old-0']);
    expect(s.ghosts['sf.sprint.new']?.ms).toBe(150000);
    expect(s.events['sf.sprint.new']).toMatchObject({ bestMs: 150000, medals: 2, plays: 1 });
    expect(s.purseCents).toBe(250000);
    expect(s.rep).toBe(100);
    // a slower run later keeps the record and the ghost
    const slow = applyRun(s, { ...run('sf.sprint.new', 170000, ghost(170000, now + 1, 100)), medals: 1 }, now + 1);
    expect(slow.newBest).toBe(false);
    expect(s.events['sf.sprint.new']).toMatchObject({ bestMs: 150000, medals: 2, plays: 2 });
    expect(s.ghosts['sf.sprint.new']?.ms).toBe(150000);
    expect(s.purseCents).toBe(500000);
  });

  it('with no ghost left the records of events not played for 60 days go, oldest first; a repair fee never takes the purse below zero', () => {
    const s = defaultRacingSlice();
    const now = 1_800_000_000_000;
    for (let i = 0; i < 4; i++) s.events[`sf.x.stale-${String(i).padStart(2, '0')}`] = { bestMs: 1, medals: 0, plays: 1, lastPlayed: now - STALE_EVENT_MS - 1000 + i };
    const gone = evictToFit(s, now, 300);
    expect(gone[0]).toBe('event:sf.x.stale-00');
    expect(Object.keys(s.events).length).toBeLessThan(4);
    const t = defaultRacingSlice();
    t.purseCents = 1000;
    applyRun(t, { ...run('sf.pursuit.x', 1), outcome: 'dnf', cashCents: -45000, medals: 0, rep: 0 }, now);
    expect(t.purseCents).toBe(0);
  });

  it('a standalone racing session writes only core, settings and mode:racing', () => {
    const d = racingDescriptor();
    expect(d.saveSlot).toBe('mode:racing');
    const cap = capabilityFor(d.saveSlot as SlotId);
    expect(cap).toBe('standalone:racing');
    const slots: SlotId[] = ['core', 'settings', 'sandbox', 'story:auto', 'story:1', 'mode:racing', 'mode:fighter', 'mode:tycoon', 'mod:abc'];
    const allowed = slots.filter((x) => canWrite(cap, x));
    expect(allowed).toEqual(['core', 'settings', 'mode:racing']);
  });
});
