import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Mesh, MeshBasicMaterial, BoxGeometry, PerspectiveCamera, Scene } from 'three/webgpu';
import type { PostNode, QualityTierId } from '@dv/shared';
import { CUT_MOVE_M, CUT_TURN_DEG, PostStack, isCut, resetTraaNode, type CameraPose, type PipelineFactory, type PostContext } from '../../src/platform/post/stack.ts';
import { RendererHost, inferViewPasses } from '../../src/platform/renderer-host.ts';
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

/**
 * M02h8 AC-2: `PostStack` resets the TRAA history on a camera cut or a teleport and on request (a look shot); `resetTraaNode` does to a
 * three r186 `TRAANode` what its own resize does; the host's XR view passes (multiview) are read from the XR manager, or from the draw
 * calls where it does not say.
 */
function traaFakes() {
  const resets: number[] = [];
  let frames = 0;
  const camera = new PerspectiveCamera();
  const ctx: PostContext = { renderer: {} as never, scene: new Scene(), camera, backdrop: null };
  const factory: PipelineFactory = (_ctx, nodes) => ({
    render: () => void frames++,
    dispose: () => {},
    // as `threePipeline`: only a list with `traa` has a history to reset
    ...(nodes.includes('traa') ? { resetHistory: () => void resets.push(frames) } : {}),
  });
  const make = (tier: QualityTierId, level: 0 | 1 | 2 | 3, cap: 0 | 1 | 2 | 3 = 3): PostStack =>
    new PostStack({ context: () => ctx, tier, features: TIERS[tier].features, backend: 'webgl2', subs: { webgl2Unsupported: [], webgl2AaFallback: {} }, cap, level, direct: () => {}, factory });
  return { resets, camera, make, frames: () => frames };
}

