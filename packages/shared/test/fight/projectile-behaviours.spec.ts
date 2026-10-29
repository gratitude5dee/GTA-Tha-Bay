// M08b1 AC-6 (projectiles): sine, arc, orbit, summon and the clash rule, on the committed kits.
import { describe, expect, it } from 'vitest';
import { FF, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from '../../src/fight/buffer.ts';
import { SINE64, spawnProjectile } from '../../src/fight/projectiles.ts';
import { St } from '../../src/fight/states.ts';
import { idle, place, setWord, word } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { duel } from './roster-pack.ts';

interface P { idx: number; owner: number; def: number; x: number; y: number; frame: number; life: number }
function live(r: Rig): P[] {
  const out: P[] = [];
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((r.buf[b + PW.Owner] as number) === 0) continue;
    out.push({ idx: p, owner: r.buf[b + PW.Owner] as number, def: r.buf[b + PW.Def] as number, x: r.buf[b + PW.X] as number, y: r.buf[b + PW.Y] as number, frame: r.buf[b + PW.Frame] as number, life: r.buf[b + PW.Life] as number });
  }
  return out;
}
const projIdx = (r: Rig, slot: 0 | 1, id: string): number => {
  const k = slot === 0 ? r.sim.c.kit[0] : r.sim.c.kit[1];
  const i = k.projs.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`no projectile ${id}`);
  return i;
};
/** The opponent lies far away on the floor: nothing the owner fires can touch it. */
function farTarget(r: Rig): void {
  place(r, -5000, 5900);
  setWord(r, 1, FF.State, St.Knockdown);
  setWord(r, 1, FF.WakeFrames, 100000);
}

describe('sine (Slang Wave)', () => {
  it('follows y = origin + SINE64[(frame * 64 / period) & 63] * amp / 127, one period per 56 frames', () => {
    const r = duel('RAP_HYPHY_ELDER', 'TECH_HACKER');
    farTarget(r);
    spawnProjectile(r.sim.c, r.buf, 0, projIdx(r, 0, 'slang'), false, 700, 1100);
    const y0 = (live(r)[0] as P).y;
    let maxUp = 0, maxDown = 0;
    for (let f = 1; f <= 56; f++) {
      idle(r, 1);
      const p = live(r)[0] as P;
      expect(p.frame).toBe(f);
      expect(p.y - y0).toBe(Math.trunc(((SINE64[Math.trunc((f * 64) / 56) & 63] as number) * 380) / 127));
      maxUp = Math.max(maxUp, p.y - y0); maxDown = Math.min(maxDown, p.y - y0);
    }
    expect(maxUp).toBeGreaterThan(300);
    expect(maxDown).toBeLessThan(-300);
    expect(Math.abs((live(r)[0] as P).y - y0)).toBeLessThan(40);   // back near the origin after a full period
  });
  it('SINE64 is a 64-step sine table scaled to 127', () => {
    expect(SINE64.length).toBe(64);
    expect(SINE64[0]).toBe(0);
    expect(SINE64[16]).toBe(127);
    expect(SINE64[48]).toBe(-127);
    expect(SINE64[32]).toBe(0);
  });
});

describe('arc (Arc Shot, Lob Cover)', () => {
  it('rises, comes down on the ground ahead of the shooter and is removed', () => {
    const r = duel('ATH_SHOOTER', 'TECH_HACKER');
    farTarget(r);
    setWord(r, 0, FF.X, -5000);
    spawnProjectile(r.sim.c, r.buf, 0, projIdx(r, 0, 'arc1'), false, 600, 1300);
    let peak = 0, last: P | undefined;
    for (let i = 0; i < 100 && live(r).length > 0; i++) {
      last = live(r)[0];
      peak = Math.max(peak, last?.y ?? 0);
      idle(r, 1);
    }
    expect(live(r)).toHaveLength(0);
    expect(peak).toBeGreaterThan(1400);
    const dist = ((last as P).x) - (-5000);
    expect(dist).toBeGreaterThan(2000);
    expect(dist).toBeLessThan(3200);
  });
  it('the lob is steep and short', () => {
    const r = duel('ATH_SHOOTER', 'TECH_HACKER');
    farTarget(r);
    spawnProjectile(r.sim.c, r.buf, 0, projIdx(r, 0, 'lob'), false, 450, 1200);
    let peak = 0, lastX = 0;
    for (let i = 0; i < 100 && live(r).length > 0; i++) { const p = live(r)[0] as P; peak = Math.max(peak, p.y); lastX = p.x; idle(r, 1); }
    expect(peak).toBeGreaterThan(2000);
    expect(lastX - (-5000 + 450)).toBeLessThan(900);
  });
});

