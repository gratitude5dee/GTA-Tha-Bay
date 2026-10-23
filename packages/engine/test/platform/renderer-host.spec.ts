import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera } from 'three/webgpu';
import { RendererHost, NotImplementedError, pixelRatioFor, type GpuResourceOwner } from '../../src/platform/renderer-host.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { FakeRenderer, fakeFactory } from './fakes.ts';

const canvas = (): HTMLCanvasElement => ({ clientWidth: 800, clientHeight: 450, width: 800, height: 450 }) as unknown as HTMLCanvasElement;

function host(opts: Partial<ConstructorParameters<typeof RendererHost>[0]> & { factory?: ReturnType<typeof fakeFactory> } = {}) {
  const factory = opts.factory ?? fakeFactory();
  const gpu: string[] = [];
  let unsupported: Error | null = null;
  let reloads = 0;
  const h = new RendererHost({
    canvas: canvas(),
    createRenderer: factory.create,
    cloneCanvas: (c) => c,
    events: {
      gpuError: (kind, message) => gpu.push(`${kind}:${message}`),
      unsupported: (e) => {
        unsupported = e;
      },
      reloadPrompt: () => {
        reloads += 1;
      },
    },
    ...opts,
  });
  return { h, factory, gpu, get unsupported() { return unsupported; }, get reloads() { return reloads; } };
}

describe('RendererHost.init (AC-4)', () => {
  it('builds a WebGPU renderer first and reports webgpu', async () => {
    const t = host();
    const r = await t.h.init(TIERS.desktop);
    expect(r.backend).toBe('webgpu');
    expect(t.factory.state.created).toHaveLength(1);
    expect(t.factory.state.created[0]?.forceWebGL).toBe(false);
    expect(t.gpu).toEqual([]);
  });

  it('retries once with forceWebGL when WebGPU init rejects, reports webgl2 and emits one err.gpu{init}', async () => {
    const t = host({ factory: fakeFactory({ webgpuInitFails: true }) });
    const r = await t.h.init(TIERS.desktop);
    expect(r.backend).toBe('webgl2');
    expect(t.factory.state.created.map((c) => c.forceWebGL)).toEqual([false, true]);
    expect(t.gpu).toHaveLength(1);
    expect(t.gpu[0]).toMatch(/^init:/);
    expect(t.factory.state.renderers[0]?.disposed).toBe(true);
    expect(t.unsupported).toBeNull();
  });

  it('shows the Unsupported page when WebGL2 fails as well', async () => {
    const t = host({ factory: fakeFactory({ webgpuInitFails: true, webglInitFails: true }) });
    await expect(t.h.init(TIERS.desktop)).rejects.toThrow('WebGPU adapter not found');
    expect(t.unsupported).toBeInstanceOf(Error);
    expect(t.h.ready).toBe(false);
  });

  it('?gl=1 forces WebGL2 on the first attempt, with no err.gpu', async () => {
    const t = host({ qa: { gl: true, gpu: false, limits: {} } });
    expect((await t.h.init(TIERS.desktop)).backend).toBe('webgl2');
    expect(t.factory.state.created).toHaveLength(1);
    expect(t.factory.state.created[0]?.forceWebGL).toBe(true);
    expect(t.gpu).toEqual([]);
  });

  it('mobile tiers force WebGL2 while webgpu.mobile is false, and ?gpu=1 lifts that in QA', async () => {
    const off = host({ webgpuMobile: false });
    await off.h.init(TIERS.mobile);
    expect(off.factory.state.created[0]?.forceWebGL).toBe(true);
    const on = host({ webgpuMobile: true });
    await on.h.init(TIERS.mobile);
    expect(on.factory.state.created[0]?.forceWebGL).toBe(false);
    const qa = host({ webgpuMobile: false, qa: { gl: false, gpu: true, limits: {} } });
    await qa.h.init(TIERS['mobile-low']);
    expect(qa.factory.state.created[0]?.forceWebGL).toBe(false);
  });

  it('Compatibility mode forces WebGL2 on any tier', async () => {
    const t = host({ compatibilityMode: true });
    expect((await t.h.init(TIERS.desktop)).backend).toBe('webgl2');
  });

  it('the Quest tier forces WebGL2 and enables XR before init(); the Vision Pro tier keeps WebGPU', async () => {
    const q = host();
    await q.h.init(TIERS['xr-quest']);
    expect(q.factory.state.created[0]?.forceWebGL).toBe(true);
    expect(q.factory.state.created[0]?.xr).toBe(true);
    expect((q.factory.state.renderers[0] as FakeRenderer).xr.enabled).toBe(true);
    const v = host();
    await v.h.init(TIERS['xr-visionpro']);
    expect(v.factory.state.created[0]?.forceWebGL).toBe(false);
    expect(v.factory.state.created[0]?.multiview).toBe(false);
  });

  it('sets depth policy, shadow map, tone mapping and info.autoReset after init', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    expect(t.h.depthPolicy).toBe('reversed');
    const r = t.factory.state.renderers[0] as FakeRenderer;
    expect(r.info.autoReset).toBe(false);
    expect(r.shadowMap.type).not.toBe(0);
    expect(r.toneMapping).not.toBe(0);
    r.reversedDepthBuffer = false;
    const t2 = host({ factory: { ...fakeFactory(), create: (o) => {
      const fr = new FakeRenderer(o, { backend: 'webgl2' });
      fr.reversedDepthBuffer = false;
      return fr as never;
    }, state: { created: [], renderers: [], disposed: 0 } } });
    await t2.h.init(TIERS.desktop);
    expect(t2.h.depthPolicy).toBe('standard');
  });

  it('passes ?limits= as requiredLimits and nothing otherwise', async () => {
    const none = host();
    await none.h.init(TIERS.desktop);
    expect(none.factory.state.created[0]?.requiredLimits).toBeUndefined();
    const some = host({ qa: { gl: false, gpu: false, limits: { maxBufferSize: 1024 } } });
    await some.h.init(TIERS.desktop);
    expect(some.factory.state.created[0]?.requiredLimits).toEqual({ maxBufferSize: 1024 });
  });

  it('installXrFallback throws NotImplementedError(M11b1)', () => {
    const t = host();
    expect(() => t.h.installXrFallback()).toThrow(NotImplementedError);
    try {
      t.h.installXrFallback();
    } catch (e) {
      expect((e as NotImplementedError).milestone).toBe('M11b1');
    }
  });
});

