import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaValidator, toolsRoot } from '../../ci/lib/common.ts';
import { CONTENT_DIR, contentStamp, contentWorldSha, loadContentWorld } from '../src/content.ts';
import { loadSources, mapSchema } from '../src/config.ts';
import { publishPack } from '../src/pack/publish.ts';
import { validateLandmarkSeeds, validateLandmarksInBake } from '../src/verify/landmarks.ts';
import { MIN_COUNTS, countsByKind, validatePoiSeeds, validatePoisInBake } from '../src/verify/pois.ts';
import { bakeExcerpt } from './helpers.ts';

const content = loadContentWorld();
const fails = (fs: { level: string }[]): { level: string }[] => fs.filter((f) => f.level === 'fail');

describe('landmark seeds against the section 7 table', () => {
  it('accepts the committed 37 seeds', () => {
    expect(content.landmarks).toHaveLength(37);
    expect(fails(validateLandmarkSeeds())).toEqual([]);
  });

  it('fails a duplicate id, a wrong chunk, a wrong ENU position and a missing or extra seed', () => {
    const base = content.landmarks;
    const dup = validateLandmarkSeeds([...base, base[0]!]);
    expect(dup.map((f) => f.id)).toContain('landmarks.unique');
    const chunk = validateLandmarkSeeds(base.map((s, i) => (i === 3 ? { ...s, chunk: '9/1/1' } : s)));
    expect(chunk.map((f) => f.id)).toContain('landmarks.chunk');
    const enu = validateLandmarkSeeds(base.map((s, i) => (i === 3 ? { ...s, x: s.x + 5 } : s)));
    expect(enu.map((f) => f.id)).toContain('landmarks.enu');
    const missing = validateLandmarkSeeds(base.slice(1));
    expect(missing.map((f) => f.id)).toContain('landmarks.missing');
    const extra = validateLandmarkSeeds([...base, { ...base[0]!, id: 'lm.not-in-the-table' }]);
    expect(extra.map((f) => f.id)).toContain('landmarks.extra');
  });

  it('warns instead of failing when the spec table is not in the checkout', () => {
    const r = validateLandmarkSeeds(content.landmarks, null);
    expect(r.map((f) => f.level)).toEqual(['warn']);
  });

  it('keeps the sandbox teleport list equal to the 37 landmarks', () => {
    expect([...content.teleports].sort()).toEqual(content.landmarks.map((l) => l.id).sort());
  });
});

describe('POI seeds', () => {
  it('accepts the committed seeds: at least 150, with the kind minimums and unique ids', () => {
    expect(content.pois.length).toBeGreaterThanOrEqual(150);
    const counts = countsByKind(content.pois);
    expect(counts['landmark']).toBe(37);
    expect(counts['transit']).toBe(8);
    expect(counts['hub']).toBe(41);
    expect(MIN_COUNTS['other']).toBe(45);
    expect(fails(validatePoiSeeds())).toEqual([]);
    expect(new Set(content.pois.map((p) => p.id)).size).toBe(content.pois.length);
  });

  it('fails an id prefix that is not the neighbourhood slug, a named or addressed home and a short list', () => {
    const base = content.pois;
    const prefix = validatePoiSeeds(base.map((p, i) => (i === 50 ? { ...p, nhood: 'somewhere-else' } : p)));
    expect(prefix.map((f) => f.id)).toContain('pois.prefix');
    const home = base.findIndex((p) => p.kind === 'home');
    const named = validatePoiSeeds(base.map((p, i) => (i === home ? { ...p, name: 'The Smith House' } : p)));
    expect(named.map((f) => f.id)).toContain('pois.home');
    const short = validatePoiSeeds(base.slice(0, 120));
    expect(short.map((f) => f.id)).toEqual(expect.arrayContaining(['pois.count', 'pois.total']));
    const dup = validatePoiSeeds([...base, base[10]!]);
    expect(dup.map((f) => f.id)).toContain('pois.unique');
  });

  it('fails a business name that matches the denylist (the ip:strings matcher)', () => {
    // a denylisted word read from the config at run time, so this file never spells one out
    const deny = JSON.parse(readFileSync(path.join(toolsRoot, 'config', 'ip-denylist.json'), 'utf8')) as { words: string[] };
    const word = deny.words.find((w) => /^[a-z]{5,}$/i.test(w))!;
    expect(word).toBeDefined();
    const biz = content.pois.findIndex((p) => p.kind === 'cafe');
    const r = validatePoiSeeds(content.pois.map((p, i) => (i === biz ? { ...p, name: `${word} Coffee` } : p)));
    expect(r.filter((f) => f.id === 'pois.name' && f.level === 'fail').length).toBeGreaterThan(0);
  });

  it('keeps the brand words of DL-664 in the denylist and out of every seed file', () => {
    const deny = JSON.parse(readFileSync(path.join(toolsRoot, 'config', 'ip-denylist.json'), 'utf8')) as { words: string[] };
    // assembled at run time so this file spells no brand out (ip:strings)
    const brands = [['wa', 'ymo'], ['tes', 'la'], ['trans', 'america'], ['sales', 'force'], ['ora', 'cle park'], ['chase', ' center']].map((p) => p.join(''));
    for (const w of brands) expect(deny.words).toContain(w);
    // rail and bus operator names are added to the denylist by M03b2; the seeds already avoid them
    const operators = [['b', 'art'], ['mu', 'ni'], ['cal', 'train']].map((p) => p.join(''));
    const dir = path.join(toolsRoot, 'content', 'world');
    for (const f of readdirSync(dir)) {
      if (!statSync(path.join(dir, f)).isFile()) continue;
      const text = readFileSync(path.join(dir, f), 'utf8').toLowerCase();
      for (const op of operators) expect(new RegExp(`(^|[^a-z])${op}([^a-z]|$)`).test(text), `${f} names ${op}`).toBe(false);
    }
  });
});