describe('PostStack: the TRAA history (M02h8 AC-2)', () => {
  it('a camera that moves like a camera keeps its history', () => {
    const f = traaFakes();
    const s = f.make('desktop', 3);
    expect(s.temporal).toBe(true);
    // 60 m/s at 20 frames a second is 3 m a frame; a fast mouse turn is a few degrees a frame
    for (let i = 0; i < 12; i++) {
      f.camera.position.set(i * 3, 2, 0);
      f.camera.rotation.set(0, (i * 8 * Math.PI) / 180, 0);
      s.render();
    }
    expect(f.frames()).toBe(12);
    expect(f.resets).toEqual([]);
    expect(s.historyResets).toBe(0);
  });

  it('resets the history on a teleport (a jump in position) before the frame that shows the new place', () => {
    const f = traaFakes();
    const s = f.make('desktop', 3);
    s.render();
    s.render();
    f.camera.position.set(900, 40, -1200);
    s.render();
    // the reset ran with two frames drawn: before the third
    expect(f.resets).toEqual([2]);
    expect(s.historyResets).toBe(1);
    expect(s.framesSinceReset).toBe(1);
    s.render();
    expect(f.resets).toEqual([2]);
    expect([s.frames, s.framesSinceReset]).toEqual([4, 2]);
  });

  it('resets the history on a cut (a 90 degree turn in one frame)', () => {
    const f = traaFakes();
    const s = f.make('desktop', 3);
    s.render();
    f.camera.rotation.set(0, Math.PI / 2, 0);
    s.render();
    expect(f.resets).toEqual([1]);
  });

  it('resetHistory() is the shot reset: true and counted with traa, false where the list has no temporal node', () => {
    const f = traaFakes();
    const traa = f.make('desktop', 3);
    expect(traa.resetHistory()).toBe(true);
    expect(traa.historyResets).toBe(1);
    const smaa = f.make('desktop', 2);
    expect([...smaa.nodes]).toEqual(['gtao-half', 'bloom', 'smaa', 'tonemap']);
    expect(smaa.temporal).toBe(false);
    expect(smaa.resetHistory()).toBe(false);
    smaa.render();
    f.camera.position.set(5000, 0, 0);
    smaa.render();
    expect(smaa.historyResets).toBe(0);
    const direct = f.make('mobile-low', 3);
    expect(direct.resetHistory()).toBe(false);
  });

  it('a rebuild (a level change) starts without a pose: the first frame of the new pipeline is no cut', () => {
    const f = traaFakes();
    const s = f.make('desktop', 2);
    s.render();
    f.camera.position.set(700, 0, 0);
    s.setLevel(3);
    s.render();
    expect(f.resets).toEqual([]);
  });

  it('isCut: farther than CUT_MOVE_M or turned by more than CUT_TURN_DEG', () => {
    const q0: CameraPose['q'] = [0, 0, 0, 1];
    const at = (x: number, yawDeg = 0): CameraPose => ({ x, y: 0, z: 0, q: yawDeg === 0 ? q0 : [0, Math.sin((yawDeg * Math.PI) / 360), 0, Math.cos((yawDeg * Math.PI) / 360)] });
    expect(isCut(at(0), at(CUT_MOVE_M - 0.1))).toBe(false);
    expect(isCut(at(0), at(CUT_MOVE_M + 0.1))).toBe(true);
    expect(isCut(at(0), at(0, CUT_TURN_DEG - 1))).toBe(false);
    expect(isCut(at(0), at(0, CUT_TURN_DEG + 1))).toBe(true);
    expect(isCut(at(0), at(0, 90))).toBe(true);
    // q and -q are the same rotation
    expect(isCut({ x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, { x: 0, y: 0, z: 0, q: [0, 0, 0, -1] })).toBe(false);
  });
});

describe('resetTraaNode (three r186 TRAANode)', () => {
  it('shrinks the history target (the next frame copies the beauty into it), restarts the jitter and takes the current camera matrices', () => {
    const sized: [number, number][] = [];
    const world = new Matrix4().makeTranslation(3, 4, 5);
    const projInv = new Matrix4().makeScale(2, 2, 2);
    const node = {
      _historyRenderTarget: { setSize: (w: number, h: number) => void sized.push([w, h]) },
      _jitterIndex: 17,
      _cameraWorldMatrix: { value: new Matrix4() },
      _cameraProjectionMatrixInverse: { value: new Matrix4() },
    };
    resetTraaNode(node, { matrixWorld: world, projectionMatrixInverse: projInv });
    expect(sized).toEqual([[1, 1]]);
    expect(node._jitterIndex).toBe(0);
    expect(node._cameraWorldMatrix.value.elements).toEqual(world.elements);
    expect(node._cameraProjectionMatrixInverse.value.elements).toEqual(projInv.elements);
  });

  it('tolerates a node without those fields (another three version): nothing throws', () => {
    expect(() => resetTraaNode({}, null)).not.toThrow();
    expect(() => resetTraaNode(null, null)).not.toThrow();
  });

  it('the installed TRAANode still has the fields the reset writes', async () => {
    const { default: TRAANode } = (await import('three/addons/tsl/display/TRAANode.js')) as unknown as { default: new (...a: unknown[]) => Record<string, unknown> };
    const src = TRAANode.toString();
    for (const field of ['_historyRenderTarget', '_jitterIndex', '_cameraWorldMatrix', '_cameraProjectionMatrixInverse']) expect(src, field).toContain(field);
    // the resize path the reset relies on: a history target of another size is filled from the beauty target
    expect(src).toMatch(/needsRestart/);
  });
});

describe('XR view passes (M02h8)', () => {
  const canvas = (): HTMLCanvasElement => ({ clientWidth: 800, clientHeight: 450, width: 800, height: 450 }) as unknown as HTMLCanvasElement;

  it('inferViewPasses: draw calls over render objects, about 1 with multiview and about 2 without', () => {
    expect(inferViewPasses(78, 78)).toBe(1);
    expect(inferViewPasses(90, 78)).toBe(1);
    expect(inferViewPasses(156, 78)).toBe(2);
    expect(inferViewPasses(150, 78)).toBe(2);
    expect(inferViewPasses(0, 78)).toBe(1);
    expect(inferViewPasses(10, 0)).toBe(1);
  });

  it('a flat page has no multiview state and one view pass', async () => {
    const h = new RendererHost({ canvas: canvas(), createRenderer: fakeFactory().create, cloneCanvas: (c) => c });
    await h.init(TIERS['xr-quest']);
    expect(h.xrMultiview).toBeNull();
    expect(h.viewPasses()).toBe(1);
    expect(h.viewPasses(78)).toBe(1);
    h.dispose();
  });

  it('a presenting session reports the XR manager\'s multiview state, and two passes without it', async () => {
    const factory = fakeFactory();
    const h = new RendererHost({ canvas: canvas(), createRenderer: factory.create, cloneCanvas: (c) => c });
    await h.init(TIERS['xr-quest']);
    const xr = factory.state.renderers[0]?.xr as unknown as { isPresenting: boolean; useMultiview?: () => boolean; getCamera?: () => { cameras: unknown[] } };
    xr.isPresenting = true;
    xr.getCamera = () => ({ cameras: [{}, {}] });
    xr.useMultiview = () => true;
    expect(h.xrMultiview).toBe(true);
    expect(h.viewPasses()).toBe(1);
    xr.useMultiview = () => false;
    expect(h.xrMultiview).toBe(false);
    expect(h.viewPasses()).toBe(2);
    // an XR manager that does not say: the camera's views, or the draw calls when the meter's object count is given
    delete xr.useMultiview;
    expect(h.xrMultiview).toBeNull();
    expect(h.viewPasses()).toBe(2);
    h.lastDrawCalls = 80;
    expect(h.viewPasses(78)).toBe(1);
    h.lastDrawCalls = 160;
    expect(h.viewPasses(78)).toBe(2);
    h.dispose();
  });

  it('the Quest tier asks the renderer for multiview and Vision Pro does not (C13 tier data)', async () => {
    for (const [tier, want] of [['xr-quest', true], ['xr-visionpro', false]] as const) {
      const factory = fakeFactory();
      const h = new RendererHost({ canvas: canvas(), createRenderer: factory.create, cloneCanvas: (c) => c });
      await h.init(TIERS[tier]);
      expect(factory.state.created[0]?.multiview, tier).toBe(want);
      h.dispose();
    }
  });
});
