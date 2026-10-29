/**
 * AC-13 and the boot rule: `bootChoice` (four cases, DL-668 part 2), `bootSet`, and the engine sim-module hook (DL-651) with
 * the world streaming module: a test system declared at `SimStage.Streaming` runs once per tick between `Rules` and `Publish`,
 * `onInit` runs once before the first tick, `modules: []` runs no world system, and the world module without a world in the boot
 * payload leaves the state hash exactly where a session without modules has it.
 */
import { readFileSync } from 'node:fs';
import { SimStage, type SystemDef } from '@dv/shared';
import { SimRuntime, attachSabWorker, createSabMain, physicsDropConfig, type SimModule, type SimRuntimeEnv } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { bootChoice, bootSet, backdropOf, spawnPose } from '../src/sim/streaming/boot.ts';
import { worldStreamingModule } from '../src/sim/streaming/module.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

describe('bootChoice (DL-668 part 2)', () => {
  it('no flag boots the baked world when the catalog has data/world-index, the gray-box otherwise', () => {
    expect(bootChoice(null, true)).toBe('baked');
    expect(bootChoice(null, false)).toBe('graybox');
  });
  it('an explicit ?world= wins over a catalog with a world index', () => {
    expect(bootChoice('civic-graybox', true)).toBe('graybox');
    expect(bootChoice('walk-drop', true)).toBe('scenario');
    expect(bootChoice('physics-drop', false)).toBe('scenario');
  });
});

const fakeIndex = (): { tiles: { p0: string[]; l0: string[]; l1: string[]; l2: string[] } } => {
  const t: string[] = [];
  for (let y = 60; y <= 68; y++) for (let x = 60; x <= 68; x++) t.push(`${x}-${y}`);
  const hosts = (n: number, c: number): string[] => {
    const out: string[] = [];
    for (let y = c - 1; y <= c + 1; y++) for (let x = c - 1; x <= c + 1; x++) out.push(`${x}-${y}`);
    return out.slice(0, n);
  };
  return { tiles: { p0: t, l0: t, l1: hosts(9, 16), l2: hosts(4, 4) } };
};

describe('bootSet', () => {
  const spawn = { x: 0, z: 0 };
  it('lists p0 inside the physics radius plus one chunk, l0 inside min(r0, one tile ring), and the backdrop of the tier', () => {
    const desktop = bootSet(fakeIndex(), spawn, 'desktop');
    // City Hall chunk 9/256/256 lives in the z7 tile 64-64; 400 m + 256 m around the spawn touches the four tiles around it.
    expect(desktop.p0).toContain('world_pack/p0-64-64');
    expect(desktop.p0.length).toBeGreaterThanOrEqual(1);
    expect(desktop.p0.length).toBeLessThanOrEqual(4);
    expect(desktop.l0).toContain('world_pack/l0-64-64');
    expect(desktop.l0.length).toBeLessThanOrEqual(9);
    expect(desktop.far).toEqual(['world_pack/far-bay-dem', 'world_pack/far-bay-massing']);
    expect(desktop.critical[0]).toBe('world_pack/p0-64-64');
    expect(desktop.critical).toContain('world_pack/far-bay-dem');
    const low = bootSet(fakeIndex(), spawn, 'mobile-low');
    expect(low.far).toEqual(['texture/far-bay-cards']);
    expect(low.critical).toContain('texture/far-bay-cards');
    expect(low.p0.length).toBeLessThanOrEqual(desktop.p0.length);
    expect(new Set(desktop.p0).size).toBe(desktop.p0.length);
  });
  it('drops massing when the flag is off and cards when the flag is off', () => {
    expect(bootSet(fakeIndex(), spawn, 'desktop', { massing: false, cards: true }).far).toEqual(['world_pack/far-bay-dem']);
    expect(bootSet(fakeIndex(), spawn, 'mobile', { massing: true, cards: false }).far).toEqual([]);
  });
  it('maps tiers to their backdrop mode (maps part 4.3)', () => {
    expect(backdropOf('desktop-ultra')).toEqual({ ring: true, ringKm: 80, cardsKm: null });
    expect(backdropOf('desktop')).toEqual({ ring: true, ringKm: 80, cardsKm: null });
    expect(backdropOf('mobile')).toEqual({ ring: false, ringKm: null, cardsKm: 20 });
    expect(backdropOf('xr-visionpro')).toEqual({ ring: false, ringKm: null, cardsKm: 20 });
    expect(backdropOf('mobile-low')).toEqual({ ring: false, ringKm: null, cardsKm: 10 });
    expect(backdropOf('xr-quest')).toEqual({ ring: false, ringKm: null, cardsKm: 10 });
  });
  it('on the synth bake, the spawn is the City Hall arrival pose and every listed pack exists', () => {
    const bake = requireBake('synth', 'boot.spec synth bake');
    if (!bake) return;
    const index = JSON.parse(readFileSync(`${bake.dir}/world-index.json`, 'utf8')) as Parameters<typeof spawnPose>[0] & Parameters<typeof bootSet>[0];
    const pose = spawnPose(index);
    expect(Math.hypot(pose.x, pose.z)).toBeLessThan(100);
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
      const set = bootSet(index, pose, tier);
      expect(set.p0.length).toBeGreaterThan(0);
      expect(set.l0.length).toBeGreaterThan(0);
      for (const ref of [...set.p0, ...set.l0, ...set.l1, ...set.l2]) {
        const [, name] = ref.split('/') as [string, string];
        const [fam, x, y] = name.split('-') as [string, string, string];
        expect(index.tiles[fam as 'p0' | 'l0' | 'l1' | 'l2']).toContain(`${x}-${y}`);
      }
    }
  });
});

