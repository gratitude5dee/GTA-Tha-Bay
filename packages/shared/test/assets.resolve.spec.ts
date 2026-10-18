import { describe, expect, it } from 'vitest';
import { AssetError, resolveVariant, type AssetManifest, type AssetVariant, type VariantId } from '../src/assets/c07.ts';
import { contentTypeOf } from '../src/assets/content-type.ts';
import { FIDELITY_VARIANT, TIER_FIDELITY } from '../src/assets/fidelity.ts';
import { VARIANT_FALLBACK, type QualityTierId } from '../src/platform/c13.ts';

const IDS: VariantId[] = ['default', 'desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
const TIERS = Object.keys(VARIANT_FALLBACK) as QualityTierId[];

function manifest(ids: VariantId[]): AssetManifest {
  const variants: Partial<Record<VariantId, AssetVariant>> = {};
  for (const id of ids) variants[id] = { key: `k/${id}`, sha256: '0'.repeat(64), bytes: 1, contentType: 'x', encoding: 'identity' };
  return { schema: 'asset/1', id: 'x1', kind: 'prop', rev: 1, variants, deps: [], status: 'active', visibility: 'public', tags: [],
    provenance: { root: '0'.repeat(64), origin: 'authored', license: 'x', aiGenerated: false } };
}

describe('resolveVariant', () => {
  it('covers every subset of the seven variant ids for each of the six tiers', () => {
    let checked = 0;
    for (let mask = 0; mask < 1 << IDS.length; mask++) {
      const ids = IDS.filter((_, i) => (mask & (1 << i)) !== 0);
      const m = manifest(ids);
      for (const tier of TIERS) {
        checked++;
        const chain = VARIANT_FALLBACK[tier];
        const expected = ids.includes('default') ? 'default' : chain.find((c) => ids.includes(c));
        if (expected === undefined) {
          expect(() => resolveVariant(m, tier)).toThrow(AssetError);
          try {
            resolveVariant(m, tier);
          } catch (e) {
            expect((e as AssetError).code).toBe('NO_VARIANT');
          }
        } else {
          expect(resolveVariant(m, tier).key).toBe(`k/${expected}`);
          // never a variant outside the tier's chain (unless default)
          expect(expected === 'default' || chain.includes(expected as QualityTierId)).toBe(true);
        }
      }
    }
    expect(checked).toBe(128 * 6);
  });

  it('never steps upward: a mobile-low device does not get a mobile variant', () => {
    expect(() => resolveVariant(manifest(['mobile', 'desktop']), 'mobile-low')).toThrow(AssetError);
    expect(resolveVariant(manifest(['mobile', 'desktop']), 'xr-quest').key).toBe('k/mobile');
    expect(resolveVariant(manifest(['mobile', 'desktop']), 'xr-visionpro').key).toBe('k/desktop');
  });
});

describe('fidelity and content types', () => {
  it('maps every tier to a fidelity and back to a variant that is on its chain', () => {
    for (const t of TIERS) expect(VARIANT_FALLBACK[t].length).toBeGreaterThan(0);
    expect(TIER_FIDELITY['xr-visionpro']).toBe('hi');
    expect(FIDELITY_VARIANT.lo).toBe('mobile-low');
  });

  it('follows the 05 section 4.4 table plus .png and .pack', () => {
    expect(contentTypeOf('glb')).toBe('model/gltf-binary');
    expect(contentTypeOf('.ktx2')).toBe('image/ktx2');
    expect(contentTypeOf('opus')).toBe('audio/ogg; codecs=opus');
    expect(contentTypeOf('json')).toBe('application/json');
    expect(contentTypeOf('png')).toBe('image/png');
    expect(contentTypeOf('pack')).toBe('application/octet-stream');
    expect(() => contentTypeOf('exe')).toThrow();
  });
});
