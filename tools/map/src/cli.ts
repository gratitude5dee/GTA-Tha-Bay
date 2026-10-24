/**
 * map CLI.
 *
 *   tsx tools/map/src/cli.ts fixture graybox [--check] [--out <dir>] [--hashes <file>]   (M01f)
 *   tsx tools/map/src/cli.ts build [--area sf|civic-excerpt|synth] [--stage <ids>] [--force] [--repro]   (M02a1)
 *   tsx tools/map/src/cli.ts fetch [--area sf|civic-excerpt] [--archive] [--fixture]
 *   tsx tools/map/src/cli.ts pack [--bake <bakeId> | --area <id>] --target dir:<path>|r2:<env>
 *   tsx tools/map/src/cli.ts verify [--bake <bakeId> | --area <id>]            (M02a2: the S14 gates on a finished bake)
 *   tsx tools/map/src/cli.ts landmarks [--bake <bakeId> | --area <id>]         (M02a2)
 *   tsx tools/map/src/cli.ts landmarks --build [--slug <id>] [--check]          (M02d1: the landmark models)
 *   tsx tools/map/src/cli.ts landmarks --preview <id> [--fidelity hi|mid|lo] [--az <deg>] [--el <deg>] [--dist <m>] [--eye x,y,z --look x,y,z] [--out <png>]
 *   tsx tools/map/src/cli.ts pois [--bake <bakeId> | --area <id>]              (M02a2)
 *   tsx tools/map/src/cli.ts resolve --lat=<y> --lng=<x> [--bake <id> | --area <id>]   (M02a2)
 *   tsx tools/map/src/cli.ts geocode "<text>" [--area <id> | --bake <id>]      (M02c2: the offline geocoder of sf-geocode.v1)
 *   tsx tools/map/src/cli.ts geocode --sample <n> [--area <id>]                (M02c2: n seeded EAS rows geocoded against the source)
 *
 * fixture, without --check, writes tests/fixtures/world/civic-graybox/{p0-64-64,l0-64-64}.pack and hashes.json.
 * With --check it builds both packs in memory, compares their SHA-256 with the committed hashes.json, prints
 * every differing file and exits 1 on a difference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { args } from '../../ci/run.ts';
import { isMain, sha256Hex, toolsRoot } from '../../ci/lib/common.ts';
import { runBake, runRepro, isStageId, STAGE_ORDER, type StageId } from './bake.ts';
import { DIST_ROOT, isAreaId, loadSources } from './config.ts';
import { encodeGraybox } from './fixtures/graybox.ts';
import { writeAttribution } from './pack/attribution.ts';
import { runFetch } from './stages/s0-fetch.ts';
import { parseTarget, publishPack } from './pack/publish.ts';
import { failed, type GateResult } from './verify/gates.ts';
import { verifyBakeDir } from './verify/verify.ts';
import { buildLandmarks, validateLandmarkAssets, validateLandmarkSeeds, validateLandmarksInBake, type Finding } from './verify/landmarks.ts';
import { validatePoiSeeds, validatePoisInBake, countsByKind } from './verify/pois.ts';
import { loadContentWorld } from './content.ts';
import { resolveLatLng } from './resolve.ts';
import { stableJson } from './util.ts';
import { runGeocodeCommand } from './geocode-cli.ts';

export const GRAYBOX_DIR = path.join(toolsRoot, 'tests', 'fixtures', 'world', 'civic-graybox');

/** Builds the packs and returns {file: sha256}. */
export function grayboxHashes(files: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) out[name] = sha256Hex(files[name] as Uint8Array);
  return out;
}

/** Returns the files whose hash differs from `expected` (or that are missing from it). */
export function diffHashes(actual: Record<string, string>, expected: Record<string, string>): string[] {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...names].sort().filter((n) => actual[n] !== expected[n]);
}

