/**
 * pnpm assets:plates (M05c2): renders the stage plate of each cutscene ref and pins its SHA-256 in `content/cutscenes/plates.lock.json`.
 *
 *   tsx tools/assets/plates/cli.ts [--refs act1|all|<ref id>,...] [--refresh] [--base <url>] [--webgpu] [--dry-run]
 *
 * The first shot of each ref's DirectorScript is rendered by `PlateRenderer` (headless Chromium, `?beats=plate`, actors hidden) into
 * `.cache/plates/<ref>.png`. Plates are rendered once and pinned: a ref whose stage already has a hash is not rendered again, and a
 * changed hash is only taken with `--refresh`. The upload to PRIVATE `plates/<sha256>.png` (with a provenance record, origin `derived`)
 * happens only when `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID` are set, else the tool prints
 * `SKIP assets:plates upload: R2_ACCESS_KEY_ID not set`. When no renderer can start (no QA plate bridge on the page, no browser), the tool
 * prints `SKIP assets:plates render: <reason>`, lists the refs that have no plate and exits 0: their cutscene keys are built without the
 * plate (and change when it is added).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { CutsceneRef, DirectorScript } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { args } from '../../ci/run.ts';
import { stableJson } from '../../ci/missions/build.ts';
import { buildTimeMs, isoSeconds } from '../../soul/src/common.ts';
import { spawnRunner } from '../src/uploader-rclone.ts';
import { loadCutsceneRefs } from '../cutscene-index/refs.ts';
import { sha256Hex } from '../../ci/lib/common.ts';
import {
  chromiumRenderer, emptyPlateLock, mergeLock, plateJobs, plateObjectKey, plateRecord, sha256Of,
  type PlateLock, type PlateRenderer, type RendererResult,
} from './render.ts';

export const PLATES_LOCK_PATH = 'content/cutscenes/plates.lock.json';
const ACT1_PREFIX = 'cut.story.m.a1.';

export interface PlatesOptions {
  root: string;
  /** `act1`, `all` or a comma list of ref ids. */
  refs: string;
  refresh: boolean;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (l: string) => void;
  nowMs?: number;
  /** The browser side; the CLI starts Chromium when absent. */
  renderer?: () => Promise<RendererResult>;
  run?: (cmd: string, argv: string[], env: NodeJS.ProcessEnv) => { status: number };
}

const hasR2 = (env: NodeJS.ProcessEnv): boolean => Boolean(env['R2_ACCESS_KEY_ID'] && env['R2_SECRET_ACCESS_KEY'] && env['CLOUDFLARE_ACCOUNT_ID']);
const SKIP_UPLOAD = 'SKIP assets:plates upload: R2_ACCESS_KEY_ID not set';

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

export function pickRefs(sel: string): (r: CutsceneRef) => boolean {
  if (sel === 'all') return () => true;
  if (sel === 'act1') return (r) => r.id.startsWith(ACT1_PREFIX);
  const ids = new Set(sel.split(',').filter(Boolean));
  return (r) => ids.has(r.id);
}

function loadDirectors(root: string): Map<string, DirectorScript> {
  const dir = path.join(root, 'assets/src/data');
  const out = new Map<string, DirectorScript>();
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    if (!e.startsWith('director.')) continue;
    const f = path.join(dir, e, 'director.json');
    if (existsSync(f)) {
      const d = readJson<DirectorScript>(f);
      out.set(d.id, d);
    }
  }
  return out;
}

