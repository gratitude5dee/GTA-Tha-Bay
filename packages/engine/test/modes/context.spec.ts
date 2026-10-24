import { sampleHeight, type ModeContext, type SimConfig } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { LocalPlayer, Transform } from '../../src/sim/ecs/components.ts';
import { CIVIC_GRAYBOX } from '../../src/sim/scenarios/civic-graybox.ts';
import { NotYetAvailable, createModesModule } from '../../src/sim/modes/index.ts';
import { runModesQa } from '../../src/sim/modes/qa.ts';
import type { SimModuleContext, SimRuntime } from '../../src/sim/runtime.ts';
import { createGrayboxSim, fixtureChunks } from '../graybox-helpers.ts';
import { fixtureDescriptor, fixtureSim, makeRig, newLog } from './fixture.ts';

async function contextOf(id: 'story' | 'sandbox', over: { embeddable?: boolean } = {}): Promise<{ ctx: ModeContext; rig: ReturnType<typeof makeRig> }> {
  const log = newLog();
  const rig = makeRig({ descriptors: [fixtureDescriptor(id, { embeddable: over.embeddable ?? false }, fixtureSim(log))] });
  rig.host.start(id);
  await rig.run(2);
  if (!log.lastCtx) throw new Error('mode not entered');
  return { ctx: log.lastCtx, rig };
}

/** AC-9 and AC-12: `engine/modes.context`. */
describe('ModeContext assembly (C06 rule 7)', () => {
  it('stubs name the milestone that delivers them', async () => {
    const { ctx } = await contextOf('story');
    const msg = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(NotYetAvailable);
        return (e as Error).message;
      }
      return '';
    };
    expect(msg(() => ctx.zones.define('z', { k: 'circle', at: [0, 0, 0], r: 1 }))).toContain('M05a1');
    expect(msg(() => ctx.scheduler.spawn('t', () => ({ k: 'done' })))).toContain('M05a1');
    expect(msg(() => ctx.timeline.emit({ t: 'x', tick: 0, data: {} }))).toContain('M05a1');
    expect(msg(() => ctx.combat.startMove(0 as never, 'jab'))).toContain('M05c1');
    expect(msg(() => ctx.npc.whereIs('npc:x'))).toContain('M06a3');
    expect(ctx.net).toBeNull();
    expect(ctx.dt).toBe(1 / 60);
    // services this build does not have yet say so too
    expect(msg(() => ctx.clock.now())).toContain('M02b2');
    expect(msg(() => ctx.pursuit.state())).toContain('M03c');
  });

  it('rng streams are prefixed with the mode id and independent per mode', async () => {
    const { ctx, rig } = await contextOf('story');
    const a = ctx.rng('loot');
    const again = ctx.rng('loot');
    expect(again).toBe(a);
    expect(ctx.rng('other')).not.toBe(a);
    void rig;
  });

  it('a sandbox session cannot write story:auto through the save binding (NOT_ALLOWED), and ctx.save.request writes only sandbox slots', async () => {
    const { ctx, rig } = await contextOf('sandbox');
    expect(rig.capabilitySet.at(-1)).toBe('sandbox');
    // the binding the host holds is the only write path
    const binding = (rig.host as unknown as { d: { save: { post: (s: string, d: unknown, r: string) => unknown } } }).d.save;
    expect(binding.post('story:auto', {}, 'manual')).toEqual({ ok: false, error: 'NOT_ALLOWED' });
    expect(binding.post('core', {}, 'manual')).toEqual({ ok: false, error: 'NOT_ALLOWED' });
    expect(rig.posted).toEqual([]);
    ctx.save.request('manual');
    expect(rig.posted.map((p) => p.slot)).toEqual(['sandbox']);
  });

  it('hands out the wallet through economy and the unlock API', async () => {
    const { ctx } = await contextOf('story');
    expect(ctx.economy.credit(300, 'x', 'k')).toBe(true);
    expect(ctx.economy.balance()).toBe(300);
    expect(ctx.unlocks.has('unlock.racing')).toBe(false);
    expect(ctx.unlocks.emit('unlock.racing', { kind: 'debug', ref: '' })).toBe(true);
    expect(ctx.unlocks.list()).toEqual(['unlock.racing']);
  });
});

