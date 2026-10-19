import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { worldBakeId } from '../vite/media-local.ts';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(web, 'dist');
const committedPointer = path.join(web, 'public', 'asset-catalog.json');
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

interface Pointer { sha256: string; key: string; bytes: number }
interface Manifest { entries: Record<string, { variants: Record<string, { key: string; sha256: string; bytes: number }> }> }

/**
 * AC-11 (M02a1): the QA build with DV_WORLD=<bakeId|area> serves the merged catalog; a QA build without it serves the committed
 * pointer. Reads apps/web/dist; without it prints `SKIP world-catalog: apps/web/dist absent` and passes, unless
 * DV_REQUIRE_DIST=1 (DL-344).
 */
const have = existsSync(path.join(dist, 'asset-catalog.json'));
if (!have) {
  if (process.env['DV_REQUIRE_DIST'] === '1') throw new Error('world-catalog: apps/web/dist is absent and DV_REQUIRE_DIST=1');
  console.log('SKIP world-catalog: apps/web/dist absent');
}

describe('worldBakeId', () => {
  it('takes a 64-hex bake id as is and refuses an area without a bake', () => {
    expect(worldBakeId('a'.repeat(64), '/nonexistent')).toBe('a'.repeat(64));
    expect(() => worldBakeId('synth', '/nonexistent')).toThrow(/no bake for that area/);
  });
});

describe.skipIf(!have)('QA build catalog', () => {
  const media = path.join(dist, 'media-local');
  const pointerOf = (file: string): Pointer => JSON.parse(readFileSync(file, 'utf8')) as Pointer;
  const manifestOf = (p: Pointer): Buffer => readFileSync(path.join(media, p.key));

  if (process.env['DV_WORLD']) {
    it('DV_WORLD: dist/asset-catalog.json equals dist/media-local/asset-catalog.json', () => {
      expect(readFileSync(path.join(dist, 'asset-catalog.json')).equals(readFileSync(path.join(media, 'asset-catalog.json')))).toBe(true);
    });

    it('DV_WORLD: the pointer sha256 and bytes match the manifest under dist/media-local/manifests', () => {
      const p = pointerOf(path.join(dist, 'asset-catalog.json'));
      const m = manifestOf(p);
      expect(p.key).toBe(`manifests/assets-${p.sha256}.json`);
      expect(sha(m)).toBe(p.sha256);
      expect(m.length).toBe(p.bytes);
    });

    it('DV_WORLD: the manifest resolves data/world-index and a world_pack/p0-* ref whose blob exists', () => {
      const p = pointerOf(path.join(dist, 'asset-catalog.json'));
      const man = JSON.parse(manifestOf(p).toString('utf8')) as { entries: Manifest['entries'] };
      const index = man.entries['data/world-index'];
      expect(index, 'data/world-index').toBeDefined();
      const p0 = Object.keys(man.entries).filter((r) => r.startsWith('world_pack/p0-'));
      expect(p0.length).toBeGreaterThan(0);
      for (const ref of ['data/world-index', p0[0] as string]) {
        const v = man.entries[ref]!.variants['default']!;
        const blob = path.join(media, v.key);
        expect(existsSync(blob), blob).toBe(true);
        expect(sha(readFileSync(blob))).toBe(v.sha256);
        expect(readFileSync(blob).length).toBe(v.bytes);
      }
    });
  } else {
    it('without DV_WORLD: dist/asset-catalog.json is the committed pointer and its manifest has no data/world-index', () => {
      expect(readFileSync(path.join(dist, 'asset-catalog.json'), 'utf8')).toBe(readFileSync(committedPointer, 'utf8'));
      if (!existsSync(media)) return; // a production build carries no media-local folder
      const p = pointerOf(committedPointer);
      const manFile = path.join(media, p.key);
      if (!existsSync(manFile)) return;
      const man = JSON.parse(readFileSync(manFile, 'utf8')) as { entries: Manifest['entries'] };
      expect(man.entries['data/world-index']).toBeUndefined();
    });
  }
});
