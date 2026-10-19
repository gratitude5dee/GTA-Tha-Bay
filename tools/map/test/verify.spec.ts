import { describe, expect, it } from 'vitest';
import { loadSources } from '../src/config.ts';
import type { PedReport } from '../src/stages/s8-ped.ts';
import type { PlacesReport } from '../src/stages/s10-places.ts';
import type { TagsReport } from '../src/stages/s9-tags.ts';
import { failed, s5Gates, s6Gates, s7Gates, s8Gates, s9Gates, s10Gates, s13Gates, type GateResult } from '../src/verify/gates.ts';
import { loadBakeDir, verifyBakeDir, verifyDecoded } from '../src/verify/verify.ts';
import { bakeExcerpt } from './helpers.ts';

const level = (rs: GateResult[], id: string): string | undefined => rs.find((r) => r.id === id)?.level;

describe('S5 to S10 gate functions', () => {
  const roads = {
    layerHistogram: {}, excludedActive: 0, unknownLayers: [] as string[], osmWays: 10, pieces: 10, droppedExcluded: 0, droppedAccess: 0, matchedPieces: 10,
    unmatchedPieces: 0, classOverrides: 0, segments: 10, edges: 20, nodes: 8, maxEdgesPerChunk: 20,
    oneway: { adopted: 'F-along' as const, agree1: 9, agree2: 0, comparable: 10, dsfOneOsmTwo: 0, ok: true, ratio1: 0.9, ratio2: 0, worst: [] },
  };
  it('fails the one-way gate when the agreement is too low and the chunk gate over 600 edges', () => {
    expect(level(s5Gates(roads as never, 0.9), 's5.oneway')).toBe('pass');
    expect(level(s5Gates({ ...roads, oneway: { ...roads.oneway, ok: false, ratio1: 0.5 } } as never, 0.9), 's5.oneway')).toBe('fail');
    expect(level(s5Gates({ ...roads, maxEdgesPerChunk: 601 } as never, 0.9), 's5.edges-per-chunk')).toBe('fail');
    expect(s5Gates({ ...roads, unknownLayers: ['X'] } as never, 0.9).find((r) => r.id === 's5.layers')?.level).toBe('warn');
  });

  const junctions = {
    junctions: 40, byControl: {}, movements: 200, restrictionsApplied: 0, restrictionsUnmatched: 0, maxApproaches: 5, maxOutDegree: 4, signalNoProgram: 0, mergedClusters: 0,
    signalMatch: { total: 100, matched: 99, ratio: 0.99, unmatched: [] },
  };
  it('fails a signal junction without a program, a signal match under the minimum and more than 8 approaches', () => {
    expect(failed(s6Gates(junctions, 0.98))).toEqual([]);
    expect(level(s6Gates({ ...junctions, signalNoProgram: 1 }, 0.98), 's6.signal-programs')).toBe('fail');
    expect(level(s6Gates({ ...junctions, signalMatch: { ...junctions.signalMatch, ratio: 0.9 } }, 0.98), 's6.signal-match')).toBe('fail');
    expect(level(s6Gates({ ...junctions, maxApproaches: 9 }, 0.98), 's6.approaches')).toBe('fail');
    expect(level(s6Gates({ ...junctions, junctions: 40000 }, 0.98), 's6.junction-ids')).toBe('fail');
  });

  it('fails a road steeper than 40 %, a slab step over 0.16 m and a slab over a missing chunk', () => {
    const ok = { maxGradePct: 39, slabs: 100, hoods: 0, tunnels: 0, openCuts: 0, overpasses: 1, namedSpans: 0, maxSlabStepM: 0.16, slabsDropped: 0, postsGraded: 10 };
    expect(failed(s7Gates(ok))).toEqual([]);
    expect(level(s7Gates({ ...ok, maxGradePct: 41 }), 's7.grade')).toBe('fail');
    expect(level(s7Gates({ ...ok, maxSlabStepM: 0.17 }), 's7.slab-steps')).toBe('fail');
    expect(level(s7Gates({ ...ok, slabsDropped: 1 }), 's7.deck-chunks')).toBe('fail');
  });

  it('warns, never fails, on weak ped connectivity, thinned tags and unsnapped breakers or portals', () => {
    const ped: PedReport = { nodes: 1, edges: 1, sidewalkKm: 1, crosswalks: 0, paths: 0, latticeNodes: 0, maxEdgesPerChunk: 10, thinnedChunks: 0, overLimit: [], tilesBelow85: [], minTileFraction: 0.99 };
    expect(level(s8Gates(ped), 's8.connectivity')).toBe('pass');
    expect(level(s8Gates({ ...ped, tilesBelow85: [{ tile: '1-2', fraction: 0.6 }] }), 's8.connectivity')).toBe('warn');
    expect(level(s8Gates({ ...ped, overLimit: ['9/1/1 (1600)'] }), 's8.chunk-limit')).toBe('fail');
    const tags: TagsReport = { counts: {}, thinned: {}, breakersSnapped: 1, breakersDropped: [], portalsSnapped: [], portalsMissing: [], countyLine: 0 };
    expect(level(s9Gates(tags), 's9.tag-limit')).toBe('pass');
    const weak = s9Gates({ ...tags, thinned: { hidingSpots: 3 }, breakersDropped: ['pb.x'], portalsMissing: ['portal.y'] });
    expect(weak.map((r) => r.level)).toEqual(['warn', 'warn', 'warn']);
  });

  it('fails a landmark without an arrival pose, and a landmark far from its OSM feature only on sf', () => {
    const places = { landmarks: 37, noArrival: [], featureTooFar: [{ id: 'lm.a', distM: 150 }], featureMissing: ['lm.b'] } as unknown as PlacesReport;
    expect(level(s10Gates(places, false), 's10.feature')).toBe('warn');
    expect(level(s10Gates(places, true), 's10.feature')).toBe('fail');
    expect(level(s10Gates({ ...places, noArrival: ['lm.c'] } as PlacesReport, false), 's10.arrival')).toBe('fail');
  });

  it('flags a key-like string in any output file and a pack over the limit', () => {
    const g = { packMaxBytes: 1000, packWarnBytes: 800 };
    const clean = s13Gates([{ name: 'p0-1-1.pack', bytes: 500 }], [{ name: 'a', bytes: new TextEncoder().encode('hello') }], g);
    expect(failed(clean)).toEqual([]);
    const pem = `-----BEGIN ${'PRIVATE'} KEY-----`;
    const dirty = s13Gates([{ name: 'p0-1-1.pack', bytes: 1001 }], [{ name: 'a', bytes: new TextEncoder().encode(pem) }], g);
    expect(failed(dirty).map((r) => r.id).sort()).toEqual(['s13.no-keys', 's13.pack-size']);
    expect(level(s13Gates([{ name: 'p', bytes: 900 }], [], g), 's13.pack-warn')).toBe('warn');
  });
});

