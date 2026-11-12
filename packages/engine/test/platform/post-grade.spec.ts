/**
 * M02g1 AC-2: the colour grade. The maths (lift/gamma/gain, the warm-sun/cool-shade split, the saturation), the weather blend, and that
 * the grade runs exactly once on every path: in `tonemap` where the stack has a target, in the fog nodes where the list is only
 * `tonemap`, nowhere on a tier with no stack.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import type { QualityTierId } from '@dv/shared';
import {
  GRADE_IDENTITY, blendGrade, createGradeUniforms, gradeOwner, gradeReference, writeGrade, type GradeParams,
} from '../../src/platform/post/grade.ts';
import { adaptForBackend, postNodes, type PostLevel } from '../../src/platform/post/levels.ts';
import { PostStack, type PipelineFactory, type PostContext } from '../../src/platform/post/stack.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { createTonemap } from '../../src/platform/post/nodes.ts';
import look from '../../../../config/world/look.json';

const CLEAR = look.grade.clear as unknown as GradeParams;
const FOG = look.grade['karl-fog'] as unknown as GradeParams;
const luma = (c: readonly number[]): number => 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
const chroma = (c: readonly number[]): number => Math.max(...c) - Math.min(...c);

describe('gradeReference', () => {
  it('the identity leaves a colour as it was', () => {
    for (const c of [[0, 0, 0], [0.2, 0.4, 0.6], [1, 1, 1], [0.9, 0.1, 0.5]] as const) {
      const g = gradeReference(c, GRADE_IDENTITY);
      for (let i = 0; i < 3; i++) expect(g[i]).toBeCloseTo(c[i] as number, 9);
    }
  });

  it('lift raises the shadows more than the highlights; gamma above 1 brightens the mids and leaves black and white', () => {
    const lifted: GradeParams = { ...GRADE_IDENTITY, lift: [0.1, 0.1, 0.1] };
    expect(gradeReference([0, 0, 0], lifted)[0]).toBeCloseTo(0.1, 9);
    expect(gradeReference([1, 1, 1], lifted)[0]).toBeCloseTo(1, 9);
    const bright: GradeParams = { ...GRADE_IDENTITY, gamma: 1.2 };
    expect(gradeReference([0.5, 0.5, 0.5], bright)[0]).toBeGreaterThan(0.5);
    expect(gradeReference([0, 0, 0], bright)[0]).toBe(0);
    expect(gradeReference([1, 1, 1], bright)[0]).toBeCloseTo(1, 9);
  });

  it('the clear grade warms the lit end and cools the shade, and saturates', () => {
    const lit = gradeReference([0.8, 0.8, 0.8], CLEAR);
    expect(lit[0]).toBeGreaterThan(lit[2]); // warm sun
    const shade = gradeReference([0.12, 0.12, 0.12], CLEAR);
    expect(shade[2]).toBeGreaterThan(shade[0]); // cool shade
    const mid = [0.6, 0.45, 0.4] as const;
    expect(chroma(gradeReference(mid, CLEAR))).toBeGreaterThan(chroma(mid));
  });

  it('every preset keeps a grey in range and does not invert the order of two luminances', () => {
    for (const [name, preset] of Object.entries(look.grade)) {
      if (name === '$comment') continue;
      const p = preset as unknown as GradeParams;
      let last = -1;
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const g = gradeReference([v, v, v], p);
        for (const c of g) expect(c).toBeGreaterThanOrEqual(0);
        const l = luma(g);
        expect(l, `${name} at ${v}`).toBeGreaterThanOrEqual(last - 1e-9);
        last = l;
      }
    }
  });

  it('the fog preset is milder than clear: less chroma added to the same colour', () => {
    const c = [0.55, 0.45, 0.4] as const;
    expect(chroma(gradeReference(c, FOG))).toBeLessThan(chroma(gradeReference(c, CLEAR)));
  });
});

describe('blendGrade', () => {
  it('is the first at 0, the second at 1, and in between for the weather blend', () => {
    expect(blendGrade(FOG, CLEAR, 0)).toEqual(FOG);
    expect(blendGrade(FOG, CLEAR, 1)).toEqual(CLEAR);
    const mid = blendGrade(FOG, CLEAR, 0.5);
    expect(mid.saturation).toBeCloseTo((FOG.saturation + CLEAR.saturation) / 2, 9);
    expect(mid.gamma).toBeCloseTo((FOG.gamma + CLEAR.gamma) / 2, 9);
    expect(blendGrade(FOG, CLEAR, 7).gamma).toBe(CLEAR.gamma);
    expect(blendGrade(FOG, CLEAR, -3).gamma).toBe(FOG.gamma);
  });
});

describe('where the grade runs (once per path)', () => {
  const LEVELS: readonly PostLevel[] = [0, 1, 2, 3];
  const BACKENDS = ['webgpu', 'webgl2'] as const;
  const FLAT: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

  it('on a flat tier it is the tonemap node of a stack with a target, or the fog nodes of a tonemap-only list; never both, never neither', () => {
    for (const tier of FLAT) {
      for (const level of LEVELS) {
        for (const backend of BACKENDS) {
          const list = adaptForBackend(postNodes(TIERS[tier].features, level, 2), backend, { webgl2Unsupported: [], webgl2AaFallback: {} });
          expect(list, `${tier} L${level} ${backend}`).toContain('tonemap');
          const onlyTonemap = list.length === 1;
          const owner = gradeOwner(list, onlyTonemap ? 'direct' : 'pipeline');
          expect(owner, `${tier} L${level} ${backend}`).toBe(onlyTonemap ? 'fog' : 'tonemap');
        }
      }
    }
  });

  it('mobile-low is the fog path at every level; desktop, desktop-ultra and mobile are the tonemap path', () => {
    const owner = (tier: QualityTierId): string | null => {
      const f = fakeStack(tier);
      return f.gradeOwner;
    };
    expect(owner('mobile-low')).toBe('fog');
    expect(owner('mobile')).toBe('tonemap');
    expect(owner('desktop')).toBe('tonemap');
    expect(owner('desktop-ultra')).toBe('tonemap');
  });

  it('the XR tiers have no stack, so no path: the legacy look adds only the flat paint (M02h1)', () => {
    for (const tier of ['xr-quest', 'xr-visionpro'] as const) {
      expect(postNodes(TIERS[tier].features, 2, 2)).toEqual([]);
      expect(look.tierProfile[tier]).toBe('legacy');
    }
    // M02h1: `markings` is the one layer of the legacy profile; it adds no post node.
    expect(look.layers.legacy).toEqual(['markings']);
  });

  it('gradeOwner: a pipeline owns it when it runs tonemap, a direct list hands it to the fog nodes', () => {
    expect(gradeOwner(['gtao-half', 'bloom', 'smaa', 'tonemap'], 'pipeline')).toBe('tonemap');
    expect(gradeOwner(['tonemap'], 'direct')).toBe('fog');
    expect(gradeOwner([], 'pipeline')).toBeNull();
  });
});

function fakeStack(tier: QualityTierId): PostStack {
  const built: { grade: unknown }[] = [];
  const factory: PipelineFactory = (_ctx, _nodes, opts) => {
    built.push({ grade: opts.grade });
    return { render: () => undefined, dispose: () => undefined };
  };
  const ctx: PostContext = { renderer: {} as never, scene: new Scene(), camera: new PerspectiveCamera(), backdrop: null };
  return new PostStack({
    context: () => ctx, tier, features: TIERS[tier].features, backend: 'webgl2',
    subs: { webgl2Unsupported: [], webgl2AaFallback: {} } as never, cap: 2, direct: () => undefined, factory,
  });
}

describe('PostStack.setGrade', () => {
  it('writes the uniforms of the tonemap node on a stack with a target, with the layer weight', () => {
    const s = fakeStack('desktop');
    s.setGrade(CLEAR, 1);
    const u = s.gradeUniforms;
    expect(u.weight.value).toBe(1);
    expect(u.gamma.value).toBe(CLEAR.gamma);
    expect(u.saturation.value).toBe(CLEAR.saturation);
    expect(u.warm.value.toArray()).toEqual([...CLEAR.warm]);
    s.setGrade(CLEAR, 0);
    expect(u.weight.value).toBe(0);
  });

  it('keeps the tonemap weight at 0 on a tonemap-only list (the fog nodes own the grade there), through a rebuild too', () => {
    const s = fakeStack('mobile-low');
    s.setGrade(CLEAR, 1);
    expect(s.gradeUniforms.weight.value).toBe(0);
    s.rebuild();
    expect(s.gradeUniforms.weight.value).toBe(0);
  });

  it('hands the same uniforms to every pipeline it builds, so the grade survives a rebuild', () => {
    const built: unknown[] = [];
    const factory: PipelineFactory = (_c, _n, opts) => {
      built.push(opts.grade);
      return { render: () => undefined, dispose: () => undefined };
    };
    const ctx: PostContext = { renderer: {} as never, scene: new Scene(), camera: new PerspectiveCamera(), backdrop: null };
    const s = new PostStack({
      context: () => ctx, tier: 'desktop', features: TIERS.desktop.features, backend: 'webgl2',
      subs: { webgl2Unsupported: [], webgl2AaFallback: {} } as never, cap: 2, direct: () => undefined, factory,
    });
    s.setGrade(CLEAR, 1);
    s.rebuild();
    expect(built).toHaveLength(2);
    expect(built[0]).toBe(s.gradeUniforms);
    expect(built[1]).toBe(s.gradeUniforms);
    expect(s.gradeUniforms.weight.value).toBe(1);
  });

  it('forwards the bloom tuning of look.json to the pipeline factory', () => {
    let seen: unknown = null;
    const factory: PipelineFactory = (_c, _n, opts) => {
      seen = opts.bloom ?? null;
      return { render: () => undefined, dispose: () => undefined };
    };
    const ctx: PostContext = { renderer: {} as never, scene: new Scene(), camera: new PerspectiveCamera(), backdrop: null };
    new PostStack({
      context: () => ctx, tier: 'desktop', features: TIERS.desktop.features, backend: 'webgl2',
      subs: { webgl2Unsupported: [], webgl2AaFallback: {} } as never, cap: 2, direct: () => undefined, factory,
      bloom: look.bloom,
    });
    expect(seen).toEqual(look.bloom);
  });
});

describe('the TSL graph', () => {
  it('createTonemap builds with and without a grade, and writeGrade fills the uniforms', () => {
    const u = createGradeUniforms();
    writeGrade(u, FOG, 1);
    expect(u.weight.value).toBe(1);
    expect(u.lift.value.x).toBeCloseTo(FOG.lift[0], 9);
    const colour = vec4(0.5, 0.4, 0.3, 1) as never;
    expect(createTonemap(colour)).toBeDefined();
    expect(createTonemap(colour, u)).toBeDefined();
  });

  it('the bloom threshold of look.json is above 1.3: only lit windows, glints and the sun bloom', () => {
    expect(look.bloom.threshold).toBeGreaterThanOrEqual(1.3);
  });
});
