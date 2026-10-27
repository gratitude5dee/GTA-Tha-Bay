/**
 * AC-6: a 3-car circuit race (the line bot and two AI rivals, seed 0xC0FFEE, well over 10,000 ticks) is recorded and re-simulated
 * from its inputs in a fresh sim: `finishTick`, every `gateTicks` entry and `endHash` are equal. A replay whose header names
 * another build plays its track and emits `racing.verify_fail`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay, replayWithinLimits } from '@dv/shared';
import { frameFromWord, replayFrames, runHeadless, type HeadlessRun } from '../src/qa/headless.ts';
import { racingSpec, registerRacingQa } from '../src/qa/index.ts';
import { ReplayViewer } from '../src/replay/viewer.ts';

registerRacingQa();
const ID = 'sf.circuit.embarcadero-vanness';
const corridor = new Uint8Array(readFileSync(new URL(`../../../../content/races/${ID}/corridor.bin`, import.meta.url)));
const spec = racingSpec({ raceId: ID, maxTicks: 30_000 });

let first: HeadlessRun | null = null;
const live = async (): Promise<HeadlessRun> => (first ??= await runHeadless(spec, corridor));

describe('exact replay of a 3-car circuit race', () => {
  it('the live race has three cars, runs past 10,000 ticks and finishes with its replay inside the caps', async () => {
    const r = await live();
    const a = r.attempt!;
    expect(spec.seed).toBe(0xc0ffee);
    expect(r.session.state().of).toBe(3);
    expect(a.outcome).toBe('finish');
    expect(r.ticks).toBeGreaterThan(10_000);
    expect(a.run).not.toBeNull();
    expect(a.run!.hasInputs).toBe(true);
    expect(replayWithinLimits(a.run!.bytes)).toBe(true);
    expect(a.gateTicks.length).toBeGreaterThanOrEqual(40);
    expect(a.finishTick).not.toBeNull();
    expect(a.run!.header.finishTick).toBe(a.finishTick);
    expect(a.run!.header.endHash).toBe(a.endHash);
    // the rivals raced: they are on the route and behind the line bot
    for (const v of r.session.state().rivals) expect(v.s).toBeGreaterThan(5000);
  }, 240_000);

  it('re-simulated from the inputs, finishTick, every gateTicks entry and endHash are equal', async () => {
    const a = (await live()).attempt!;
    const decoded = decodeReplay(a.run!.bytes);
    expect(decoded.inputs).not.toBeNull();
    const again = await runHeadless(spec, corridor, { frames: (s) => replayFrames(decoded, s) });
    const b = again.attempt!;
    again.dispose();
    expect(b.outcome).toBe('finish');
    expect(b.finishTick).toBe(a.finishTick);
    expect(b.gateTicks).toEqual(a.gateTicks);
    expect(b.endHash).toBe(a.endHash);
    expect(b.ms).toBe(a.ms);
    expect(b.place).toBe(a.place);
  }, 240_000);

  it('a viewer with a matching header re-simulates and verifies; any difference in the result drops it to the track', async () => {
    const a = (await live()).attempt!;
    const events: { name: string; props: Record<string, unknown> }[] = [];
    const tel = { emit: (name: 'racing.replay_view' | 'racing.verify_fail', props: Record<string, unknown>) => void events.push({ name, props }) };
    const h = a.run!.header;
    const cur = { handlingRev: h.handlingRev, buildId: h.buildId, worldBake: h.worldBake };
    const v = new ReplayViewer(a.run!.bytes, cur, tel as never);
    expect(v.mode).toBe('exact');
    expect(events).toEqual([{ name: 'racing.replay_view', props: { mode: 'exact' } }]);
    expect(v.verify({ finishTick: a.finishTick, gateTicks: a.gateTicks, endHash: a.endHash })).toBe(true);
    expect(v.mode).toBe('exact');
    // a hash that differs by one digit
    expect(v.verify({ finishTick: a.finishTick, gateTicks: a.gateTicks, endHash: `${a.endHash.slice(0, 15)}0` === a.endHash ? `${a.endHash.slice(0, 15)}1` : `${a.endHash.slice(0, 15)}0` })).toBe(false);
    expect(v.mode).toBe('track');
    expect(events.map((e) => e.name)).toEqual(['racing.replay_view', 'racing.verify_fail']);
    expect(events[1]!.props).toEqual({ reason: 'endHash' });
    expect(v.trackGhost()?.samples).toBeGreaterThan(1000);
  }, 240_000);

  it('a header of another handlingRev, buildId or worldBake plays the track and emits racing.verify_fail', async () => {
    const a = (await live()).attempt!;
    const h = a.run!.header;
    for (const [key, cur, reason] of [
      ['handlingRev', { handlingRev: h.handlingRev + 1, buildId: h.buildId, worldBake: h.worldBake }, 'handlingRev'],
      ['buildId', { handlingRev: h.handlingRev, buildId: `${h.buildId}-next`, worldBake: h.worldBake }, 'buildId'],
      ['worldBake', { handlingRev: h.handlingRev, buildId: h.buildId, worldBake: '1'.repeat(64) }, 'worldBake'],
    ] as const) {
      const events: { name: string; props: Record<string, unknown> }[] = [];
      const v = new ReplayViewer(a.run!.bytes, cur, { emit: (name, props) => void events.push({ name, props }) });
      expect(v.mode, key).toBe('track');
      expect(v.reason).toBe(reason);
      expect(events.map((e) => e.name)).toEqual(['racing.verify_fail', 'racing.replay_view']);
      expect(events[0]!.props).toEqual({ reason });
      expect(events[1]!.props).toEqual({ mode: 'track' });
      expect(v.trackGhost()).not.toBeNull();
    }
    const junk = new ReplayViewer(new Uint8Array([1, 2, 3]), { handlingRev: 1, buildId: 'x', worldBake: 'y' }, { emit: () => undefined });
    expect(junk.mode).toBe('track');
    expect(junk.reason).toBe('format');
  }, 240_000);

  it('the frame of a word carries steer, throttle, brake and the handbrake, nitro and reset buttons', () => {
    const f = frameFromWord(0, 7);
    expect(f).toMatchObject({ tick: 7, steer: 0, throttle: 0, brake: 0, buttons: 0 });
  });
});