export function runFixture(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { check: { type: 'boolean', default: false }, out: { type: 'string' }, hashes: { type: 'string' } },
  });
  if (positionals[0] !== 'graybox') {
    console.error('usage: map:fixture graybox [--check] [--out <dir>] [--hashes <file>]');
    return 2;
  }
  const files = encodeGraybox();
  const actual = grayboxHashes(files);
  const dir = path.resolve(values.out ?? GRAYBOX_DIR);
  const hashesFile = path.resolve(values.hashes ?? path.join(GRAYBOX_DIR, 'hashes.json'));
  if (!values.check) {
    mkdirSync(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
    writeFileSync(path.join(dir, 'hashes.json'), `${JSON.stringify(actual, null, 2)}\n`);
    for (const [n, h] of Object.entries(actual)) console.log(`map:fixture graybox: wrote ${n} ${h}`);
    return 0;
  }
  if (!existsSync(hashesFile)) {
    console.error(`map:fixture graybox --check: ${hashesFile} does not exist`);
    return 1;
  }
  const expected = JSON.parse(readFileSync(hashesFile, 'utf8')) as Record<string, string>;
  const diff = diffHashes(actual, expected);
  for (const [n, h] of Object.entries(actual)) console.log(`map:fixture graybox: ${n} ${h}${diff.includes(n) ? ' DIFFERS' : ' ok'}`);
  if (diff.length) {
    for (const n of diff) console.error(`map:fixture graybox --check: ${n} differs from ${path.relative(toolsRoot, hashesFile)} (expected ${expected[n] ?? 'missing'}, built ${actual[n] ?? 'missing'})`);
    return 1;
  }
  return 0;
}

export async function runFetchCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { area: { type: 'string', default: 'sf' }, archive: { type: 'boolean', default: false }, fixture: { type: 'boolean', default: false } },
  });
  if (!isAreaId(values.area)) {
    console.error(`map:fetch: unknown area ${values.area} (sf, civic-excerpt or synth)`);
    return 2;
  }
  return runFetch({ area: values.area, archive: values.archive, fixture: values.fixture });
}

/** The bake directory a bake id, an area name (its latest bake) or nothing (the latest bake) names. */
export function resolveBake(sel: { bake?: string | undefined; area?: string | undefined }, root = DIST_ROOT): { bakeId: string; dir: string } | string {
  let bakeId = sel.bake;
  if (!bakeId) {
    const f = path.join(root, sel.area ? `latest-${sel.area}.json` : 'latest.json');
    if (!existsSync(f)) return `no ${path.basename(f)} in ${path.relative(toolsRoot, root)}; run pnpm map:build first`;
    bakeId = (JSON.parse(readFileSync(f, 'utf8')) as { bakeId: string }).bakeId;
  }
  if (!/^[0-9a-f]{64}$/.test(bakeId)) return `bake id must be 64 lowercase hex characters, got ${bakeId}`;
  const dir = path.join(root, bakeId);
  return existsSync(path.join(dir, 'bake-report.json')) ? { bakeId, dir } : `no finished bake at ${path.relative(toolsRoot, dir)}`;
}

export async function runPackCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { bake: { type: 'string' }, area: { type: 'string' }, target: { type: 'string' } },
  });
  const target = values.target ? parseTarget(values.target) : null;
  if (!target) {
    console.error('usage: map:pack [-- --bake <bakeId> | --area <id>] --target dir:<path>|r2:staging|r2:prod');
    return 2;
  }
  const sel = resolveBake({ bake: values.bake, area: values.area });
  if (typeof sel === 'string') {
    console.error(`map:pack: ${sel}`);
    return 1;
  }
  const r = await publishPack({ bakeDir: sel.dir, target });
  return r.code;
}

/** The latest bake of the selection, or null with the "no bake" case (no error: map:verify and the validators skip). */
function selectBake(values: { bake?: string | undefined; area?: string | undefined }): { bakeId: string; dir: string; area: string } | null | string {
  const sel = resolveBake(values);
  if (typeof sel === 'string') {
    if (!values.bake && /^no latest|^no finished bake/.test(sel)) return null;
    return sel;
  }
  const report = JSON.parse(readFileSync(path.join(sel.dir, 'bake-report.json'), 'utf8')) as { area: string };
  return { ...sel, area: report.area };
}

const SELECT_OPTIONS = { bake: { type: 'string' }, area: { type: 'string' } } as const;

export function printFindings(tool: string, findings: readonly Finding[]): number {
  for (const f of findings) console.log(`${f.level.toUpperCase().padEnd(4)} ${f.id}: ${f.detail}`);
  const fails = findings.filter((f) => f.level === 'fail').length;
  console.log(fails === 0 ? `${tool}: ok (${findings.length} findings, none failing)` : `${tool}: FAIL (${fails} failing)`);
  return fails === 0 ? 0 : 1;
}

