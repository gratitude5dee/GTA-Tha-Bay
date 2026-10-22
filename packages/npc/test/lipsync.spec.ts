import { describe, expect, it } from 'vitest';
import type { Viseme } from '@dv/shared/npc';
import { atlasTarget, cellUv, JAW_OPEN, MAX_JAW_RAD } from '../src/lipsync/atlas.ts';
import { LipSyncDriver, type LipSyncTarget } from '../src/lipsync/driver.ts';
import { envelopeReader, rms } from '../src/lipsync/rms.ts';
import { FakeAnalyser } from './audio-fakes.ts';

// M06a4 AC-7 (first half): a fake AudioContext clock and a recorded RMS envelope drive the LipSyncDriver for 3 s.

interface Call {
  t: number;
  col: number;
  row: number;
  shape: Viseme;
}
function recorder(clock: { t: number }): { target: LipSyncTarget; cells: Call[]; jaw: { t: number; open: number }[] } {
  const cells: Call[] = [];
  const jaw: { t: number; open: number }[] = [];
  return {
    cells,
    jaw,
    target: {
      setCell: (col, row, shape) => cells.push({ t: clock.t, col, row, shape }),
      setJaw: (open) => jaw.push({ t: clock.t, open }),
    },
  };
}

/** A recorded envelope: a syllable rhythm of about 4 Hz with pauses. */
const envelope = (t: number): number => (Math.sin(t * 2 * Math.PI * 4) > -0.2 ? 0.05 + 0.25 * Math.abs(Math.sin(t * 2 * Math.PI * 1.3)) : 0.005);

const FRAME = 1 / 60;

