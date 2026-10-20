import { describe, expect, it } from 'vitest';
import type { PostNode, QualityTierId } from '@dv/shared';
import { adaptForBackend, effectivePostLevel, postNodes, type PostLevel } from '../../src/platform/post/levels.ts';
import { TIERS } from '../../src/platform/tier-config.ts';

/** AC-2 (M02e): `postNodes` returns exactly the per-level lists of the spec, for levels 3, 2, 1, 0. */
const EXPECTED: Record<string, Record<PostLevel, PostNode[]>> = {
  'desktop-ultra': {
    3: ['gtao-half', 'bloom', 'traa', 'tonemap', 'fsr1'],
    2: ['gtao-half', 'bloom', 'traa', 'tonemap'],
    1: ['bloom', 'traa', 'tonemap'],
    0: ['fxaa', 'tonemap'],
  },
  desktop: {
    3: ['gtao-half', 'bloom', 'traa', 'tonemap'],
    2: ['gtao-half', 'bloom', 'smaa', 'tonemap'],
    1: ['bloom', 'smaa', 'tonemap'],
    0: ['fxaa', 'tonemap'],
  },
  mobile: {
    3: ['bloom', 'fxaa', 'tonemap'],
    2: ['fxaa', 'tonemap'],
    1: ['fxaa', 'tonemap'],
    0: ['fxaa', 'tonemap'],
  },
  'mobile-low': { 3: ['tonemap'], 2: ['tonemap'], 1: ['tonemap'], 0: ['tonemap'] },
};

describe('postNodes (M02e levels.ts)', () => {
  for (const [tier, byLevel] of Object.entries(EXPECTED)) {
    for (const level of [3, 2, 1, 0] as const) {
      it(`${tier} at level ${level} (cap 3) runs ${byLevel[level].join(', ')}`, () => {
        expect(postNodes(TIERS[tier as QualityTierId].features, level, 3)).toEqual(byLevel[level]);
      });
    }
  }

  it('the cap of 2 holds level 3 to the tier list: the list that runs is exactly `post`', () => {
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
      const f = TIERS[tier].features;
      expect(postNodes(f, 3, 2)).toEqual([...f.post]);
      expect(postNodes(f, 2, 2)).toEqual([...f.post]);
    }
  });

  it('the XR tiers run no post stack: the direct pipeline returns []', () => {
    for (const tier of ['xr-quest', 'xr-visionpro'] as const) {
      for (const level of [0, 1, 2, 3] as const) expect(postNodes(TIERS[tier].features, level, 3)).toEqual([]);
    }
  });

  it('the effective level is the smaller of the governor level and the cap', () => {
    expect(effectivePostLevel(3, 2)).toBe(2);
    expect(effectivePostLevel(1, 2)).toBe(1);
    expect(effectivePostLevel(0, 3)).toBe(0);
  });

  it('never holds two anti-aliasing nodes', () => {
    for (const tier of ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const) {
      for (const level of [0, 1, 2, 3] as const) {
        const aa = postNodes(TIERS[tier].features, level, 3).filter((n) => n === 'traa' || n === 'smaa' || n === 'fxaa');
        expect(aa.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('adaptForBackend (look.json webgl2Unsupported and webgl2AaFallback)', () => {
  const desktop = postNodes(TIERS.desktop.features, 2, 2);

  it('changes nothing on the WebGPU backend', () => {
    expect(adaptForBackend(desktop, 'webgpu', { webgl2Unsupported: ['gtao-half', 'bloom'], webgl2AaFallback: { smaa: 'fxaa' } })).toEqual(desktop);
  });

  it('drops a node that fails on the WebGL2 backend, and only there', () => {
    expect(adaptForBackend(desktop, 'webgl2', { webgl2Unsupported: ['gtao-half'], webgl2AaFallback: {} })).toEqual(['bloom', 'smaa', 'tonemap']);
    expect(adaptForBackend(desktop, 'webgl2', { webgl2Unsupported: ['bloom', 'gtao-half'], webgl2AaFallback: {} })).toEqual(['smaa', 'tonemap']);
  });

  it('substitutes an AA node by the fallback, never dropping tonemap or the AA node', () => {
    expect(adaptForBackend(desktop, 'webgl2', { webgl2Unsupported: [], webgl2AaFallback: { smaa: 'fxaa' } })).toEqual(['gtao-half', 'bloom', 'fxaa', 'tonemap']);
    const ultra = postNodes(TIERS['desktop-ultra'].features, 2, 2);
    expect(adaptForBackend(ultra, 'webgl2', { webgl2Unsupported: [], webgl2AaFallback: { traa: 'smaa', smaa: 'fxaa' } })).toEqual(['gtao-half', 'bloom', 'fxaa', 'tonemap']);
    expect(adaptForBackend(ultra, 'webgl2', { webgl2Unsupported: [], webgl2AaFallback: { traa: 'smaa' } })).toEqual(['gtao-half', 'bloom', 'smaa', 'tonemap']);
  });

  it('an empty configuration (the default) leaves every list as it is on both backends', () => {
    for (const backend of ['webgpu', 'webgl2'] as const) expect(adaptForBackend(desktop, backend, { webgl2Unsupported: [], webgl2AaFallback: {} })).toEqual(desktop);
  });
});
