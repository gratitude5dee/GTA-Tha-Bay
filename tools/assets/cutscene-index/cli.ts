/**
 * pnpm assets:cutscene-index (M05b2): builds the public `data/cutscene-index`, the private `cutscene-requests.json` and the key list
 * of the Worker's catalog. Writes, byte-identical on a rerun with the same SOURCE_DATE_EPOCH:
 *   assets/src/data/cutscene-index/{asset.json, index.json}     CutsceneIndex (public: no prompts, no URLs) and its provenance record
 *   services/edge/src/generated/cutscene-catalog.json           the keys route 27 may generate (mock keys stay)
 *   .private/releases/<release>/cutscene-requests.json          CutsceneRequest[] (git-ignored); uploaded to PRIVATE
 *                                                               cutscene-requests/<release>.json only with R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY
 *
 *   tsx tools/assets/cutscene-index/cli.ts [--release <tag>] [--check] [--update-lock] [--media <base url>] [--killed <ids>]
 *
 * `--update-lock` rewrites content/cutscenes/beats.lock.json (refused while a beat changed without a rev bump). `--media` lets the
 * carry-over rule HEAD `<base>/cutscenes/<key>/manifest.json`; without it every key counts as not ready (offline).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { CutsceneIndex } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { checkBeatsLock, emptyBeatsLock, updateBeatsLock, type BeatsLock } from '../../../packages/modes/story/src/cutscene/beat.ts';
import { loadLintBase } from '../../ci/prompt-lint.ts';
import { args } from '../../ci/run.ts';
import { assetSpec, stableJson, writePlan, type BuildPlan } from '../../ci/missions/build.ts';
import { buildTimeMs } from '../../soul/src/common.ts';
import { spawnRunner } from '../src/uploader-rclone.ts';
import { buildCutsceneIndex, REQUESTS_SCHEMA, type IndexResult } from './build.ts';
import { offlineReady, type ReadyPort } from './carry-over.ts';
import { loadCutsceneContent, loadCutsceneRefs, loadDirectorIds, loadTemplates } from './refs.ts';
import { fileSoulFacts } from './soul-facts.ts';

export const BEATS_LOCK_PATH = 'content/cutscenes/beats.lock.json';
export const CATALOG_PATH = 'services/edge/src/generated/cutscene-catalog.json';
const INDEX_ID = 'cutscene-index';
const INDEX_FILE = `assets/src/data/${INDEX_ID}/index.json`;

export interface CliOptions {
  root: string;
  release: string;
  builtAt: number;
  ready?: ReadyPort;
  updateLock?: boolean;
  killed?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface CliPlan {
  plan: BuildPlan;
  result: IndexResult;
  lockProblems: string[];
  lock: BeatsLock;
  /** The private requests file text and its repository-relative path (not part of `plan.data`). */
  requestsPath: string;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/** Computes every output without writing. */
export async function planCutsceneIndex(o: CliOptions): Promise<CliPlan> {
  const env = o.env ?? process.env;
  const refs = await loadCutsceneRefs(o.root);
  const content = loadCutsceneContent(o.root);
  const lockFile = path.join(o.root, BEATS_LOCK_PATH);
  const oldLock = existsSync(lockFile) ? readJson<BeatsLock>(lockFile) : emptyBeatsLock();
  const lockProblems: string[] = [];
  let lock = oldLock;
  if (o.updateLock) {
    const u = updateBeatsLock(refs, oldLock);
    lock = u.lock;
    lockProblems.push(...u.problems.map((p) => `${p.ref}: ${p.message}`));
  } else {
    lockProblems.push(...checkBeatsLock(refs, oldLock).map((p) => `${p.ref}: ${p.message}`));
  }

  const prevFile = path.join(o.root, INDEX_FILE);
  const previous = existsSync(prevFile) ? readJson<CutsceneIndex>(prevFile) : null;
  const result = await buildCutsceneIndex({
    release: o.release,
    builtAt: o.builtAt,
    refs,
    templates: loadTemplates(o.root),
    souls: fileSoulFacts(o.root, o.killed ?? []),
    registry: readJson<GenAiRegistry>(path.join(o.root, 'config/genai-endpoints.json')),
    seeds: content.seeds,
    places: content.places,
    styles: content.styles,
    plates: content.plates,
    directors: loadDirectorIds(o.root),
    previous,
    ready: o.ready ?? offlineReady,
    lint: loadLintBase(o.root, env),
  });

  const plan: BuildPlan = { files: new Map(), data: [], errors: [], problems: [...result.problems], missions: [] };
  // A rerun with nothing new keeps the old stamp, so the output is byte-identical.
  if (previous && previous.release === result.index.release && stableJson(previous.entries) === stableJson(result.index.entries)) result.index.builtAt = previous.builtAt;
  const indexText = stableJson(result.index);
  plan.data.push({ id: INDEX_ID, file: 'index.json', path: INDEX_FILE, text: indexText, tags: ['story', 'cutscene-index'] });
  plan.files.set(INDEX_FILE, indexText);
  plan.files.set(`assets/src/data/${INDEX_ID}/asset.json`, assetSpec(INDEX_ID, 'index.json', ['story', 'cutscene-index']));
  plan.files.set(BEATS_LOCK_PATH, stableJson(lock));

  // The catalog: the keys of this index plus the mock keys that were there before (they feed the demo script and the Worker tests).
  const catalogFile = path.join(o.root, CATALOG_PATH);
  const oldCatalog = existsSync(catalogFile) ? readJson<{ note?: string; mockKeys?: string[]; keys: string[] }>(catalogFile) : { keys: [] as string[] };
  const mockKeys = oldCatalog.mockKeys ?? oldCatalog.keys.slice(0, 1);
  plan.files.set(
    CATALOG_PATH,
    stableJson({
      schema: 'cutscene-catalog/1',
      note: 'Keys only, until the cutscene_catalog table (M05d). Written by pnpm assets:cutscene-index: the keys of the index plus the mock fixture keys.',
      mockKeys,
      keys: [...new Set([...mockKeys, ...result.catalogKeys])].sort(),
    }),
  );

  const requestsPath = `.private/releases/${o.release}/cutscene-requests.json`;
  plan.files.set(requestsPath, stableJson({ schema: REQUESTS_SCHEMA, release: o.release, requests: result.requests }));
  return { plan, result, lockProblems, lock, requestsPath };
}