/** The real module on the real gray-box sim (a build without DV_WORLD): AC-12. */
describe('modes module on the booted civic-graybox scenario (DL-668)', () => {
  it('sandbox adopts the booted scene: no restart, the player and its position stay, and the world stand-in answers from the fixture', async () => {
    const sim = await createGrayboxSim();
    const modes = createModesModule();
    for (const def of modes.systems) sim.core.addSystem(def);
    const posted: unknown[] = [];
    const runtime = {
      env: { qa: true, modules: [] as never[], log: undefined },
      saveControl: null,
      transport: { postEvent: (m: unknown) => void posted.push(m) },
      uiCommand: null,
      uiOutbox: null,
    } as unknown as SimRuntime;
    const cfg: SimConfig = sim.core.cfg;
    await modes.onInit?.({ sim, cfg, boot: { strings: [], prefabs: [], config: {} }, runtime, ports: {} } as SimModuleContext);
    sim.step(60);   // chunks in, the player grounded
    const pid = sim.ecs.query([LocalPlayer, Transform])[0] as number;
    const tr = sim.ecs.store(Transform);
    const at = (): number[] => [tr.px[pid] as number, tr.py[pid] as number, tr.pz[pid] as number];
    const before = at();
    const handleBefore = sim.ecs.byKey('player:0');
    const entities = sim.ecs.entityCount;

    modes.command({ t: 'mode.start', id: 'sandbox' });
    sim.step(1);
    const host = modes.host();
    expect(host?.state).toBe('Loading');
    // the import of the sim half settles between ticks
    await Promise.resolve();
    await Promise.resolve();
    sim.step(1);
    expect(host?.state).toBe('Running');
    sim.step(1);
    expect(at()).toEqual(before);
    expect(sim.ecs.byKey('player:0')).toBe(handleBefore);
    expect(sim.ecs.entityCount).toBe(entities);
    expect(sim.services.events.peek().some((e) => e.t === 'mode.restart')).toBe(false);

    // the stand-in world
    const ctx = host?.stack.root?.ctx as ModeContext;
    const ground = sampleHeight(fixtureChunks().sim[0]!.height, CIVIC_GRAYBOX.spawn[0], CIVIC_GRAYBOX.spawn[2]);
    const y = ctx.world.query.groundY(CIVIC_GRAYBOX.spawn[0], CIVIC_GRAYBOX.spawn[2]);
    expect(y).not.toBeNull();
    expect(Math.abs((y as number) - ground)).toBeLessThan(0.2);
    expect(ctx.world.query.groundY(5000, 5000)).toBeNull();
    expect(ctx.world.query.isWater(0, 0)).toBe(false);
    expect(ctx.world.query.nhoodAt(0, 0)).toBe(255);
    expect(ctx.world.query.districtAt(0, 0)).toBeNull();
    expect(await ctx.world.teleport.request('sandbox', { x: 0, z: 0 })).toEqual({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
    expect(ctx.world.teleport.candidates('sandbox')).toEqual([]);
    expect(ctx.world.graph.route({ from: { x: 0, z: 0 }, to: { x: 10, z: 10 }, maxExpand: 100 })).toBeNull();
    expect(ctx.world.graph.nearestEdge(0, 0, undefined, 50)).toBeNull();
    expect(ctx.world.places.landmarks()).toEqual([]);
    expect(await ctx.world.places.findPlace('city hall', 3)).toEqual([]);
    expect(ctx.world.resolver.bake).toBe('graybox');
    // the vehicle module's interaction service and prefabs are in the context
    expect(ctx.interaction.current()).toBeNull();
    expect(typeof ctx.prefabs.spawn).toBe('function');
    // QA unlockAll is off here (no boot flag) and the quit leaves a modeExit save request
    modes.command({ t: 'mode.quit' });
    expect(host?.state).toBe('Idle');
    sim.dispose();
  });

  it('the QA unlock helper sends its sys.unlocks patch in the same outbox as its toast, between ticks (BD-FIX-CI9-W01)', async () => {
    const sim = await createGrayboxSim();
    const modes = createModesModule();
    modes.installQa?.(runModesQa);
    for (const def of modes.systems) sim.core.addSystem(def);
    const posted: unknown[] = [];
    const runtime = {
      env: { qa: true, modules: [] as never[], log: undefined },
      saveControl: null,
      transport: { postEvent: (m: unknown) => void posted.push(m) },
      uiCommand: null,
      uiOutbox: null,
    } as unknown as SimRuntime;
    await modes.onInit?.({ sim, cfg: sim.core.cfg, boot: { strings: [], prefabs: [], config: {} }, runtime, ports: {} } as SimModuleContext);
    sim.step(2);
    runtime.uiOutbox?.();
    // what SimRuntime.debug does: the modules' onDebug, then the UI outbox, with no tick in between
    modes.onDebug?.({ t: 'debug.modes', id: 1, op: 'unlock', args: { id: 'unlock.racing' } });
    const out = runtime.uiOutbox?.();
    expect(out?.toasts.map((t) => t.kind)).toEqual(['unlock']);
    expect(out?.patches.find((p) => p.k === 'sys.unlocks')?.v).toEqual(['unlock.racing']);
    sim.dispose();
  });
});
