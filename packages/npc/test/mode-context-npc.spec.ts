import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JsonValue, KillScope, SimEvent } from '@dv/shared';
import type { InkKnot, ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import { SubtitleLane } from '../src/barks/subtitle-lane.ts';
import { BRAIN_CONFIG, SIM_HZ } from '../src/brains/config.ts';
import { KnotPlayer, createModeNpcApi, type KnotSource } from '../src/brains/mode-context-npc.ts';
import { BrainSim } from '../src/brains/sim.ts';
import { InkRunner } from '../src/ink/ink-runner.ts';
import { HOUR, SEED, makeSoul, placeAt, workOf, world } from './brain-fixtures.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const inkOf = (id: string): string => fs.readFileSync(path.join(ROOT, `assets/src/data/ink.${id}/ink.json`), 'utf8');

async function setup() {
  const runner = await InkRunner.create(inkOf('npc_test'));
  const source: KnotSource = {
    lines: (owner, knot) => (owner === 'npc_test' ? runner.play(knot as InkKnot).map((l) => ({ text: l.text, speaker: owner })) : null),
  };
  const sim = new BrainSim({ seed: SEED, world, cap: 8 });
  const sched: ScheduleBlock[] = [{ days: 'daily', from: '00:00', to: '24:00', activity: 'idle', place: workOf(2) as ScheduleBlock['place'], interruptible: true, priority: 1 }];
  sim.add(makeSoul('npc_test', sched));
  const patches: { tick: number; v: JsonValue | null }[] = [];
  let tick = 0;
  const lane = new SubtitleLane({ patch: (_k, v) => void patches.push({ tick, v }) });
  const events: SimEvent[] = [];
  const knots = new KnotPlayer({
    source,
    lane,
    cfg: BRAIN_CONFIG.barks,
    events: { emit: (e) => void events.push(e) },
    lock: (id, on) => sim.lock(id, on),
  });
  const killed = new Map<string, KillScope[]>();
  const api = createModeNpcApi({ sim, knots, clockT: () => 12 * HOUR, killed: (id) => killed.get(id) ?? [] });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      tick++;
      lane.update(tick);
      knots.update(tick);
    }
  };
  return { api, sim, patches, events, killed, run, now: () => tick };
}

describe('ModeContext.npc (AC-7)', () => {
  it('plays a knot offline as hud.subtitle patches and fires npc.knot.done once with the play id', async () => {
    const s = await setup();
    s.api.playKnot('npc_test', 'greeting', 'p1');
    // the NPC is busy while its knot plays
    expect(s.sim.get('npc_test')?.busy).toBe(true);
    s.run(10 * SIM_HZ);
    const shown = s.patches.filter((p) => p.v !== null).map((p) => p.v as { speaker: string; text: string });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.text).toBe('Good day. Please confirm the lot is clear.');
    expect(shown[0]?.speaker).toBe('npc_test');
    const done = s.events.filter((e) => e.t === 'npc.knot.done');
    expect(done).toHaveLength(1);
    expect(done[0]?.s).toBe('p1');
    // the subtitle was cleared after its time, before or when the knot finished
    expect(s.patches[s.patches.length - 1]?.v).toBeNull();
    expect(s.sim.get('npc_test')?.busy).toBe(false);
    // and it never fires again
    s.run(10 * SIM_HZ);
    expect(s.events.filter((e) => e.t === 'npc.knot.done')).toHaveLength(1);
  });

  it('shows each line for at least 1.5 s and 0.06 s per character', async () => {
    const s = await setup();
    s.api.playKnot('npc_test', 'deflect', 'p2');
    s.run(10 * SIM_HZ);
    const v = s.patches.find((p) => p.v !== null)?.v as { text: string; startMs: number; endMs: number };
    expect(v.endMs - v.startMs).toBeGreaterThanOrEqual(Math.max(1500, 60 * v.text.length) - 20);
  });

  it('plays two knots in order and reports each', async () => {
    const s = await setup();
    s.api.playKnot('npc_test', 'greeting', 'a');
    s.api.playKnot('npc_test', 'farewell', 'b');
    s.run(20 * SIM_HZ);
    expect(s.events.filter((e) => e.t === 'npc.knot.done').map((e) => e.s)).toEqual(['a', 'b']);
    expect(s.patches.filter((p) => p.v !== null).map((p) => (p.v as { text: string }).text)).toEqual([
      'Good day. Please confirm the lot is clear.',
      'Checklist complete. Good day.',
    ]);
  });

  it('finishes a knot of an NPC the runtime does not know without a subtitle', async () => {
    const s = await setup();
    s.api.playKnot('stranger', 'greeting', 'p3');
    s.run(5);
    expect(s.patches).toHaveLength(0);
    expect(s.events.map((e) => e.s)).toEqual(['p3']);
  });

  it('answers isKilled from the roster flags, by scope, with all covering every scope', async () => {
    const s = await setup();
    expect(s.api.isKilled('npc_test', 'spawn')).toBe(false);
    s.killed.set('npc_test', ['fighter']);
    expect(s.api.isKilled('npc_test', 'fighter')).toBe(true);
    expect(s.api.isKilled('npc_test', 'spawn')).toBe(false);
    s.killed.set('npc_test', ['all']);
    for (const scope of ['all', 'spawn', 'fighter', 'cutscene', 'voice', 'marketing', 'ugc'] as const) expect(s.api.isKilled('npc_test', scope)).toBe(true);
    expect(s.api.isKilled('npc:npc_test', 'cutscene')).toBe(true);
    expect(s.api.isKilled('someone_else', 'all')).toBe(false);
  });

  it('answers whereIs from the schedule, with or without the npc: prefix, and null for an unknown NPC', async () => {
    const s = await setup();
    const w = s.api.whereIs('npc_test');
    expect(w?.pos).toEqual(placeAt(workOf(2)));
    expect(w?.activity).toBe('idle');
    expect(s.api.whereIs('npc:npc_test')?.pos).toEqual(placeAt(workOf(2)));
    expect(s.api.whereIs('nobody')).toBeNull();
  });
});