/** Uploads the private requests file when the R2 credentials are set, else prints the SKIP line. Returns whether it uploaded. */
export function uploadRequests(
  o: { root: string; release: string; env: NodeJS.ProcessEnv; log: (l: string) => void; run?: (cmd: string, argv: string[], env: NodeJS.ProcessEnv) => { status: number } },
  file: string,
): boolean {
  if (!o.env['R2_ACCESS_KEY_ID'] || !o.env['R2_SECRET_ACCESS_KEY'] || !o.env['CLOUDFLARE_ACCOUNT_ID']) {
    o.log('SKIP cutscene-requests upload: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (and CLOUDFLARE_ACCOUNT_ID) not set');
    return false;
  }
  const bucket = o.env['DV_PRIVATE_BUCKET'] ?? 'tha-bay-private-staging';
  const run = o.run ?? spawnRunner;
  const r = run('rclone', ['copyto', file, `r2:${bucket}/cutscene-requests/${o.release}.json`], {
    ...o.env,
    RCLONE_CONFIG_R2_TYPE: 's3',
    RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2_ENDPOINT: `https://${o.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: o.env['R2_ACCESS_KEY_ID'],
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: o.env['R2_SECRET_ACCESS_KEY'],
    RCLONE_CONFIG_R2_NO_CHECK_BUCKET: 'true',
  });
  if (r.status !== 0) o.log(`cutscene-requests upload failed (rclone exit ${r.status})`);
  return r.status === 0;
}

function httpReady(base: string): ReadyPort {
  return {
    async has(key) {
      try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/cutscenes/${key}/manifest.json`, { method: 'HEAD' });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export async function runCutsceneIndex(o: CliOptions & { check?: boolean; log?: (l: string) => void }): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const p = await planCutsceneIndex(o);
  for (const n of loadLintBase(o.root, o.env ?? process.env).notes) log(n);
  for (const m of p.lockProblems) log(`beats.lock: ${m}`);
  for (const m of p.result.problems) log(`cutscene-index: ${m}`);
  if (p.lockProblems.length > 0 || p.result.problems.length > 0) return 1;
  if (o.check) {
    let drift = 0;
    for (const [rel, text] of p.plan.files) {
      const abs = path.join(o.root, rel);
      if (rel.startsWith('.private/')) continue;
      if (!existsSync(abs) || readFileSync(abs, 'utf8') !== text) {
        log(`cutscene-index: ${rel} would change`);
        drift++;
      }
    }
    return drift === 0 ? 0 : 1;
  }
  writePlan(o.root, p.plan, o.builtAt, (l) => log(l.replace(/^missions:build: /, 'cutscene-index: ')));
  const reqAbs = path.join(o.root, p.requestsPath);
  log(`cutscene-index: release ${o.release}, ${p.result.index.entries.length} refs`);
  for (const e of p.result.index.entries) log(`  ${e.ref}  ${e.key.slice(0, 12)}  ${e.provider}${e.stale ? '  stale' : ''}`);
  for (const r of p.result.suppressed) log(`  ${r}  suppressed (a cast member is killed)`);
  uploadRequests({ root: o.root, release: o.release, env: o.env ?? process.env, log }, reqAbs);
  return 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: {
      release: { type: 'string', default: 'dev' },
      check: { type: 'boolean', default: false },
      'update-lock': { type: 'boolean', default: false },
      media: { type: 'string' },
      killed: { type: 'string' },
    },
  });
  const root = path.resolve(import.meta.dirname, '../../..');
  process.exitCode = await runCutsceneIndex({
    root,
    release: values.release as string,
    builtAt: buildTimeMs(),
    check: values.check,
    updateLock: values['update-lock'],
    ...(values.media ? { ready: httpReady(values.media) } : {}),
    ...(values.killed ? { killed: values.killed.split(',').filter(Boolean) } : {}),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
