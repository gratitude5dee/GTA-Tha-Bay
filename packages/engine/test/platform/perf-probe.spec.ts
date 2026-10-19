import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { RenderBudgetMeter } from '../../src/platform/perf/meter.ts';
import { FrameSampler, PERF_RING_SAMPLES, PerfProbe, percentileOf, readMemory } from '../../src/platform/perf/probe.ts';
import { benchmarkLoad, hopeless, summarizeFrames } from '../../src/platform/benchmark.ts';
import { orbitPhase, orbitPosition, scenarioOf, SCENARIO_PATHS } from '../../src/platform/perf/scenario-runner.ts';
import { TIERS } from '../../src/platform/tier-config.ts';

describe('PerfProbe', () => {
  it('holds 36,000 samples in a Float32Array ring', () => {
    const p = new PerfProbe();
    expect(p.capacity).toBe(36_000);
    expect(PERF_RING_SAMPLES).toBe(36_000);
    for (let i = 0; i < 40_000; i++) p.push(16);
    expect(p.count).toBe(36_000);
    expect(p.total).toBe(40_000);
  });

  it('computes percentiles by nearest rank', () => {
    const p = new PerfProbe(1000);
    for (let i = 1; i <= 100; i++) p.push(i);
    expect(p.percentile(0.5)).toBe(50);
    expect(p.percentile(0.95)).toBe(95);
    expect(p.percentile(0.99)).toBe(99);
    expect(percentileOf([], 0.5)).toBe(0);
  });

  it('counts hitches over 50 ms and over twice the budget', () => {
    const p = new PerfProbe(100);
    for (const v of [16, 16, 16, 40, 60, 120]) p.push(v);
    const s = p.stats(16.7);
    expect(s.count).toBe(6);
    expect(s.over50ms).toBe(2);
    expect(s.over2xBudget).toBe(3);
    expect(s.maxMs).toBe(120);
  });

  it('keeps only the newest samples once the ring wraps', () => {
    const p = new PerfProbe(4);
    for (const v of [1, 2, 3, 4, 100, 100]) p.push(v);
    expect([...p.sorted()]).toEqual([3, 4, 100, 100]);
  });

  it('ignores NaN and negative samples', () => {
    const p = new PerfProbe(10);
    p.push(Number.NaN);
    p.push(-3);
    expect(p.count).toBe(0);
  });
});

describe('FrameSampler', () => {
  it('turns rAF timestamps into deltas and reports a minute window', () => {
    const info = { render: { drawCalls: 0, triangles: 0 }, memory: {} };
    const s = new FrameSampler(() => info);
    for (let i = 0; i < 61; i++) {
      s.before(i * 20);
      info.render.drawCalls = 10 + (i % 5);
      info.render.triangles = 1000 * (i % 7);
      s.after();
    }
    const m = s.takeMinute();
    expect(m?.frames).toBe(60);
    expect(m?.fpsP50).toBe(50);
    expect(m?.frameP95Ms).toBe(20);
    expect(m?.drawCalls).toBe(14);
    expect(m?.tris).toBe(6000);
    // The next window starts empty.
    expect(s.takeMinute()).toBeNull();
  });

  it('resetClock drops the long delta after a hidden period', () => {
    const s = new FrameSampler(() => null);
    s.before(0);
    s.before(16);
    s.resetClock();
    s.before(60_000);
    s.before(60_016);
    expect(s.probe.stats(16.7).maxMs).toBe(16);
  });
});

describe('readMemory', () => {
  it('reads texture and total bytes from renderer.info.memory and the registered wasm sources', () => {
    const info = { render: { drawCalls: 0, triangles: 0 }, memory: { texturesSize: 4 * 1024 * 1024, total: 10 * 1024 * 1024, textures: 3, geometries: 7 } };
    const m = readMemory(info, new Map([['rapier', () => 2 * 1024 * 1024]]));
    expect(m).toEqual({ textures: 3, geometries: 7, texturesMB: 4, gpuMB: 10, wasmMB: 2 });
    expect(readMemory(null, new Map())).toEqual({ textures: 0, geometries: 0, texturesMB: 0, gpuMB: 0, wasmMB: 0 });
  });
});

