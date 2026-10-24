import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, BoxGeometry, PerspectiveCamera, Scene } from 'three/webgpu';
import type { PostNode, QualityTierId } from '@dv/shared';
import { PostStack, type PipelineFactory, type PostContext } from '../../src/platform/post/stack.ts';
import { RendererHost } from '../../src/platform/renderer-host.ts';
import { PerfScenarioRunner, type ScenarioRunnerDeps } from '../../src/platform/perf/scenario-runner.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { type FakeRenderer, fakeFactory } from './fakes.ts';

/** M02e: the post stack builds its pipeline from the tier's C13 data and rebuilds when it must. A fake factory stands for three. */
function fakes() {
  const built: { nodes: PostNode[]; disposed: boolean }[] = [];
  const rendered: number[] = [];
  const factory: PipelineFactory = (_ctx, nodes) => {
    const rec = { nodes: [...nodes], disposed: false };
    built.push(rec);
    return {
      render: () => void rendered.push(built.length),
      dispose: () => void (rec.disposed = true),
    };
  };
  const ctx: PostContext = { renderer: {} as never, scene: new Scene(), camera: new PerspectiveCamera(), backdrop: null };
  let direct = 0;
  const make = (tier: QualityTierId, o: { backend?: 'webgpu' | 'webgl2'; subs?: Partial<{ webgl2Unsupported: PostNode[]; webgl2AaFallback: Record<string, string> }>; level?: 0 | 1 | 2 | 3 } = {}) =>
    new PostStack({
      context: () => ctx,
      tier,
      features: TIERS[tier].features,
      backend: o.backend ?? 'webgl2',
      subs: { webgl2Unsupported: [], webgl2AaFallback: {}, ...(o.subs ?? {}) } as never,
      cap: 2,
      level: o.level ?? 2,
      direct: () => void direct++,
      factory,
    });
  return { built, rendered, make, get direct() { return direct; } };
}

describe('PostStack', () => {
  it('builds the node list of the tier: gtao, bloom, smaa, tonemap on desktop', () => {
    const f = fakes();
    const s = f.make('desktop');
    expect([...s.nodes]).toEqual(['gtao-half', 'bloom', 'smaa', 'tonemap']);
    expect(s.mode).toBe('pipeline');
    expect(f.built).toHaveLength(1);
    s.render();
    expect(f.rendered).toEqual([1]);
    expect(f.direct).toBe(0);
  });

  it('mobile-low is the direct path: tonemap in the renderer, no pipeline, no intermediate target', () => {
    const f = fakes();
    const s = f.make('mobile-low');
    expect([...s.nodes]).toEqual(['tonemap']);
    expect(s.mode).toBe('direct');
    expect(f.built).toHaveLength(0);
    s.render();
    expect(f.direct).toBe(1);
  });

  it('the XR tiers have no post stack: an empty list on the direct path', () => {
    for (const tier of ['xr-quest', 'xr-visionpro'] as const) {
      const f = fakes();
      const s = f.make(tier);
      expect([...s.nodes]).toEqual([]);
      expect(s.mode).toBe('direct');
      expect(f.built).toHaveLength(0);
    }
  });

  it('rebuilds on a tier change, disposing the old pipeline', () => {
    const f = fakes();
    const s = f.make('desktop');
    s.setTier('mobile', TIERS.mobile.features);
    expect([...s.nodes]).toEqual(['fxaa', 'tonemap']);
    expect(f.built).toHaveLength(2);
    expect(f.built[0]?.disposed).toBe(true);
    expect(f.built[1]?.nodes).toEqual(['fxaa', 'tonemap']);
  });

  it('rebuilds on a postLevel change that changes the list, and not on one that does not', () => {
    const f = fakes();
    const s = f.make('desktop');
    s.setLevel(1);
    expect([...s.nodes]).toEqual(['bloom', 'smaa', 'tonemap']);
    expect(f.built).toHaveLength(2);
    s.setLevel(0);
    expect([...s.nodes]).toEqual(['fxaa', 'tonemap']);
    expect(f.built).toHaveLength(3);
    // The cap is 2: level 3 is the tier list again, level 2 and 3 are the same list.
    s.setLevel(2);
    const n = f.built.length;
    s.setLevel(3);
    expect(f.built).toHaveLength(n);
  });

  it('rebuilds in onRendererReplaced (device loss), on the new renderer', async () => {
    const f = fakes();
    const s = f.make('desktop');
    await s.onRendererReplaced({} as never, null);
    expect(f.built).toHaveLength(2);
    expect(f.built[0]?.disposed).toBe(true);
  });

  it('skips a node listed in webgl2Unsupported on the WebGL2 backend only, and substitutes the AA node', () => {
    const a = fakes().make('desktop', { backend: 'webgl2', subs: { webgl2Unsupported: ['gtao-half'], webgl2AaFallback: { smaa: 'fxaa' } } });
    expect([...a.nodes]).toEqual(['bloom', 'fxaa', 'tonemap']);
    const b = fakes().make('desktop', { backend: 'webgpu', subs: { webgl2Unsupported: ['gtao-half'], webgl2AaFallback: { smaa: 'fxaa' } } });
    expect([...b.nodes]).toEqual(['gtao-half', 'bloom', 'smaa', 'tonemap']);
  });

  it('disposing stops the render', () => {
    const f = fakes();
    const s = f.make('desktop');
    s.dispose();
    s.render();
    expect(f.rendered).toEqual([]);
    expect(f.built[0]?.disposed).toBe(true);
  });
});