export async function runVerifyCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], allowPositionals: true, options: SELECT_OPTIONS });
  const sel = selectBake(values);
  if (sel === null) { console.log('SKIP map:verify: no bake in dist/world'); return 0; }
  if (typeof sel === 'string') { console.error(`map:verify: ${sel}`); return 1; }
  const gates = verifyBakeDir(sel.dir);
  for (const g of gates) console.log(`gate ${g.level.toUpperCase().padEnd(4)} ${g.id}: ${g.detail}`);
  // the gate table goes into bake-report.json (the S14 rows are replaced, every other row stays)
  const file = path.join(sel.dir, 'bake-report.json');
  const report = JSON.parse(readFileSync(file, 'utf8')) as { gates: GateResult[]; ok: boolean };
  report.gates = [...report.gates.filter((g) => g.stage !== 'S14'), ...gates];
  report.ok = failed(report.gates).length === 0;
  writeFileSync(file, stableJson(report));
  const bad = failed(gates);
  console.log(bad.length === 0 ? `map:verify ok: bake ${sel.bakeId.slice(0, 12)} (${sel.area}), ${gates.length} S14 gates` : `map:verify FAIL: ${bad.map((g) => g.id).join(', ')}`);
  return bad.length === 0 ? 0 : 1;
}

export async function runLandmarksCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      ...SELECT_OPTIONS,
      build: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      slug: { type: 'string' },
      preview: { type: 'string' },
      fidelity: { type: 'string', default: 'hi' },
      az: { type: 'string', default: '35' },
      el: { type: 'string', default: '18' },
      dist: { type: 'string' },
      eye: { type: 'string' },
      look: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (values.preview) return runLandmarkPreview(values.preview, values);
  if (values.build) {
    const r = await buildLandmarks({ slug: values.slug, check: values.check });
    for (const p of r.plans) console.log(`map:landmarks: ${p.id} ${Object.entries(p.stats).map(([v, s]) => `${v} ${s.tris} tris ${s.primitives} objects`).join(', ')}`);
    if (!values.check && r.written.length > 0) console.log(`map:landmarks: wrote ${r.written.length} assets; run pnpm assets:catalog and pnpm assets:lock -- --approved-by <handle>`);
    const code = printFindings(values.check ? 'map:landmarks --build --check' : 'map:landmarks --build', r.findings);
    return code;
  }
  const findings = [...validateLandmarkSeeds(), ...validateLandmarkAssets()];
  const sel = selectBake(values);
  if (typeof sel === 'string') { console.error(`map:landmarks: ${sel}`); return 1; }
  if (sel) findings.push(...validateLandmarksInBake(sel.dir, sel.area));
  else console.log('map:landmarks: no bake in dist/world, seeds only');
  return printFindings('map:landmarks', findings);
}

async function runLandmarkPreview(id: string, v: { fidelity: string; az: string; el: string; dist?: string | undefined; out?: string | undefined; eye?: string | undefined; look?: string | undefined }): Promise<number> {
  const { recipeById } = await import('./landmarks/index.ts');
  const { renderPreview, writePreview } = await import('./landmarks/kit/preview.ts');
  const def = recipeById(id.startsWith('lm.') ? id : `lm.${id}`);
  const seed = loadContentWorld().landmarks.find((l) => l.id === def?.id);
  if (!def || !seed?.recipe) { console.error(`map:landmarks --preview: no recipe for ${id}`); return 2; }
  const f = v.fidelity === 'mid' || v.fidelity === 'lo' ? v.fidelity : 'hi';
  const out = v.out ?? path.join(DIST_ROOT, 'landmarks', `${def.id}-${f}.png`);
  mkdirSync(path.dirname(out), { recursive: true });
  const dist = v.dist ? Number(v.dist) : 220;
  const triple = (s: string | undefined): [number, number, number] | undefined => {
    const t = s?.split(',').map(Number);
    return t && t.length === 3 && t.every(Number.isFinite) ? (t as [number, number, number]) : undefined;
  };
  const eye = triple(v.eye), lookAt = triple(v.look);
  writePreview(out, renderPreview(def, seed.recipe as never, f, {
    azimuthDeg: Number(v.az), elevationDeg: Number(v.el), distance: dist, targetY: dist * 0.12, ...(eye && lookAt ? { eye, lookAt } : {}),
  }));
  console.log(`map:landmarks --preview: ${path.relative(toolsRoot, out)}`);
  return 0;
}

