/**
 * M02d1: the mesher input of the proxy mask. A chunk whose footprints carry `proxyOf` reports them as `proxies`; with `maskProxies`
 * the footprints of the masked landmarks are left out (and reported as `masked`), every other building and the terrain stay
 * byte for byte as they were.
 */
import { readFileSync } from 'node:fs';
import { decodeL0, decodeP0, type RenderChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { meshChunk } from '../src/client/chunks/mesher.ts';
import type { MeshBuffers } from '../src/client/chunks/mesh-types.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/world/civic-graybox/${name}`, import.meta.url)));
const sim = decodeP0(fixture('p0-64-64.pack'));
const render = decodeL0(fixture('l0-64-64.pack'), sim);

/** The richest chunk of the fixture with proxies assigned: buildings 0 and 1 belong to landmark 3 (proxyOf 4), building 2 to landmark 5. */
function withProxies(): { chunk: (typeof sim)[number]; render: RenderChunk; total: number } {
  const c = [...sim].sort((a, b) => (render.find((r) => r.key === b.key)?.buildings.length ?? 0) - (render.find((r) => r.key === a.key)?.buildings.length ?? 0))[0]!;
  const r = render.find((x) => x.key === c.key)!;
  expect(r.buildings.length).toBeGreaterThanOrEqual(3);
  // the fixture has three footprints in its busiest chunk: use them twice so some stay ordinary buildings
  const buildings = [...r.buildings, ...r.buildings].map((b, i) => ({ ...b, proxyOf: i < 2 ? 4 : i === 2 ? 6 : 0 }));
  return { chunk: c, render: { ...r, buildings }, total: buildings.length };
}

const sameBuffers = (a: MeshBuffers, b: MeshBuffers): boolean => Buffer.from(a.positions.buffer, a.positions.byteOffset, a.positions.byteLength).equals(Buffer.from(b.positions.buffer, b.positions.byteOffset, b.positions.byteLength));

describe('meshChunk with a proxy mask', () => {
  it('reports the proxies of the chunk whether or not they are masked', () => {
    const { chunk, render: r } = withProxies();
    const plain = meshChunk(chunk, r, { tier: 'mobile', distM: 0 });
    expect(plain.proxies).toEqual([4, 6]);
    expect(plain.masked).toEqual([]);
    const one = meshChunk(chunk, r, { tier: 'mobile', distM: 0, maskProxies: [4] });
    expect(one.proxies).toEqual([4, 6]);
    expect(one.masked).toEqual([4]);
  });

  it('leaves the masked footprints out and nothing else', () => {
    const { chunk, render: r, total } = withProxies();
    const plain = meshChunk(chunk, r, { tier: 'desktop', distM: 0 });
    const masked = meshChunk(chunk, r, { tier: 'desktop', distM: 0, maskProxies: [4] });
    expect(plain.stats.buildings).toBe(total);
    expect(masked.stats.buildings).toBe(total - 2);
    expect(masked.stats.triangles).toBeLessThan(plain.stats.triangles);
    const t = (m: typeof plain): MeshBuffers => m.objects.find((o) => o.kind === 'terrain') as MeshBuffers;
    expect(sameBuffers(t(plain), t(masked))).toBe(true);
    const both = meshChunk(chunk, r, { tier: 'desktop', distM: 0, maskProxies: [4, 6] });
    expect(both.stats.buildings).toBe(total - 3);
    expect(both.masked).toEqual([4, 6]);
  });

  it('a mask that names no proxy of the chunk changes nothing, and the same mask twice is deterministic', () => {
    const { chunk, render: r } = withProxies();
    const plain = meshChunk(chunk, r, { tier: 'mobile-low', distM: 0 });
    const other = meshChunk(chunk, r, { tier: 'mobile-low', distM: 0, maskProxies: [99] });
    expect(other.masked).toEqual([]);
    expect(other.stats.triangles).toBe(plain.stats.triangles);
    const a = meshChunk(chunk, r, { tier: 'mobile-low', distM: 0, maskProxies: [4] });
    const b = meshChunk(chunk, r, { tier: 'mobile-low', distM: 0, maskProxies: [4] });
    a.objects.forEach((o, i) => expect(sameBuffers(o, b.objects[i] as MeshBuffers)).toBe(true));
  });

  it('a chunk without proxies reports none', () => {
    const c = sim[0]!;
    const m = meshChunk(c, render.find((x) => x.key === c.key) ?? null, { tier: 'mobile', distM: 0, maskProxies: [1] });
    expect(m.proxies).toEqual([]);
    expect(m.masked).toEqual([]);
  });
});