describe('S14 verify on the civic-excerpt bake', () => {
  it('passes every gate on the finished bake and lists the graph, SCC, signal, portal and limit rows', async () => {
    const b = await bakeExcerpt();
    const rows = verifyBakeDir(b.outDir);
    expect(failed(rows)).toEqual([]);
    for (const id of ['s14.graph-counts', 's14.scc', 's14.lanes', 's14.signals', 's14.portal-routes', 's14.edges-per-chunk', 's14.out-degree', 's14.max-grade', 's14.chunk-limits', 's14.transit-schema']) {
      expect(level(rows, id), id).toBe('pass');
    }
    // the sf-only rows are not asked for here
    expect(rows.find((r) => r.id === 's14.hero-edges')).toBeUndefined();
    expect(rows.find((r) => r.id === 's14.landmarks')).toBeUndefined();
    // the bake report carries the same table
    const reported = b.report.gates.map((g) => g.id);
    for (const r of rows) expect(reported).toContain(r.id);
  });

  it('measures the SCC share as a ratio in the gate row (DL-669)', async () => {
    const b = await bakeExcerpt();
    const scc = verifyBakeDir(b.outDir).find((r) => r.id === 's14.scc')!;
    expect(scc.values!['fraction']).toBeGreaterThanOrEqual(0.98);
    expect(scc.values!['edges']).toBeGreaterThan(50);
  });

  it('fails when an edge has no lanes, a signal junction loses its program, or a portal is unreachable', async () => {
    const b = await bakeExcerpt();
    const cfg = loadSources();
    const fresh = (): ReturnType<typeof loadBakeDir> => loadBakeDir(b.outDir);
    const lanes = fresh();
    lanes.sims[0]!.edges[0]!.lanes = 0;
    expect(level(verifyDecoded(lanes, cfg), 's14.lanes')).toBe('fail');
    const sig = fresh();
    const j = sig.sims.flatMap((c) => c.junctions).find((x) => x.control === 1)!;
    delete (j as { program?: unknown }).program;
    expect(level(verifyDecoded(sig, cfg), 's14.signals')).toBe('fail');
    const portal = fresh();
    portal.index.portals = [{ id: 'portal.test', kind: 'county-line', x: 0, z: 0, edges: [999999], dest: null } as never];
    expect(level(verifyDecoded(portal, cfg), 's14.portal-routes')).toBe('fail');
  });

  it('fails on a graph that disagrees with the packs', async () => {
    const b = await bakeExcerpt();
    const g = loadBakeDir(b.outDir);
    g.graphBytes = g.graphBytes.slice(0, g.graphBytes.length - 18);   // one edge record short
    expect(() => verifyDecoded(g, loadSources())).toThrow();
  });
});
