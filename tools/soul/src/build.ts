/**
 * npc:build. Roster rules R1-R7 (spec/domains/04-npc-contracts.md section B5), lint of the roster's souls, compilation,
 * the C07 data assets `data/npc-roster` (NpcRosterBundle, active souls only) and `data/ink.<id>`, `souls/index.json`, and the
 * PRIVATE upload of prompt files (skipped without R2 credentials).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CompiledSoulPublic,
  NpcRosterBundle,
  NpcRosterEntry,
  NpcRosterManifest,
  SoulFrontmatter,
} from '../../../packages/shared/src/contracts/c10-npc.ts';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import { parseSoul } from '../../../packages/shared/src/npc/parse.ts';
import { publicSoulHash } from '../../../packages/shared/src/npc/compile.ts';
import { formatIssue, validateRoster, validateRosterBundle } from '../../../packages/shared/src/npc/validate.ts';
import { loadRecords } from '../../ci/lib/common.ts';
import { buildRecord } from '../../assets/provenance-new.ts';
import { rclonePreflight, rcloneEnv, spawnRunner } from '../../assets/src/uploader-rclone.ts';
import { buildTimeMs, discoverSouls, isoSeconds, PRIVATE_NPC_DIR, PUBLIC_NPC_DIR, readJson, readJsonIfExists } from './common.ts';
import { compileToFiles } from './compile.ts';
import { compileInk, inkJsonProblems } from './ink.ts';
import { buildLintEnv, lintFiles } from './lint.ts';
import type { LintIssue, SoulsIndex } from './lint.ts';

export interface RosterIssue { rule: string; id: string; message: string }

export interface RosterCaps { rosterSonnetMax: number; rosterStandardMax: number; rosterLeanMax: number }

export interface RosterInput {
  manifest: NpcRosterManifest;
  /** Frontmatter of each entry's soul, keyed by entry id (absent when the file is missing). */
  souls: ReadonlyMap<string, SoulFrontmatter>;
  /** Paths that exist (R1). */
  soulFileExists: (soulPath: string) => boolean;
  baseline: SoulsIndex | null;
  caps: RosterCaps;
}