describe('RenderBudgetMeter', () => {
  function sceneWith(n: number, spacing: number): { scene: Scene; camera: PerspectiveCamera } {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const scene = new Scene();
    const group = new Group();
    for (let i = 0; i < n; i++) {
      const m = new Mesh(geometry, material);
      m.position.set(i * spacing, 0, 0);
      group.add(m);
    }
    scene.add(group);
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    return { scene, camera };
  }

  it('counts visible meshes and triangles (12 per box)', () => {
    const { scene, camera } = sceneWith(5, 0);
    const meter = new RenderBudgetMeter(10);
    const c = meter.measure(scene, camera);
    expect(c.renderObjects).toBe(5);
    expect(c.triangles).toBe(60);
  });

  it('skips invisible nodes, nodes outside the frustum and nodes on other layers', () => {
    const { scene, camera } = sceneWith(4, 0);
    const group = scene.children[0] as Group;
    (group.children[0] as Mesh).visible = false;
    group.children[1]?.position.set(5000, 0, 0);
    group.children[1]?.updateMatrixWorld();
    group.children[2]?.layers.set(3);
    const meter = new RenderBudgetMeter(10);
    expect(meter.measure(scene, camera).renderObjects).toBe(1);
  });

  it('adds one render object per shadow pass for shadow casters', () => {
    const { scene, camera } = sceneWith(3, 0);
    for (const m of (scene.children[0] as Group).children) m.castShadow = true;
    const meter = new RenderBudgetMeter(10);
    expect(meter.measure(scene, camera, 3).renderObjects).toBe(3 + 9);
  });

  it('multiplies triangles by the instance count', () => {
    const scene = new Scene();
    const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 100);
    inst.count = 40;
    inst.frustumCulled = false;
    scene.add(inst);
    const camera = new PerspectiveCamera();
    const c = new RenderBudgetMeter(10).measure(scene, camera);
    expect(c.renderObjects).toBe(1);
    expect(c.triangles).toBe(12 * 40);
  });

  it('tracks maxima and the p95 of render objects', () => {
    const meter = new RenderBudgetMeter(200);
    const camera = new PerspectiveCamera();
    camera.position.z = 30;
    camera.updateMatrixWorld();
    for (let i = 1; i <= 100; i++) {
      const { scene } = sceneWith(i, 0);
      meter.measure(scene, camera);
    }
    expect(meter.maxRenderObjects).toBe(100);
    expect(meter.objectsP95()).toBe(95);
    expect(meter.frames).toBe(100);
    meter.reset();
    expect(meter.maxRenderObjects).toBe(0);
  });
});

describe('benchmark scene sizing', () => {
  it('sizes the synthetic chunk group to 80 % of the tier budget', () => {
    for (const id of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
      const tier = TIERS[id];
      const load = benchmarkLoad(tier);
      expect(load.objects).toBe(Math.floor(tier.budget.render.maxRenderObjects * 0.8));
      expect(load.objects).toBeLessThanOrEqual(tier.budget.render.maxRenderObjects);
      // Triangles within 15 % of the 80 % target and never above the budget.
      const target = tier.budget.render.maxTriangles * 0.8;
      expect(load.triangles).toBeLessThanOrEqual(tier.budget.render.maxTriangles);
      expect(Math.abs(load.triangles - target) / target).toBeLessThan(0.15);
    }
  });

  it('summarizes frames by nearest rank and gives up early on a hopeless run', () => {
    const s = summarizeFrames([10, 10, 10, 10, 10, 10, 10, 10, 10, 90]);
    expect(s.medianMs).toBe(10);
    expect(s.p90Ms).toBe(10);
    expect(summarizeFrames([]).p90Ms).toBe(0);
    // Three warm-up deltas are ignored; four measured frames at 5x the limit are hopeless, at 2x they are not.
    expect(hopeless([1, 1, 1, 200, 200, 200, 200], 36)).toBe(true);
    expect(hopeless([1, 1, 1, 70, 70, 70, 70], 36)).toBe(false);
    expect(hopeless([1, 1, 1, 200, 200], 36)).toBe(false);
  });
});

describe('scenario path', () => {
  it('graybox-walk is a 60 m orbit of the ENU origin, 120 s, seed 0xC0FFEE', () => {
    const p = SCENARIO_PATHS['graybox-walk'];
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.radiusM).toBe(60);
    expect(p.centerEnu).toEqual([0, 0, 0]);
    expect(p.durationS).toBe(120);
    expect(p.seed).toBe(0xc0ffee);
    const phase = orbitPhase(p.seed);
    expect(orbitPhase(p.seed)).toBe(phase);
    const a = orbitPosition(p, 0, phase);
    const b = orbitPosition(p, p.periodS, phase);
    expect(Math.hypot(a[0], a[2])).toBeCloseTo(60, 6);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[2]).toBeCloseTo(a[2], 6);
    expect(scenarioOf(p, 10).durationS).toBe(10);
    expect(scenarioOf(p).pathRef).toBe('config/perf/paths/graybox-walk.json');
  });
});