// ---- AC-13: the sim-module hook ----------------------------------------------------------------------------------------

function runtimeWith(modules: readonly SimModule[] | undefined): { runtime: SimRuntime; close: () => void } {
  const made = createSabMain();
  const transport = attachSabWorker(made.init);
  const env: SimRuntimeEnv = { now: () => 0, blockFor: () => {}, qa: true, ...(modules ? { modules } : {}) };
  const runtime = new SimRuntime(transport, env);
  return { runtime, close: () => runtime.dispose() };
}

const config = (): ReturnType<typeof physicsDropConfig> => physicsDropConfig('canonical', 0);
const BOOT = { strings: [], prefabs: [], config: { scenario: 'physics-drop' } };

describe('SimModule hook (AC-13)', () => {
  it('runs a Streaming system once per tick between Rules and Publish, and onInit once before the first tick', async () => {
    const log: string[] = [];
    const sys = (id: string, stage: SimStage): SystemDef => ({ id, owner: 'test', stage, order: 100, run: ({ tick }) => void log.push(`${tick}:${id}`) });
    let inits = 0;
    let initTick = -1;
    const mod: SimModule = {
      id: 'test',
      systems: [sys('test.publish', SimStage.Publish), sys('test.streaming', SimStage.Streaming), sys('test.rules', SimStage.Rules)],
      onInit: (ctx) => {
        inits++;
        initTick = ctx.sim.core.tick;
      },
    };
    const { runtime, close } = runtimeWith([mod]);
    await runtime.boot(config(), BOOT);
    expect(inits).toBe(1);
    expect(initTick).toBe(0);
    for (let i = 0; i < 3; i++) runtime.sim?.core.stepOnce();
    const mine = log.filter((l) => l.includes('test.'));
    expect(mine).toEqual(['0:test.rules', '0:test.streaming', '0:test.publish', '1:test.rules', '1:test.streaming', '1:test.publish', '2:test.rules', '2:test.streaming', '2:test.publish']);
    expect(inits).toBe(1);
    close();
  }, 60_000);

  it('a runtime built with modules: [] runs no world system; the world module adds exactly one Streaming system', async () => {
    const empty = runtimeWith([]);
    await empty.runtime.boot(config(), BOOT);
    expect(empty.runtime.sim?.core.scheduler.plan(SimStage.Streaming, 0)).toEqual([]);
    const world = runtimeWith([worldStreamingModule]);
    await world.runtime.boot(config(), BOOT);
    expect(world.runtime.sim?.core.scheduler.plan(SimStage.Streaming, 0)).toEqual(['world.streaming']);
    empty.close();
    world.close();
  }, 60_000);

  it('the world module without a world in the boot payload is inert: the state hash equals a session without modules', async () => {
    const plain = runtimeWith(undefined);
    const withModule = runtimeWith([worldStreamingModule]);
    await plain.runtime.boot(config(), BOOT);
    await withModule.runtime.boot(config(), BOOT);
    expect(worldStreamingModule.state).toBeNull();
    const hashes: [string, string][] = [];
    for (let i = 0; i < 120; i++) {
      plain.runtime.sim?.core.stepOnce();
      withModule.runtime.sim?.core.stepOnce();
      if (i % 40 === 39) hashes.push([plain.runtime.sim?.hash() ?? '', withModule.runtime.sim?.hash() ?? '']);
    }
    for (const [a, b] of hashes) expect(b).toBe(a);
    expect(hashes[0]?.[0]).toMatch(/^[0-9a-f]{16}$/);
    plain.close();
    withModule.close();
  }, 120_000);

  it('apps/web composes the world module into sim.worker and qa/determinism with runSimWorker; the determinism branch builds its own sims', () => {
    const read = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
    const worker = read('apps/web/src/workers/sim.worker.ts');
    expect(worker).toMatch(/runSimWorker\(\s*self[^)]*\[\s*worldStreamingModule\s*(,\s*createPursuitModule\((\{[^}]*\})?\)\s*)?(,\s*racing\s*)?(,\s*fighter\s*)?(,\s*npc\s*)?\]/);
    const det = read('apps/web/src/qa/determinism.ts');
    expect(det).toMatch(/workers\/sim\.worker\.ts/);
    const core = read('packages/engine/src/workers/sim-worker-core.ts');
    // The determinism branch returns before the SimRuntime (and so before any module) exists.
    expect(core.indexOf("boot.config['mode'] === 'determinism'")).toBeGreaterThan(0);
    expect(core.indexOf("boot.config['mode'] === 'determinism'")).toBeLessThan(core.indexOf('new SimRuntime('));
    const engineWorker = read('packages/engine/src/workers/sim.worker.ts');
    expect(engineWorker).toMatch(/runSimWorker\(globalThis as unknown as WorkerScope, \[\]\)/);
  });
});