describe('device loss (AC-4)', () => {
  it('recovers exactly once, calls every owner once, then shows the reload prompt', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    const calls: string[] = [];
    const owner = (name: string): GpuResourceOwner => ({
      onRendererReplaced: (next, prev) => {
        calls.push(`${name}:${next === prev ? 'same' : 'new'}`);
        return Promise.resolve();
      },
    });
    t.h.register(owner('a'));
    const off = t.h.register(owner('b'));
    t.h.register(owner('c'));
    off();

    const first = t.factory.state.renderers[0] as FakeRenderer;
    first.onDeviceLost({ reason: 'unknown', message: 'GPU hung' });
    await t.h.recover();
    expect(t.factory.state.renderers).toHaveLength(2);
    expect(calls).toEqual(['a:new', 'c:new']);
    expect(t.h.recoveries).toBe(1);
    expect(first.disposed).toBe(true);
    expect(t.reloads).toBe(0);
    expect(t.gpu.filter((g) => g.startsWith('lost:'))).toHaveLength(1);

    const second = t.factory.state.renderers[1] as FakeRenderer;
    second.onDeviceLost({ reason: 'unknown', message: 'GPU hung again' });
    await Promise.resolve();
    expect(t.factory.state.renderers).toHaveLength(2);
    expect(calls).toEqual(['a:new', 'c:new']);
    expect(t.h.recoveries).toBe(1);
    expect(t.reloads).toBe(1);
    expect(t.gpu.filter((g) => g.startsWith('lost:'))).toHaveLength(2);
  });

  it('ignores reason "destroyed"', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    (t.factory.state.renderers[0] as FakeRenderer).onDeviceLost({ reason: 'destroyed' });
    expect(t.h.deviceLosses).toBe(0);
    expect(t.factory.state.renderers).toHaveLength(1);
  });

  it('keeps the loop running across a recovery', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    t.h.startLoop();
    (t.factory.state.renderers[0] as FakeRenderer).onDeviceLost({ reason: 'unknown' });
    await t.h.recover();
    expect((t.factory.state.renderers[1] as FakeRenderer).loop).not.toBeNull();
  });

  it('forwards uncaptured errors as err.gpu{uncaptured}', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    (t.factory.state.renderers[0] as FakeRenderer).onError({ api: 'WebGPU', type: 'GPUValidationError', message: 'bad bind group' });
    expect(t.gpu).toEqual(['uncaptured:bad bind group']);
  });
});

