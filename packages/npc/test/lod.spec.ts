import { describe, expect, it } from 'vitest';
import { LOD } from '../src/brains/agent.ts';
import { BRAIN_CONFIG, lodCap } from '../src/brains/config.ts';
import { assignLod } from '../src/brains/lod-system.ts';
import { NpcAgent } from '../src/brains/agent.ts';
import { BrainSim } from '../src/brains/sim.ts';
import { HOUR, SEED, cast, homeOf, makeSoul, placeAt, run, scheduleOf, workOf, world } from './brain-fixtures.ts';
import type { ScheduleBlock } from '@dv/shared/contracts/c10-npc';

const at = (h: number, m = 0): number => h * HOUR + m * 120;

function agentAt(i: number, x: number, z: number): NpcAgent {
  const a = new NpcAgent(makeSoul(`npc_${i}`, scheduleOf(i)));
  a.slot = i;
  a.x = x;
  a.z = z;
  a.placed = true;
  return a;
}

describe('NpcLodSystem (AC-2)', () => {
  it('puts NPCs at A within 60 m, B within 250 m and C beyond', () => {
    const agents = [agentAt(0, 30, 0), agentAt(1, 120, 0), agentAt(2, 400, 0)];
    const counts = assignLod(agents, { x: 0, z: 0 }, 8, BRAIN_CONFIG);
    expect(agents.map((a) => a.lod)).toEqual([LOD.A, LOD.B, LOD.C]);
    expect(counts).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('widens the A radius for an NPC that is already inside, so a boundary does not flap', () => {
    const a = agentAt(0, 62, 0);
    a.lod = LOD.A;
    assignLod([a], { x: 0, z: 0 }, 8, BRAIN_CONFIG);
    expect(a.lod).toBe(LOD.A);
    const b = agentAt(1, 62, 0);
    b.lod = LOD.B;
    assignLod([b], { x: 0, z: 0 }, 8, BRAIN_CONFIG);
    expect(b.lod).toBe(LOD.B);
    const far = agentAt(2, 70, 0);
    far.lod = LOD.A;
    assignLod([far], { x: 0, z: 0 }, 8, BRAIN_CONFIG);
    expect(far.lod).toBe(LOD.B);
  });

  it('keeps the nearest NPCs at A when the tier cap is lower than the crowd, ties by slot', () => {
    const agents = Array.from({ length: 8 }, (_, i) => agentAt(i, 10 + i * 5, 0));
    const counts = assignLod(agents, { x: 0, z: 0 }, 3, BRAIN_CONFIG);
    expect(counts.a).toBe(3);
    expect(agents.filter((a) => a.lod === LOD.A).map((a) => a.slot)).toEqual([0, 1, 2]);
    expect(agents.filter((a) => a.lod === LOD.B)).toHaveLength(5);
  });

  it('simulates nothing without a player, and nothing for a killed NPC', () => {
    const agents = [agentAt(0, 10, 0), agentAt(1, 20, 0)];
    (agents[1] as NpcAgent).enabled = false;
    assignLod(agents, null, 8, BRAIN_CONFIG);
    expect(agents.every((a) => a.lod === LOD.C)).toBe(true);
    const counts = assignLod(agents, { x: 0, z: 0 }, 8, BRAIN_CONFIG);
    expect(counts).toEqual({ a: 1, b: 0, c: 0 });
  });

  it('reads the per-tier caps of config/npc.json', () => {
    expect(lodCap('desktop')).toBe(8);
    expect(lodCap('desktop-ultra')).toBe(8);
    expect(lodCap('xr-visionpro')).toBe(8);
    expect(lodCap('xr-quest')).toBe(6);
    expect(lodCap('mobile')).toBe(4);
    expect(lodCap('mobile-low')).toBe(3);
    expect(lodCap('unheard-of')).toBe(3);
  });
});

describe('brain cost by LOD (AC-2)', () => {
  it('runs 0 brain ticks for an NPC at LOD C while whereIs still answers', () => {
    // the player is 5 km away: every NPC is at C
    const r = run(cast(12), { startT: at(8), ticks: 1200, player: () => ({ x: 5000, y: 0, z: 5000 }) });
    expect(r.sim.counts).toEqual({ a: 0, b: 0, c: 12 });
    for (const a of r.sim.agents) {
      expect(a.aSteps).toBe(0);
      expect(a.bSteps).toBe(0);
    }
    expect(r.sim.totalSteps).toEqual({ a: 0, b: 0 });
    for (let i = 0; i < 12; i++) {
      const w = r.sim.whereIs(`npc_${String(i).padStart(2, '0')}`, at(8) + 1200);
      expect(w?.pos).toEqual(placeAt(workOf(i)));
      expect(w?.activity).toMatch(/work|patrol/);
    }
  });

  it('steps LOD A at 10 Hz and LOD B at 2 Hz', () => {
    const near = makeSoul('npc_00', scheduleOf(0));
    const mid = makeSoul('npc_01', scheduleOf(1));
    // the player stands at the origin; npc_00 works at (0, 70): B is more than 60 m away... use an explicit placement
    const r = run([near, mid], {
      startT: at(8),
      ticks: 600,
      player: () => ({ x: 0, y: 0, z: 40 }),
    });
    const a = r.sim.get('npc_00');
    const b = r.sim.get('npc_01');
    // npc_00 at (0,70): 30 m from the player (A); npc_01 at (14,70): also A. Move the player to make one B
    expect(a?.lod).toBe(LOD.A);
    expect(b?.lod).toBe(LOD.A);
    // 300 AI steps / 3 = 100 steps in 600 ticks; the first LOD pass runs at tick 0 so no step is lost
    expect(a?.aSteps).toBeGreaterThanOrEqual(98);
    expect(a?.aSteps).toBeLessThanOrEqual(101);

    const r2 = run([near], { startT: at(8), ticks: 600, player: () => ({ x: 0, y: 0, z: 200 }) });
    const c = r2.sim.get('npc_00');
    expect(c?.lod).toBe(LOD.B);
    // 300 AI steps / 15 = 20 steps
    expect(c?.bSteps).toBeGreaterThanOrEqual(19);
    expect(c?.bSteps).toBeLessThanOrEqual(21);
    expect(c?.aSteps).toBe(0);
  });

  it('never runs more A brains than the tier cap, and reports the peak', () => {
    for (const cap of [3, 4, 6, 8]) {
      const r = run(cast(12), { startT: at(8), ticks: 600, cap, player: () => ({ x: 70, y: 0, z: 40 }) });
      expect(r.sim.peakA).toBeLessThanOrEqual(cap);
      expect(r.sim.counts.a).toBeLessThanOrEqual(cap);
      // seven of the twelve stand within 60 m of the player at (70, 40)
      expect(r.sim.peakA).toBe(Math.min(cap, 7));
      expect(r.sim.counts.a + r.sim.counts.b + r.sim.counts.c).toBe(12);
    }
  });
});

describe('schedule movement', () => {
  it('walks the commute and arrives at work', () => {
    // 06:50 to 07:10: the commute ends at 07:00, then the NPC works at its desk
    const r = run([makeSoul('npc_00', scheduleOf(0))], { startT: at(6, 50), ticks: 20 * 120, player: () => ({ x: 0, y: 0, z: 40 }) });
    const a = r.sim.get('npc_00');
    const [wx, , wz] = placeAt(workOf(0)) ?? [0, 0, 0];
    expect(Math.abs((a?.x ?? 99) - wx)).toBeLessThan(2);
    expect(Math.abs((a?.z ?? 99) - wz)).toBeLessThan(2);
    expect(a?.block).toBe(2);
  });

  it('answers the zero-cost position across midnight at the block edges', () => {
    const sim = new BrainSim({ seed: SEED, world, cap: 8 });
    const schedule: ScheduleBlock[] = [
      { days: 'daily', from: '08:00', to: '23:30', activity: 'work', place: workOf(1) as ScheduleBlock['place'], interruptible: true, priority: 5 },
      { days: 'daily', from: '23:30', to: '00:30', activity: 'commute', place: homeOf(1) as ScheduleBlock['place'], interruptible: true, priority: 4 },
      { days: 'daily', from: '00:30', to: '08:00', activity: 'sleep', place: homeOf(1) as ScheduleBlock['place'], interruptible: false, priority: 9 },
    ];
    sim.add(makeSoul('night_owl', schedule));
    const day = 172800 * 2;
    const work = placeAt(workOf(1)) as number[];
    const home = placeAt(homeOf(1)) as number[];
    expect(sim.whereIs('night_owl', day + at(23, 29))?.pos).toEqual(work);
    const mid = sim.whereIs('night_owl', day + 172800 + 0)?.pos as number[];
    expect(mid[2]).toBeCloseTo(((work[2] as number) + (home[2] as number)) / 2, 5);
    expect(sim.whereIs('night_owl', day + 172800 + at(0, 30))?.pos).toEqual(home);
    expect(sim.whereIs('missing', 0)).toBeNull();
  });

  it('removes a killed NPC from the world and gives it back', () => {
    const r = run(cast(2), { startT: at(8), ticks: 120 });
    r.sim.setEnabled('npc_00', false);
    expect(r.sim.whereIs('npc_00', at(8))).toBeNull();
    expect(r.sim.get('npc_00')?.enabled).toBe(false);
    r.sim.setEnabled('npc_00', true);
    expect(r.sim.whereIs('npc_00', at(8))).not.toBeNull();
  });
});
