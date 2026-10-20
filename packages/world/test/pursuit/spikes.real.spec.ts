/**
 * M03c AC-5 on the real sim (the engine suite proves the rule on fakes): a spike strip across the bot's lane punctures a tire of the
 * player's sedan, once, through the `VehicleDamage` component; the unit's cruisers (police) are not affected by their own strips.
 */
import { describe, expect, it } from 'vitest';
import { VehicleDamage, pursuitWorldFrom, type EcsWorld } from '@dv/engine/sim';
import { loadBake } from '../fixtures/bake.ts';
import { loadLine, startPursuitRun } from '../fixtures/pursuit-run.ts';

const bake = loadBake('synth', 'pursuit.spikes');
const suite = bake ? describe : describe.skip;

suite('AC-5: a strip on the real road', () => {
  it('a tire of the sedan that drives over the strip gets health 0, once', async () => {
    if (!bake) return;
    const line = { ...loadLine(), infractions: [] };
    const r = await startPursuitRun({ bake, line });
    const sim = r.run.runtime.sim;
    if (!sim) throw new Error('no sim');
    const api = sim.services.world.api;
    const d = r.pursuit.director();
    if (!api || !d) throw new Error('no world or director');
    const view = pursuitWorldFrom({ api, bounds: null, tags: null });
    // the lane 70 m ahead of the sedan, found on the road under that point
    const p = r.pos();
    const ahead = { x: p.x + 70, z: p.z };
    const road = api.graph.nearestEdge(ahead.x, ahead.z, p.y, 10);
    expect(road).not.toBeNull();
    const lp = view.lanePoint((road as { edge: number }).edge, (road as { s: number }).s);
    expect(lp).not.toBeNull();
    expect(d.dispatch.qaStrip(lp as { x: number; y: number; z: number; yaw: number }, sim.core.tick)).toBe(true);
    expect(d.dispatch.activeStrips).toHaveLength(1);

    const ecs = sim.ecs as unknown as EcsWorld;
    const tires = (): number[] => {
      const id = ecs.resolve(r.vehicle()) as number;
      const dmg = ecs.store(VehicleDamage);
      return [0, 1, 2, 3].map((k) => (dmg.tires[k] as Float32Array)[id] as number);
    };
    expect(tires()).toEqual([1, 1, 1, 1]);
    for (let i = 0; i < 600; i++) await r.tick();
    const after = tires();
    expect(after.some((h) => h === 0)).toBe(true);
    expect(d.dispatch.punctures).toBeGreaterThan(0);
    expect(d.dispatch.punctures).toBeLessThanOrEqual(4);
    const n = d.dispatch.punctures;
    for (let i = 0; i < 120; i++) await r.tick();
    expect(d.dispatch.punctures).toBe(n);
    r.dispose();
  }, 240_000);
});