describe('places in a finished bake (civic-excerpt)', () => {
  it('has no failing landmark or POI finding and reports unbound POIs as warnings off sf', async () => {
    const b = await bakeExcerpt();
    expect(fails(validateLandmarksInBake(b.outDir, 'civic-excerpt'))).toEqual([]);
    const pois = validatePoisInBake(b.outDir, 'civic-excerpt');
    expect(fails(pois)).toEqual([]);
    expect(pois.every((f) => f.level === 'warn')).toBe(true);
    // the same unbound POI fails on sf
    expect(validatePoisInBake(b.outDir, 'sf').every((f) => f.level === 'fail')).toBe(true);
  });

  it('gives every baked landmark an arrival pose on ground and sets proxyOf on its l0 extrusion', async () => {
    const b = await bakeExcerpt();
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as { landmarks: { id: string; arrival: { x: number; z: number; yaw: number } }[] };
    expect(index.landmarks.length).toBe(3);
    for (const l of index.landmarks) {
      expect(Number.isFinite(l.arrival.x)).toBe(true);
      expect(Number.isFinite(l.arrival.yaw)).toBe(true);
    }
    const proxied = b.render.flatMap((c) => c.buildings).filter((x) => x.proxyOf > 0);
    expect(proxied.length).toBe((b.report as unknown as { places: { proxies: number } }).places.proxies);
    for (const x of proxied) expect(x.proxyOf).toBeLessThanOrEqual(index.landmarks.length);
  });
});

describe('content-world in the packed database (AC-10, DL-677)', () => {
  it('lists the content-world stamp in every derived record, with its own authored ODbL record', async () => {
    const b = await bakeExcerpt();
    const cfg = loadSources();
    const target = mkdtempSync(path.join(tmpdir(), 'dv-places-'));
    const r = await publishPack({ bakeDir: b.outDir, target: { kind: 'dir', path: target }, cfg, log: () => {} });
    expect(r.code).toBe(0);
    const stamp = r.packed.records.find((x) => x.origin === 'authored' && x.license === 'ODbL-1.0');
    expect(stamp, 'the content-world record').toBeDefined();
    const derived = r.packed.records.filter((x) => x.origin === 'derived');
    expect(derived.length).toBeGreaterThan(20);
    for (const rec of derived) expect(rec.derived_from).toContain(stamp!.sha256);
    const validate = schemaValidator('provenance-1.0');
    expect(validate(stamp)).toEqual([]);
  }, 60_000);

  it('changes the content-world sha256 when one POI name changes, and only then', () => {
    const copy = mkdtempSync(path.join(tmpdir(), 'dv-content-'));
    cpSync(CONTENT_DIR, copy, { recursive: true });
    expect(contentWorldSha(copy)).toBe(contentWorldSha());
    const file = path.join(copy, 'pois.json');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { pois: { name?: string; kind: string }[] };
    const cafe = doc.pois.find((p) => p.kind === 'cafe' && p.name !== undefined)!;
    cafe.name = `${cafe.name} Two`;
    writeFileSync(file, JSON.stringify(doc, null, 2));
    expect(contentWorldSha(copy)).not.toBe(contentWorldSha());
    const stamp = contentStamp(copy);
    expect(stamp).toMatchObject({ id: 'content-world', licence: 'ODbL-1.0' });
    expect(stamp.sha256).toBe(contentWorldSha(copy));
  });

  it('declares the baked database as a whole under ODbL 1.0 in sources.json', () => {
    const cfg = loadSources();
    expect(cfg.database.licence).toBe('ODbL-1.0');
    for (const a of ['world_pack/*', 'data/world-index', 'data/transit-routes.v1', 'map_data/*']) expect(cfg.database.assets).toContain(a);
    expect(cfg.database.note.length).toBeGreaterThan(20);
    expect(mapSchema('sources')(cfg)).toEqual([]);
  });
});