export const rosterSha256 = (m: NpcRosterManifest): string =>
  sha256Hex(canonicalize([...m.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));

/** R1-R7. Schema errors come first and stop the run. */
export function checkRoster(input: RosterInput): RosterIssue[] {
  const out: RosterIssue[] = [];
  const add = (rule: string, id: string, message: string): void => {
    out.push({ rule, id, message });
  };
  const schema = validateRoster(input.manifest);
  if (schema.length) {
    for (const i of schema) add('schema', '-', formatIssue(i));
    return out;
  }
  const { entries } = input.manifest;
  const byId = new Map<string, NpcRosterEntry>();
  for (const e of entries) {
    if (byId.has(e.id)) add('R1', e.id, `id ${e.id} appears twice`);
    else byId.set(e.id, e);
    if (!input.soulFileExists(e.soul)) add('R1', e.id, `${e.soul} does not exist`);
  }
  let sonnet = 0;
  let standard = 0;
  let lean = 0;
  for (const e of entries) {
    const front = input.souls.get(e.id);
    if (front) {
      if (front.id !== e.id) add('R2', e.id, `soul id is ${front.id}`);
      if (front.tier !== e.tier) add('R2', e.id, `tier is ${e.tier} in the roster but ${front.tier} in the soul`);
      if (front.likeness.basis !== e.basis) add('R2', e.id, `basis is ${e.basis} in the roster but ${front.likeness.basis} in the soul`);
      if (front.roles.hero !== e.hero) add('R2', e.id, `hero is ${e.hero} in the roster but ${front.roles.hero} in the soul`);
      if (front.status !== e.status) add('R2', e.id, `status is ${e.status} in the roster but ${front.status} in the soul`);
      if (front.dialogue.modelTier === 'sonnet') sonnet++;
    }
    if (e.basis === 'real_person') {
      const si = e.standIn?.slice('character/'.length);
      const target = si ? byId.get(si) : undefined;
      if (!target || target.status !== 'active' || target.basis !== 'original') add('R3', e.id, 'a real-derived entry needs a standIn that resolves to an active original entry');
    }
    if (e.research === 'pending' && e.status !== 'draft') add('R6', e.id, 'research: pending entries stay status: draft');
    if (e.pipeline === 'standard') standard++;
    if (e.pipeline === 'lean') lean++;
    if (e.pipeline === 'premium') add('R7', e.id, 'no premium pipeline in v1');
  }
  if (sonnet > input.caps.rosterSonnetMax) add('R4', '-', `${sonnet} entries use Sonnet (limit ${input.caps.rosterSonnetMax})`);
  if (standard > input.caps.rosterStandardMax) add('R7', '-', `${standard} standard pipelines (limit ${input.caps.rosterStandardMax})`);
  if (lean > input.caps.rosterLeanMax) add('R7', '-', `${lean} lean pipelines (limit ${input.caps.rosterLeanMax})`);
  const b = input.baseline;
  if (b && rosterSha256(input.manifest) !== b.rosterSha256 && input.manifest.rosterVersion <= b.rosterVersion) {
    add('R5', '-', `the roster changed but rosterVersion is ${input.manifest.rosterVersion} (last release ${b.rosterVersion})`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export interface BuildOptions {
  root: string;
  out: string;
  release?: boolean;
  /** Upload PRIVATE prompt files to R2 (needs credentials). */
  upload?: boolean;
  /** `staging` or `prod` bucket of config/cloudflare.resources.json. */
  r2Env?: 'staging' | 'prod';
  /** Write assets/src/data/** sources and provenance records. */
  writeAssets?: boolean;
  /** Copy the fresh souls index over content/npcs/souls.index.json (the L14 baseline). */
  writeBaseline?: boolean;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  log?: (line: string) => void;
}

export interface BuildResult {
  ok: boolean;
  lint: LintIssue[];
  roster: RosterIssue[];
  problems: string[];
  bundle?: NpcRosterBundle;
  index?: SoulsIndex;
  outFiles: string[];
}

function writeIfChanged(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

const sortById = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

interface AssetSource { id: string; file: string; text: string; tags: string[] }

function assetSpecText(src: AssetSource): string {
  const dir = `assets/src/data/${src.id}`;
  return `${JSON.stringify({ kind: 'data', id: src.id, variants: { default: `${dir}/${src.file}` }, deps: [], tags: src.tags, status: 'active', visibility: 'public' }, null, 2)}\n`;
}

/** Writes asset.json, the source file and the provenance record; removes provenance records of earlier bytes of the same paths. */
function writeDataAsset(root: string, src: AssetSource, createdAt: string, keepShas: Set<string>): string[] {
  const dir = path.join(root, 'assets/src/data', src.id);
  const written: string[] = [];
  if (writeIfChanged(path.join(dir, src.file), src.text)) written.push(`assets/src/data/${src.id}/${src.file}`);
  if (writeIfChanged(path.join(dir, 'asset.json'), assetSpecText(src))) written.push(`assets/src/data/${src.id}/asset.json`);
  const sha = sha256Hex(src.text);
  keepShas.add(sha);
  const recFile = path.join(root, 'assets/provenance', sha.slice(0, 2), `${sha}.json`);
  if (!existsSync(recFile)) {
    const rec = buildRecord({
      sha256: sha,
      paths: [`assets/src/data/${src.id}/${src.file}`],
      kind: 'data',
      origin: 'authored',
      license: 'LicenseRef-DeeVerse-Owned',
      authors: ['studio:dee-verse'],
      createdAt,
    });
    mkdirSync(path.dirname(recFile), { recursive: true });
    writeFileSync(recFile, `${JSON.stringify(rec, null, 2)}\n`);
    written.push(path.relative(root, recFile).split(path.sep).join('/'));
  }
  return written;
}

function pruneStaleRecords(root: string, ownedPaths: Set<string>, keepShas: Set<string>): string[] {
  const removed: string[] = [];
  for (const { file, raw } of loadRecords(root)) {
    const r = raw as { sha256?: string; paths?: string[] } | null;
    if (!r || typeof r.sha256 !== 'string' || !Array.isArray(r.paths) || r.paths.length === 0) continue;
    if (r.paths.every((p) => ownedPaths.has(p)) && !keepShas.has(r.sha256)) {
      rmSync(path.join(root, file));
      removed.push(file);
    }
  }
  return removed;
}

export async function runBuild(o: BuildOptions): Promise<BuildResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const penv = o.env ?? process.env;
  const root = o.root;
  const result: BuildResult = { ok: false, lint: [], roster: [], problems: [], outFiles: [] };

  // manifests: public plus the private mount
  const manifests: NpcRosterManifest[] = [];
  for (const p of [`${PUBLIC_NPC_DIR}/roster.json`, `${PRIVATE_NPC_DIR}/roster.json`]) {
    const m = readJsonIfExists<NpcRosterManifest>(root, p);
    if (m) manifests.push(m);
  }
  if (manifests.length === 0) {
    result.problems.push(`${PUBLIC_NPC_DIR}/roster.json does not exist`);
    return result;
  }
  const manifest: NpcRosterManifest = {
    schema: 'npc-roster/1',
    rosterVersion: Math.max(...manifests.map((m) => m.rosterVersion)),
    entries: manifests.flatMap((m) => m.entries),
  };

  const baselinePath = path.join(root, 'content/npcs/souls.index.json');
  const baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as SoulsIndex) : null;
  const caps = readJson<{ caps: RosterCaps }>(root, 'config/npc.json').caps;

  // lint every soul the roster names (and flag souls on disk the roster does not name)
  const env = buildLintEnv({ root, env: penv, release: o.release ?? false });
  const soulFiles = manifest.entries.map((e) => e.soul).filter((p) => existsSync(path.join(root, p)));
  const { issues, results } = await lintFiles(root, soulFiles, env);
  result.lint = issues;

  const souls = new Map<string, SoulFrontmatter>();
  for (const e of manifest.entries) {
    const abs = path.join(root, e.soul);
    if (!existsSync(abs)) continue;
    try {
      souls.set(e.id, parseSoul(readFileSync(abs, 'utf8')).front);
    } catch {
      /* reported by lint */
    }
  }
  result.roster = checkRoster({ manifest, souls, soulFileExists: (p) => existsSync(path.join(root, p)), baseline, caps });
  const onDisk = new Set(manifest.entries.map((e) => e.soul));
  for (const f of discoverSouls(root)) {
    if (!onDisk.has(f)) result.roster.push({ rule: 'R1', id: f, message: `${f} has no roster entry` });
  }
  if (result.lint.length || result.roster.length) return result;

  // compile active souls
  const nowMs = o.nowMs ?? buildTimeMs(penv);
  const publics: CompiledSoulPublic[] = [];
  const index: SoulsIndex = { schema: 'souls-index/1', rosterVersion: manifest.rosterVersion, rosterSha256: rosterSha256(manifest), souls: {} };
  const outFiles: string[] = [];
  const out = path.resolve(root, o.out);
  const active = sortById(manifest.entries.filter((e) => e.status === 'active'));
  const inkSources: AssetSource[] = [];
  for (const e of active) {
    const c = await compileToFiles(root, e.soul, { out, rules: env.rules, env: penv, nowMs, log });
    publics.push(c.outputs.publicSoul);
    index.souls[c.id] = { soulVersion: c.soulVersion, promptSha256: c.promptSha256, publicSha256: publicSoulHash(c.outputs.publicSoul) };
    outFiles.push(`souls/${c.id}/${c.soulVersion}/soul.prompt.txt`, `souls/${c.id}/${c.soulVersion}/soul.compiled.json`);
    const front = results.get(e.soul)?.front as SoulFrontmatter;
    const inkText = env.readText(front.dialogue.ink) as string;
    const ink = compileInk(inkText);
    if (!ink.json) {
      result.problems.push(`${e.id}: ink does not compile: ${ink.errors.join('; ')}`);
      continue;
    }
    const bad = inkJsonProblems(ink.json);
    if (bad.length) result.problems.push(`${e.id}: data/ink.${e.id} ${bad.join('; ')}`);
    inkSources.push({ id: `ink.${e.id}`, file: 'ink.json', text: `${ink.json}\n`, tags: [`char:${e.id}`] });
  }
  const bundle: NpcRosterBundle = { schema: 'npc-roster-bundle/1', rosterVersion: manifest.rosterVersion, souls: sortById(publics) };
  const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
  for (const i of validateRosterBundle(bundle)) result.problems.push(`data/npc-roster: ${formatIssue(i)}`);
  for (const banned of ['"rails"', '"visual_brief"', '"prompt"', '<character', 'soul.prompt']) {
    if (bundleText.includes(banned)) result.problems.push(`data/npc-roster contains ${banned}`);
  }
  if (result.problems.length) return result;

  // index and copies under --out
  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  writeIfChanged(path.join(out, 'souls/index.json'), indexText);
  outFiles.push('souls/index.json');
  writeIfChanged(path.join(out, 'data/npc-roster.json'), bundleText);
  for (const s of inkSources) writeIfChanged(path.join(out, 'data', `${s.id}.json`), s.text);

  if (o.writeAssets !== false) {
    const created = isoSeconds(nowMs);
    const keep = new Set<string>();
    const sources: AssetSource[] = [{ id: 'npc-roster', file: 'npc-roster.json', text: bundleText, tags: ['npc-roster'] }, ...inkSources];
    for (const s of sources) for (const w of writeDataAsset(root, s, created, keep)) log(`npc:build: wrote ${w}`);
    const owned = new Set(sources.map((s) => `assets/src/data/${s.id}/${s.file}`));
    // ink assets of souls that left the roster
    for (const p of pruneStaleRecords(root, owned, keep)) log(`npc:build: removed stale ${p}`);
  }
  if (o.writeBaseline) {
    writeIfChanged(baselinePath, indexText);
    log('npc:build: wrote content/npcs/souls.index.json (the L14 baseline)');
  }

  // PRIVATE upload
  const missing = rclonePreflight(penv);
  if (missing.length) {
    const first = missing.includes('R2_ACCESS_KEY_ID') ? 'R2_ACCESS_KEY_ID' : (missing[0] as string);
    log(`SKIP npc:build PRIVATE upload: ${first} not set (souls/ files stay under ${o.out})`);
  } else if (!o.upload) {
    log('SKIP npc:build PRIVATE upload: credentials are set but --upload was not passed');
  } else {
    const resources = readJson<{ r2: Record<string, { PRIVATE: string }> }>(root, 'config/cloudflare.resources.json');
    const bucket = resources.r2[o.r2Env ?? 'staging']?.PRIVATE;
    if (!bucket) throw new Error(`no PRIVATE bucket for ${o.r2Env ?? 'staging'} in config/cloudflare.resources.json`);
    const renv = rcloneEnv(penv);
    for (const key of outFiles) {
      const r = spawnRunner('rclone', ['copyto', path.join(out, key), `r2:${bucket}/${key}`, '--header-upload', 'Cache-Control: private, no-store'], renv);
      if (r.status !== 0) throw new Error(`rclone copyto ${key} failed with exit ${r.status}: ${r.stderr.split('\n').slice(-2).join(' ').trim()}`);
    }
    log(`npc:build: uploaded ${outFiles.length} souls/ files to r2:${bucket}`);
  }

  result.bundle = bundle;
  result.index = index;
  result.outFiles = outFiles;
  result.ok = true;
  return result;
}