describe('menu scene and frame loop', () => {
  it('renders the menu scene while one is set and the world scene otherwise', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    const rendered: unknown[] = [];
    const r = t.factory.state.renderers[0] as FakeRenderer;
    r.render = ((scene: unknown) => {
      rendered.push(scene);
    }) as never;
    t.h.startLoop();
    r.loop?.(10);
    const menu = new Group();
    t.h.setMenuScene(menu, new PerspectiveCamera());
    expect(t.h.menuActive).toBe(true);
    r.loop?.(20);
    t.h.clearMenuScene();
    r.loop?.(30);
    expect(rendered).toEqual([t.h.scene, menu, t.h.scene]);
  });

  it('resets renderer.info once per frame and notifies frame listeners', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    const r = t.factory.state.renderers[0] as FakeRenderer;
    let resets = 0;
    r.info.reset = () => {
      resets += 1;
    };
    const seen: string[] = [];
    t.h.addFrameListener({ before: () => seen.push('before'), after: () => seen.push('after') });
    t.h.startLoop();
    r.loop?.(1);
    r.loop?.(2);
    expect(resets).toBe(2);
    expect(seen).toEqual(['before', 'after', 'before', 'after']);
    expect(t.h.frames).toBe(2);
  });

  it('skips the untimed call three\'s Animation.start() makes when an XR session ends: no frame, no listener, no render', async () => {
    const t = host();
    await t.h.init(TIERS.desktop);
    const r = t.factory.state.renderers[0] as FakeRenderer;
    let renders = 0;
    r.render = (() => {
      renders += 1;
    }) as never;
    const times: number[] = [];
    const late: number[] = [];
    t.h.frameHook = (ms) => times.push(ms);
    t.h.addFrameListener({ late: (ms) => late.push(ms) });
    t.h.startLoop();
    const loop = r.loop as unknown as (t?: number) => void;
    loop(1000);
    loop(1016);
    loop(undefined); // XRManager's session end: the window loop is back and start() runs it once with no time
    loop(Number.NaN);
    loop(1050);
    expect(times).toEqual([1000, 1016, 1050]);
    expect(late).toEqual(times);
    expect(t.h.frames).toBe(3);
    expect(renders).toBe(3);
  });
});

describe('RendererHost GPU pacing (QA builds, BD-FIX-CI7-F03)', () => {
  /** A WebGL2 fake whose backend carries a GL with fences the test signals by hand. */
  function pacedHost(paceGpu: boolean) {
    let finished = 0;
    let next = 1;
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      SYNC_STATUS: 2,
      UNSIGNALED: 3,
      fenceSync: () => next++ as unknown as WebGLSync,
      getSyncParameter: (s: WebGLSync) => ((s as unknown as number) <= finished ? 4 : 3),
      deleteSync: () => undefined,
      flush: () => undefined,
    };
    const base = fakeFactory();
    const factory = {
      state: base.state,
      create: ((o) => {
        const r = base.create(o) as unknown as FakeRenderer;
        (r.backend as { gl?: unknown }).gl = gl;
        return r as never;
      }) as ReturnType<typeof fakeFactory>['create'],
    };
    const t = host({ factory, paceGpu, qa: { gl: true, gpu: false, limits: {} } });
    return { t, done: (n: number) => void (finished = n) };
  }

  it('holds a flat frame, listeners and hook included, while the GPU has two earlier frames to draw', async () => {
    const { t, done } = pacedHost(true);
    await t.h.init(TIERS.desktop);
    const r = t.factory.state.renderers[0] as FakeRenderer;
    let renders = 0;
    r.render = (() => {
      renders += 1;
    }) as never;
    const hooks: number[] = [];
    t.h.frameHook = (ms) => hooks.push(ms);
    t.h.startLoop();
    r.loop?.(10);
    r.loop?.(20);
    r.loop?.(30); // frames 1 and 2 are still on the GPU
    r.loop?.(40);
    expect(hooks).toEqual([10, 20]);
    expect(t.h.pacedFrames).toBe(2);
    done(1);
    r.loop?.(50);
    expect(hooks).toEqual([10, 20, 50]);
    expect(renders).toBe(3);
    expect(t.h.frames).toBe(3);
  });

  it('never holds a frame without paceGpu (production builds)', async () => {
    const { t } = pacedHost(false);
    await t.h.init(TIERS.desktop);
    const r = t.factory.state.renderers[0] as FakeRenderer;
    t.h.startLoop();
    for (let i = 1; i <= 5; i++) r.loop?.(i * 10);
    expect(t.h.frames).toBe(5);
    expect(t.h.pacedFrames).toBe(0);
  });
});

describe('pixelRatioFor', () => {
  it('applies dprCap, maxPixelsMP and the render scale', () => {
    // mobile-low: dprCap 1.25, 0.8 MP. 400x800 css = 0.32 MP css, so the dpr cap wins.
    expect(pixelRatioFor(TIERS['mobile-low'], 400, 800, 3)).toBeCloseTo(1.25, 5);
    // 1200x800 css = 0.96 MP: the pixel budget wins (sqrt(0.8e6 / 0.96e6)).
    expect(pixelRatioFor(TIERS['mobile-low'], 1200, 800, 3)).toBeCloseTo(Math.sqrt(0.8e6 / 960_000), 5);
    expect(pixelRatioFor(TIERS['mobile-low'], 400, 800, 3, 0.5)).toBeCloseTo(0.625, 5);
    // XR tiers have no caps.
    expect(pixelRatioFor(TIERS['xr-quest'], 1000, 1000, 2)).toBe(2);
  });
});
