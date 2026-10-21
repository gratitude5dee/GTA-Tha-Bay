import { weekdayOf, type EntityHandle, type ModeContext } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { HALF_SECONDS_PER_DAY, installClock } from '../../src/sim/index.ts';
import { INTERACT_KIND } from '../../src/sim/interaction/kinds.ts';
import { createModesModule } from '../../src/sim/modes/index.ts';
import type { EntityPrefabDef } from '../../src/sim/index.ts';
import type { SimModuleContext, SimRuntime } from '../../src/sim/runtime.ts';
import { createVehicleWorld, drive, type VehicleWorld } from '../vehicle-sim.ts';

function def(id: string, kind: keyof typeof INTERACT_KIND, o: { priority?: number } = {}): EntityPrefabDef {
  return {
    id, kind: 'marker', version: 1, render: { asset: 'prop/graybox.marker' }, physics: null, components: { Transform: { qw: 1 } },
    interact: { kind, radius: 2.5, promptKey: `interact.${id}`, coneDeg: 100, priority: o.priority ?? 0 },
  };
}

/** A player at the origin facing north, the modes module on it, and a started `sandbox` whose context we return. */
async function booted(): Promise<{ w: VehicleWorld; ctx: ModeContext }> {
  const w = await createVehicleWorld({ prefab: null, playerAt: [0, 0, 0], playerYaw: 0 });
  installClock(w.sim.core);
  w.mod.interaction.register({ kind: INTERACT_KIND.Talk, canInteract: () => true, begin: () => undefined });
  const modes = createModesModule();
  for (const d of modes.systems) w.sim.core.addSystem(d);
  const runtime = { env: { qa: true, modules: [] as never[] }, saveControl: null, transport: { postEvent: () => true } } as unknown as SimRuntime;
  await modes.onInit?.({ sim: w.sim, cfg: w.sim.core.cfg, boot: { strings: [], prefabs: [], config: {} }, runtime, ports: {} } as SimModuleContext);
  modes.command({ t: 'mode.start', id: 'sandbox' });
  drive(w, 1);
  await Promise.resolve();
  await Promise.resolve();
  drive(w, 2);
  const ctx = modes.host()?.stack.root?.ctx;
  if (!ctx) throw new Error('sandbox did not start');
  return { w, ctx };
}

const at = (dist: number, angleDeg: number): { pos: [number, number, number]; yaw: number } => {
  const a = (angleDeg * Math.PI) / 180;
  return { pos: [dist * Math.sin(a), 0, -dist * Math.cos(a)], yaw: 0 };
};

/** AC-8: `engine/interaction.scoring` and the clock rules through the ModeContext. */
describe('interaction through ModeContext (M03a1 service, C06 score)', () => {
  it('scores priority x 10 - distance - angle / 45, ties by handle', async () => {
    const { w, ctx } = await booted();
    w.mod.prefabs.load([def('talk.a', 'Talk'), def('talk.b', 'Talk'), def('talk.c', 'Talk', { priority: 1 })]);
    const a = w.mod.prefabs.spawn('talk.a', at(1.0, 0));       // score -1
    const b = w.mod.prefabs.spawn('talk.b', at(2.0, 40));      // score -2 - 0.89
    drive(w, 3);
    expect(ctx.interaction.current()?.target).toBe(a);
    const c = w.mod.prefabs.spawn('talk.c', at(2.4, 10));      // score 10 - 2.4 - 0.22
    drive(w, 3);
    expect(ctx.interaction.current()?.target).toBe(c);
    w.mod.prefabs.despawn(c);
    w.mod.prefabs.despawn(a);
    drive(w, 3);
    expect(ctx.interaction.current()?.target).toBe(b);
    const t1 = w.mod.prefabs.spawn('talk.a', at(1.5, 20)) as EntityHandle;
    const t2 = w.mod.prefabs.spawn('talk.a', at(1.5, 20)) as EntityHandle;
    w.mod.prefabs.despawn(b);
    drive(w, 3);
    expect(t1).toBeLessThan(t2);
    expect(ctx.interaction.current()?.target).toBe(t1);
    w.sim.dispose();
  });

  it('the clock in the context: a day is 172,800 half-seconds at 30 game seconds per real second, locks hold, weather draws use only the weather stream', async () => {
    const { w, ctx } = await booted();
    expect(HALF_SECONDS_PER_DAY).toBe(172_800);
    expect(weekdayOf(0)).toBe(0);
    expect(ctx.clock.now().rate).toBe(1);
    const t0 = ctx.clock.now().t;
    w.sim.step(60);                                  // one real second
    expect(ctx.clock.now().t - t0).toBe(60);         // 60 half-seconds = 30 game seconds
    ctx.clock.lock('m.test', 21, 'rain');
    const hour = ctx.clock.env().hour;
    w.sim.step(120);
    expect(ctx.clock.env().hour).toBe(hour);
    expect(ctx.clock.env().weather).toBe('rain');
    ctx.clock.unlock('m.other');
    expect(ctx.clock.now().lockedBy).toBe('m.test');
    ctx.clock.unlock('m.test');
    expect(ctx.clock.now().lockedBy).toBeNull();
    w.sim.step(1);
    expect(ctx.clock.now().t).toBeGreaterThan(t0 + 60);
    const streams = w.sim.services.rng.states().map((s) => s.name);
    expect(streams.filter((n) => !n.startsWith('mode:'))).toEqual(['weather']);
    w.sim.dispose();
  });
});
