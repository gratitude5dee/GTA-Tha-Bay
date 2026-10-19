/**
 * map CLI.
 *
 *   tsx tools/map/src/cli.ts fixture graybox [--check] [--out <dir>] [--hashes <file>]   (M01f)
 *   tsx tools/map/src/cli.ts build [--area sf|civic-excerpt|synth] [--stage <ids>] [--force] [--repro]   (M02a1)
 *   tsx tools/map/src/cli.ts fetch [--area sf|civic-excerpt] [--archive] [--fixture]
 *   tsx tools/map/src/cli.ts pack [--bake <bakeId> | --area <id>] --target dir:<path>|r2:<env>
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
import { failed } from './verify/gates.ts';

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
  console.error('usage: map <fixture|build|fetch|pack> ...');
  process.exit(2);
}