export async function runPoisCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], allowPositionals: true, options: SELECT_OPTIONS });
  const seeds = loadContentWorld().pois;
  const findings = validatePoiSeeds(seeds);
  console.log(`map:pois: ${seeds.length} seeds ${JSON.stringify(countsByKind(seeds))}`);
  const sel = selectBake(values);
  if (typeof sel === 'string') { console.error(`map:pois: ${sel}`); return 1; }
  if (sel) findings.push(...validatePoisInBake(sel.dir, sel.area));
  else console.log('map:pois: no bake in dist/world, seeds only');
  return printFindings('map:pois', findings);
}

export async function runResolveCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], allowPositionals: true, options: { ...SELECT_OPTIONS, lat: { type: 'string' }, lng: { type: 'string' } } });
  const lat = Number(values.lat), lng = Number(values.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { console.error('usage: map:resolve -- --lat=<y> --lng=<x> [--area <id> | --bake <id>]'); return 2; }
  const sel = selectBake(values);
  if (sel === null) { console.log('SKIP map:resolve: no bake in dist/world'); return 0; }
  if (typeof sel === 'string') { console.error(`map:resolve: ${sel}`); return 1; }
  const r = resolveLatLng(sel.dir, lat, lng);
  if (!r) { console.error(`map:resolve: no road within 200 m of ${lat}, ${lng} in bake ${sel.bakeId.slice(0, 12)}`); return 1; }
  console.log(`map:resolve: edge ${r.edge} (segment ${r.seg}) s ${r.s} m distance ${r.distM} m chunk ${r.chunk} nearest point (${r.x}, ${r.z}) bake ${sel.bakeId.slice(0, 12)} ${sel.area}`);
  return 0;
}

export async function runBuild(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      area: { type: 'string', default: 'civic-excerpt' },
      stage: { type: 'string' },
      force: { type: 'boolean', default: false },
      repro: { type: 'boolean', default: false },
    },
  });
  if (!isAreaId(values.area)) {
    console.error(`map:build: unknown area ${values.area} (sf, civic-excerpt or synth)`);
    return 2;
  }
  let stages: StageId[] | undefined;
  if (values.stage) {
    const ids = values.stage.split(',').map((x) => x.trim()).filter(Boolean);
    const bad = ids.filter((x) => !isStageId(x));
    if (bad.length > 0) {
      console.error(`map:build: unknown stage ${bad.join(', ')} (known: ${STAGE_ORDER.join(', ')})`);
      return 2;
    }
    stages = ids as StageId[];
  }
  const cfg = loadSources();
  if (writeAttribution(cfg)) console.log('map:build: regenerated config/attribution.world.json');
  const opts = { area: values.area, stages, force: values.force };
  if (values.repro) {
    const r = await runRepro(opts);
    return r.ok ? 0 : 1;
  }
  const r = await runBake(opts);
  console.log(r.ok ? `map:build ok: bake ${r.bakeId} in ${path.relative(toolsRoot, r.outDir)}` : `map:build FAIL: ${failed(r.gates).map((g) => g.id).join(', ')}`);
  return r.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = args();
  if (cmd === 'fixture') process.exit(runFixture(rest));
  if (cmd === 'build') process.exit(await runBuild(rest));
  if (cmd === 'fetch') process.exit(await runFetchCommand(rest));
  if (cmd === 'pack') process.exit(await runPackCommand(rest));
  if (cmd === 'verify') process.exit(await runVerifyCommand(rest));
  if (cmd === 'landmarks') process.exit(await runLandmarksCommand(rest));
  if (cmd === 'pois') process.exit(await runPoisCommand(rest));
  if (cmd === 'resolve') process.exit(await runResolveCommand(rest));
  if (cmd === 'geocode') process.exit(await runGeocodeCommand(rest));
  console.error('usage: map <fixture|build|fetch|pack|verify|landmarks|pois|resolve|geocode> ...');
  process.exit(2);
}