describe('LipSyncDriver, t1 envelope', () => {
  it('changes the atlas cell only on the 60 ms hold boundary, for 3 seconds', () => {
    const clock = { t: 10 };
    const rec = recorder(clock);
    const driver = new LipSyncDriver({ clock: () => clock.t });
    expect(driver.start('npc_a', rec.target, { hasJaw: false, source: { kind: 'envelope', read: () => envelope(clock.t), vowelDensity: 0.3 } })).toBe(true);
    const t0 = clock.t;
    let frames = 0;
    for (; clock.t < t0 + 3; clock.t += FRAME) {
      driver.update();
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(179);
    expect(rec.cells.length).toBeGreaterThan(5);
    // at most one change per 60 ms in 3 s
    expect(rec.cells.length).toBeLessThanOrEqual(Math.ceil(3 / 0.06));
    const step = (t: number): number => Math.floor((t - t0 + 1e-9) / 0.06);
    for (let i = 1; i < rec.cells.length; i++) {
      const a = rec.cells[i - 1]!;
      const b = rec.cells[i]!;
      expect(step(b.t)).toBeGreaterThan(step(a.t)); // a new hold interval
      expect(b.t - a.t).toBeGreaterThanOrEqual(0.06 - FRAME - 1e-9);
      expect(b.shape).not.toBe(a.shape);
    }
    // every call is the first frame of its interval
    for (const c of rec.cells) expect(c.t - t0 - step(c.t) * 0.06).toBeLessThan(FRAME + 1e-9);
  });

  it('turns the jaw only for a speaker whose rig has the jaw bone', () => {
    const clock = { t: 0 };
    const noJaw = recorder(clock);
    const jaw = recorder(clock);
    const driver = new LipSyncDriver({ clock: () => clock.t });
    const src = { kind: 'envelope' as const, read: () => envelope(clock.t), vowelDensity: 0.3 };
    driver.start('a', noJaw.target, { hasJaw: false, source: src });
    driver.start('b', jaw.target, { hasJaw: true, source: src });
    for (; clock.t < 3; clock.t += FRAME) driver.update();
    expect(noJaw.cells.length).toBeGreaterThan(5);
    expect(noJaw.jaw).toEqual([]);
    expect(jaw.jaw.length).toBe(jaw.cells.length);
    for (const j of jaw.jaw) expect(j.open).toBeGreaterThanOrEqual(0);
    expect(Math.max(...jaw.jaw.map((j) => j.open))).toBeLessThanOrEqual(1);
  });

  it('refuses a third concurrent speaker, which then stays still, and takes it once one stops', () => {
    const clock = { t: 0 };
    const [a, b, c] = [recorder(clock), recorder(clock), recorder(clock)];
    const driver = new LipSyncDriver({ clock: () => clock.t });
    const src = { kind: 'envelope' as const, read: () => 0.3, vowelDensity: 0.3 };
    expect(driver.start('a', a.target, { hasJaw: true, source: src })).toBe(true);
    expect(driver.start('b', b.target, { hasJaw: true, source: src })).toBe(true);
    expect(driver.start('c', c.target, { hasJaw: true, source: src })).toBe(false);
    expect(driver.refused).toBe(1);
    expect(driver.speaking()).toEqual(['a', 'b']);
    for (; clock.t < 1; clock.t += FRAME) driver.update();
    expect(a.cells.length).toBeGreaterThan(0);
    expect(c.cells).toEqual([]);
    expect(c.jaw).toEqual([]);
    // an NPC that is already speaking may restart
    expect(driver.start('a', a.target, { hasJaw: true, source: src })).toBe(true);
    driver.stop('a');
    expect(a.cells.at(-1)?.shape).toBe('X'); // the mouth closes
    expect(a.jaw.at(-1)?.open).toBe(0);
    expect(driver.start('c', c.target, { hasJaw: false, source: src })).toBe(true);
  });
});

describe('LipSyncDriver, cues', () => {
  it('follows baked or alignment cues on the audio clock, offset to when the audio plays', () => {
    const clock = { t: 5 };
    const rec = recorder(clock);
    const driver = new LipSyncDriver({ clock: () => clock.t });
    driver.start('npc_a', rec.target, {
      hasJaw: false,
      source: {
        kind: 'cues',
        offsetS: 5,
        cues: [
          { start: 0, end: 0.3, shape: 'A' },
          { start: 0.3, end: 0.6, shape: 'D' },
          { start: 0.6, end: 0.9, shape: 'X' },
        ],
      },
    });
    for (; clock.t < 6; clock.t += FRAME) driver.update();
    expect(rec.cells.map((c) => c.shape)).toEqual(['A', 'D', 'X']);
    // each change lands on the first hold interval at or after its cue
    expect(rec.cells[1]!.t - 5).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(rec.cells[1]!.t - 5).toBeLessThan(0.3 + 0.06 + FRAME);
    // a later sentence adds cues
    driver.addCues('npc_a', [{ start: 0, end: 0.3, shape: 'E' }], 7);
    for (; clock.t < 7.5; clock.t += FRAME) driver.update();
    expect(rec.cells.at(-1)!.shape === 'E' || rec.cells.some((c) => c.shape === 'E')).toBe(true);
  });
});

describe('rms and the atlas', () => {
  it('computes the RMS of a buffer and reads it from an analyser', () => {
    expect(rms([])).toBe(0);
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5, 6);
    expect(rms([Number.NaN])).toBe(0);
    const an = new FakeAnalyser();
    an.level = 0.2;
    expect(envelopeReader(an)()).toBeCloseTo(0.2, 6);
  });

  it('maps a shape to the UV offset of its cell and the jaw to radians', () => {
    const a = cellUv('A');
    expect([a.u, a.v, a.scale]).toEqual([0, expect.closeTo(2 / 3, 9), expect.closeTo(1 / 3, 9)]);
    const x = cellUv('X');
    expect([x.u, x.v, x.scale]).toEqual([expect.closeTo(2 / 3, 9), 0, expect.closeTo(1 / 3, 9)]);
    const set: [number, number][] = [];
    const jaw: number[] = [];
    const target = atlasTarget({ value: { set: (x, y) => set.push([x, y]) } }, (r) => jaw.push(r));
    target.setCell(1, 1, 'E');
    target.setJaw(JAW_OPEN['D']);
    expect(set).toEqual([[expect.closeTo(1 / 3, 9), expect.closeTo(1 / 3, 9)]]);
    expect(jaw).toEqual([MAX_JAW_RAD]);
  });
});