describe('orbit (Dispatch Agent drones)', () => {
  it('keeps at most two drones, circling the owner within the orbit radius, half a turn apart', () => {
    const r = duel('TECH_VISIONARY', 'ATH_POWER_BACK');
    farTarget(r);
    const agent = projIdx(r, 0, 'agent');
    for (let i = 0; i < 3; i++) { spawnProjectile(r.sim.c, r.buf, 0, agent, false, 0, 0); idle(r, 1); }
    const drones = live(r).filter((p) => p.def === agent);
    expect(drones).toHaveLength(2);
    idle(r, 40);
    const ds = live(r).filter((p) => p.def === agent);
    const ox = word(r, 0, FF.X);
    for (const d of ds) {
      expect(Math.abs(d.x - ox)).toBeLessThanOrEqual(650);
      expect(d.y).toBeGreaterThan(900);
      expect(d.y).toBeLessThan(2200);
    }
    expect(Math.abs((ds[0] as P).x - (ds[1] as P).x)).toBeGreaterThan(200);
  });
  it('fires its child shot first at frame 24 and then every 48 frames', () => {
    const r = duel('TECH_VISIONARY', 'ATH_POWER_BACK');
    farTarget(r);
    const agent = projIdx(r, 0, 'agent'), shot = projIdx(r, 0, 'agentShot');
    spawnProjectile(r.sim.c, r.buf, 0, agent, false, 0, 0);
    const shots: number[] = [];
    for (let f = 1; f <= 130; f++) {
      idle(r, 1);
      for (const p of live(r)) if (p.def === shot && p.frame === 0) shots.push(f);
    }
    const uniq = shots;
    expect(uniq.slice(0, 3)).toEqual([24, 72, 120]);
  });
  it('Recall returns the drones', () => {
    const r = duel('TECH_VISIONARY', 'ATH_POWER_BACK');
    farTarget(r);
    spawnProjectile(r.sim.c, r.buf, 0, projIdx(r, 0, 'agent'), false, 0, 0);
    idle(r, 5);
    expect(live(r).length).toBe(1);
    spawnProjectile(r.sim.c, r.buf, 0, projIdx(r, 0, 'agent:trigger'), false, 0, 0);
    expect(live(r).length).toBe(0);
  });
});

describe('summon (Roadmap Rush crew)', () => {
  it('keeps one crew member, plays its list every 24 frames from frame 18 and leaves after 150', () => {
    const r = duel('TECH_VISIONARY', 'ATH_POWER_BACK');
    farTarget(r);
    const crew = projIdx(r, 0, 'crew'), shot = projIdx(r, 0, 'crewShot');
    spawnProjectile(r.sim.c, r.buf, 0, crew, false, 350, 800);
    spawnProjectile(r.sim.c, r.buf, 0, crew, false, 350, 800);
    expect(live(r).filter((p) => p.def === crew)).toHaveLength(1);
    let fired = 0;
    for (let f = 1; f <= 160; f++) {
      idle(r, 1);
      for (const p of live(r)) if (p.def === shot && p.frame === 0) fired++;
    }
    expect(fired).toBeGreaterThanOrEqual(5);
    expect(fired).toBeLessThanOrEqual(6);
    expect(live(r).filter((p) => p.def === crew)).toHaveLength(0);
  });
});

describe('clash', () => {
  it('equal power destroys both; the higher power survives', () => {
    const r = duel('TECH_HACKER', 'TECH_HACKER');
    place(r, -1000, 1000);
    const echo = projIdx(r, 0, 'echo');
    spawnProjectile(r.sim.c, r.buf, 0, echo, false, 700, 1100);
    spawnProjectile(r.sim.c, r.buf, 1, echo, false, 700, 1100);
    idle(r, 12);
    expect(live(r)).toHaveLength(0);
    const q = duel('TECH_HACKER', 'TECH_HACKER');
    place(q, -1000, 1000);
    spawnProjectile(q.sim.c, q.buf, 0, echo, true, 700, 1100);    // EX: power 2
    spawnProjectile(q.sim.c, q.buf, 1, echo, false, 700, 1100);   // power 1
    idle(q, 12);
    expect(live(q).map((p) => p.owner)).toEqual([1]);
  });
});