/** Uploads one plate (and writes its provenance record) when the R2 credentials are set; returns whether it did. */
export function uploadPlate(
  o: { root: string; env: NodeJS.ProcessEnv; log: (l: string) => void; run: NonNullable<PlatesOptions['run']>; createdAt: string },
  file: string,
  sha256: string,
  derivedFrom: readonly string[],
): boolean {
  if (!hasR2(o.env)) return false;
  const bucket = o.env['DV_PRIVATE_BUCKET'] ?? 'tha-bay-private-staging';
  const r = o.run('rclone', ['copyto', file, `r2:${bucket}/${plateObjectKey(sha256)}`], {
    ...o.env,
    RCLONE_CONFIG_R2_TYPE: 's3',
    RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2_ENDPOINT: `https://${o.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: o.env['R2_ACCESS_KEY_ID'],
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: o.env['R2_SECRET_ACCESS_KEY'],
    RCLONE_CONFIG_R2_NO_CHECK_BUCKET: 'true',
  });
  if (r.status !== 0) {
    o.log(`assets:plates upload failed for ${sha256.slice(0, 12)} (rclone exit ${r.status})`);
    return false;
  }
  const rec = plateRecord(sha256, derivedFrom, sha256Hex(JSON.stringify({ shot: 'first', w: 1920, h: 1080 })), o.createdAt);
  const recFile = path.join(o.root, 'assets/provenance', sha256.slice(0, 2), `${sha256}.json`);
  mkdirSync(path.dirname(recFile), { recursive: true });
  writeFileSync(recFile, `${JSON.stringify(rec, null, 2)}\n`);
  return true;
}

export async function runPlates(o: PlatesOptions): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const env = o.env ?? process.env;
  const lockFile = path.join(o.root, PLATES_LOCK_PATH);
  const lock: PlateLock = existsSync(lockFile) ? readJson<PlateLock>(lockFile) : emptyPlateLock();
  const refs = await loadCutsceneRefs(o.root);
  const { jobs, problems } = plateJobs(refs, loadDirectors(o.root), pickRefs(o.refs));
  for (const p of problems) log(`assets:plates: ${p}`);
  if (problems.length > 0) return 1;
  if (jobs.length === 0) {
    log(`assets:plates: no refs match ${o.refs}`);
    return 1;
  }
  const todo = jobs.filter((j) => o.refresh || !lock.plates[j.stage]);
  const pinned = jobs.length - todo.length;
  log(`assets:plates: ${jobs.length} refs, ${pinned} pinned, ${todo.length} to render`);
  if (todo.length === 0 || o.dryRun) {
    for (const j of todo) log(`  ${j.ref}  ${j.stage}  mark ${j.mark} yaw ${j.yawDeg}  ${j.lens}`);
    return 0;
  }
  const made = await (o.renderer ?? (() => chromiumRenderer({ baseUrl: env['DV_PLATES_BASE_URL'] ?? 'http://localhost:5173', webgpu: true })))();
  if (!made.ok) {
    log(`SKIP assets:plates render: ${made.reason}`);
    log(`assets:plates: ${todo.length} refs have no plate: ${todo.map((j) => j.ref).join(', ')}`);
    if (!hasR2(env)) log(SKIP_UPLOAD);
    return 0;
  }
  const renderer: PlateRenderer = made.renderer;
  const outDir = path.join(o.root, '.cache/plates');
  mkdirSync(outDir, { recursive: true });
  const rendered: { stage: string; sha256: string; ref?: string }[] = [];
  const upload: { file: string; sha256: string; packs: string[] }[] = [];
  try {
    for (const j of todo) {
      const r = await renderer.render(j);
      const sha256 = sha256Of(r.png);
      const file = path.join(outDir, `${j.ref}.png`);
      writeFileSync(file, r.png);
      rendered.push({ stage: j.stage, sha256, ref: plateObjectKey(sha256) });
      upload.push({ file, sha256, packs: r.worldPacks });
      log(`  ${j.ref}  ${sha256.slice(0, 12)}  ${r.png.length} bytes`);
    }
  } finally {
    await renderer.close();
  }
  const merged = mergeLock(lock, rendered, o.refresh);
  for (const p of merged.problems) log(`assets:plates: ${p}`);
  mkdirSync(path.dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, stableJson(merged.lock));
  const createdAt = isoSeconds(o.nowMs ?? buildTimeMs());
  const run = o.run ?? spawnRunner;
  let uploaded = 0;
  for (const u of upload) if (uploadPlate({ root: o.root, env, log, run, createdAt }, u.file, u.sha256, u.packs)) uploaded++;
  if (uploaded === 0 && upload.length > 0 && !hasR2(env)) log(SKIP_UPLOAD);
  return merged.problems.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: {
      refs: { type: 'string', default: 'act1' },
      refresh: { type: 'boolean', default: false },
      base: { type: 'string' },
      webgpu: { type: 'boolean', default: true },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(import.meta.dirname, '../../..');
  const base = values.base ?? process.env['DV_PLATES_BASE_URL'] ?? 'http://localhost:5173';
  process.exitCode = await runPlates({
    root,
    refs: values.refs as string,
    refresh: values.refresh,
    dryRun: values['dry-run'],
    renderer: () => chromiumRenderer({ baseUrl: base, webgpu: values.webgpu }),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
