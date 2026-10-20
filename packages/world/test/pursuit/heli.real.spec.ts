/**
 * M03c on the real sim: at heat 4 a helicopter spawns, climbs to its orbit altitude over the player and its spotlight sees the player
 * with a clear ray; units and the helicopter all stand on loaded ground or in the air, none falls through the world.
 */
import type { StableKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { Transform, type EcsWorld } from '@dv/engine/sim';
import { loadBake } from '../fixtures/bake.ts';
import { loadLine, startPursuitRun } from '../fixtures/pursuit-run.ts';

const bake = loadBake('synth', 'pursuit.heli');
const suite = bake ? describe : describe.skip;

suite('level 4 on the real sim', () => {
  it('the helicopter orbits over the player at altitude and no unit falls below the ground', async () => {
    if (!bake) return;
    const line = { ...loadLine(), infractions: [] };
    const r = await startPursuitRun({ bake, line });
    const sim = r.run.runtime.sim;
    const d = r.pursuit.director();
    if (!sim || !d) throw new Error('no sim');
    d.forceHeat(4);
    // hold the car still so the helicopter has a fixed point to circle
    r.run.runtime.bot = { device: 'bot', frame: () => ({ tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 127, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 }) };
    for (let i = 0; i < 1500; i++) await r.run.step(1);
    const heli = d.dispatch.units.find((u) => u.role === 'heli');
    expect(heli).toBeDefined();
    const ecs = sim.ecs as unknown as EcsWorld;
    const tr = ecs.store(Transform);
    const hid = ecs.resolve(ecs.byKey(heli?.key as StableKey)) as number;
    const me = r.pos();
    const dh = Math.hypot((tr.px[hid] as number) - me.x, (tr.pz[hid] as number) - me.z);
    const alt = (tr.py[hid] as number) - me.y;
    expect(dh).toBeLessThan(80);
    expect(alt).toBeGreaterThan(35);
    expect(alt).toBeLessThan(75);
    expect(d.dispatch.units.some((u) => u.role === 'heli' && u.sees)).toBe(true);
    // nothing fell: every unit is above the sedan's ground level minus a margin
    for (const u of d.dispatch.units) {
      const id = ecs.resolve(ecs.byKey(u.key as StableKey)) as number | null;
      if (id === null) continue;
      expect(tr.py[id] as number).toBeGreaterThan(me.y - 30);
    }
    r.dispose();
  }, 240_000);
});