describe('RendererHost with a post stack', () => {
  const canvas = (): HTMLCanvasElement => ({ clientWidth: 800, clientHeight: 450, width: 800, height: 450 }) as unknown as HTMLCanvasElement;

  async function host(tier: QualityTierId) {
    const factory = fakeFactory();
    const h = new RendererHost({ canvas: canvas(), createRenderer: factory.create, cloneCanvas: (c) => c });
    await h.init(TIERS[tier]);
    return { h, factory };
  }

  it('draws through the stack, reports its shadow passes, and falls back to the direct path without one', async () => {
    const { h, factory } = await host('desktop');
    const f = fakes();
    const stack = new PostStack({
      context: () => ({ renderer: h.renderer, scene: h.scene, camera: h.camera, backdrop: null }),
      tier: 'desktop',
      features: TIERS.desktop.features,
      backend: 'webgl2',
      subs: { webgl2Unsupported: [], webgl2AaFallback: {} },
      cap: 2,
      direct: h.renderDirect,
      factory: (_c, n) => ({ render: () => void f.rendered.push(n.length), dispose: () => {} }),
    });
    stack.shadowPasses = 3;
    h.postStack = stack;
    expect(h.shadowPasses).toBe(3);
    h.startLoop();
    (factory.state.renderers[0] as FakeRenderer).loop?.(16);
    expect(f.rendered).toEqual([4]);
    h.postStack = null;
    expect(h.shadowPasses).toBe(0);
    h.dispose();
  });

  it('setExposure writes the renderer tone mapping exposure', async () => {
    const { h, factory } = await host('desktop');
    h.setExposure(0.8);
    expect((factory.state.renderers[0] as unknown as { toneMappingExposure: number }).toneMappingExposure).toBe(0.8);
    h.dispose();
  });
});

describe('the scenario runner counts shadow work (R-ENG-02)', () => {
  it('passes a non-zero shadowPasses at desktop: each caster adds its cascade count to the render objects', async () => {
    const { h } = await (async () => {
      const factory = fakeFactory();
      const hh = new RendererHost({ canvas: { clientWidth: 640, clientHeight: 360, width: 640, height: 360 } as unknown as HTMLCanvasElement, createRenderer: factory.create, cloneCanvas: (c) => c });
      await hh.init(TIERS.desktop);
      return { h: hh };
    })();
    // A scene of ten visible casters in front of the camera.
    const group = new Group();
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
      m.position.set(i * 3 - 13, 0, -20);
      m.castShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    h.scene.add(group);
    h.camera.position.set(0, 1, 5);
    h.camera.lookAt(0, 0, -20);
    // Route scenario with the world driver of a test: the runner only needs `prepare`, `frame` and `finish`.
    const listeners: { before?: (t: number) => void; late?: (t: number) => void; after?: (t: number) => void }[] = [];
    (h as unknown as { addFrameListener: unknown }).addFrameListener = (l: (typeof listeners)[number]) => {
      listeners.push(l);
      return () => void listeners.splice(listeners.indexOf(l), 1);
    };
    const stack = { shadowPasses: 3, dispose: () => {} } as unknown as PostStack;
    h.postStack = stack;
    const deps: ScenarioRunnerDeps = {
      host: h,
      tier: () => TIERS.desktop,
      profile: { class: 'desktop', browser: 'chrome', displayMode: 'tab', signals: { adapter: null } } as never,
      build: 't',
      now: () => 0,
      wasm: new Map(),
      errors: () => ({ gpuLost: 0, uncaptured: 0, js: 0 }),
      worldDriver: () => ({ prepare: () => Promise.resolve(), frame: () => ({ groundY: 0 }), finish: () => ({ coldDownloadMB: null }) }),
    };
    const runner = new PerfScenarioRunner(deps);
    const done = runner.run('walk-civic-center', { durationS: 0.05, warmupS: 0 });
    await new Promise((r) => setTimeout(r, 0));
    for (let t = 0; t < 400 && listeners.length > 0; t += 16) {
      for (const l of [...listeners]) {
        l.before?.(t);
        l.late?.(t);
        l.after?.(t);
      }
    }
    await done;
    // Ten casters and no other renderable: 10 + 10 x 3 shadow passes.
    expect(runner.info()?.meterRenderObjectsMax).toBe(10 + 10 * 3);
    h.dispose();
  });
});
