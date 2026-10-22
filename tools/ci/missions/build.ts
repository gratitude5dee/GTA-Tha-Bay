/**
 * missions:build (C09 section C5 step 1, M05a1). Compiles `content/missions/<id>/mission.ts` and writes, byte-identical on a rerun:
 *   assets/src/data/mission.<id>/{asset.json, mission.json}        the compiled IR (schema mission-ir/1, at most 64 KiB)
 *   assets/src/data/director.<scriptId>/{asset.json, director.json} the DirectorScripts of the mission
 *   assets/src/data/story.index/{asset.json, story.index.json}      one MissionIndexRow per mission
 *   assets/src/data/lines.<act>.<lang>/{asset.json, lines.json}     the text of the lines and keys the missions use, per act
 *   content/audio-needs/story.json                                  the lines that need a voice, per speaker
 * and a provenance record (origin authored) for each new data file. The M01d `assets:lock` flow applies afterwards.
 *
 *   tsx tools/ci/missions/build.ts [--mission <id>] [--check]
 *
 * With `--check` nothing is written; the exit code is 1 when a file would change.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { MissionIndexRow, MissionIR } from '../../../packages/shared/src/index.ts';
import type { DirectorScript } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { compileStringMatcher } from '../../../packages/shared/src/index.ts';
import { compileRealNames } from '../../../packages/shared/src/assets/gates/names.ts';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { compileMission, type CompileEnv, type CompileError } from '../../../packages/modes/story/src/compiler/index.ts';
import { checkBeatsLock, emptyBeatsLock, type BeatsLock } from '../../../packages/modes/story/src/cutscene/beat.ts';
import type { CutsceneRef } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { loadCutsceneRefs, loadDirectorIds } from '../../assets/cutscene-index/refs.ts';
import { buildRecord } from '../../assets/provenance-new.ts';
import { buildTimeMs, isoSeconds } from '../../soul/src/common.ts';
import { loadRecords, readJson } from '../lib/common.ts';
import { loadRealSide } from '../names-lint.ts';
import { args } from '../run.ts';

export const IR_LIMIT_BYTES = 64 * 1024;
export const LINES_LIMIT_BYTES = 32 * 1024;
const MISSIONS_DIR = 'content/missions';
const LANG = 'en';

export interface BuildOptions {
  root: string;
  /** Build only this mission id. */
  mission?: string | undefined;
  log?: (line: string) => void;
  nowMs?: number;
}

export interface BuildPlan {
  /** Repo-relative path to file text. */
  files: Map<string, string>;
  /** Asset sources whose provenance record must exist: path to text. */
  data: { id: string; file: string; path: string; text: string; tags: string[] }[];
  errors: { mission: string; error: CompileError }[];
  problems: string[];
  missions: string[];
}

/** JSON with sorted keys, two-space indent and a final newline: the same value always gives the same bytes. */
export function stableJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as object).sort()) o[k] = sort((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function assetSpec(id: string, file: string, tags: string[]): string {
  return `${JSON.stringify({ kind: 'data', id, variants: { default: `assets/src/data/${id}/${file}` }, deps: [], tags, status: 'active', visibility: 'public' }, null, 2)}\n`;
}

/** The environment the compiler checks a mission against, read from the repository. */
export function loadEnv(
  root: string,
  mission: { lines: Record<string, string>; directors: Set<string>; cutscenes?: ReadonlyMap<string, { fallback: boolean }> },
  env: NodeJS.ProcessEnv = process.env,
): CompileEnv {
  const bounds = readJson<{ play: { minX: number; maxX: number; minZ: number; maxZ: number } }>(path.join(root, 'config/world.bounds.json')).play;
  const landmarks = new Set(readJson<{ landmarks: { id: string }[] }>(path.join(root, 'content/world/landmarks.json')).landmarks.map((l) => l.id));
  const i18nFile = path.join(root, 'packages/ui/src/i18n/en.json');
  const i18n = existsSync(i18nFile) ? new Set(Object.keys(readJson<Record<string, string>>(i18nFile))) : new Set<string>();
  const deny = readJson<Parameters<typeof compileStringMatcher>[0]>(path.join(root, 'config/ip-denylist.json'));
  const realSide = loadRealSide(env['DV_NAMES_REAL_JSON']);
  const names = realSide ? compileRealNames(realSide.entries) : [];
  const roster = rosterBasis(root);
  return {
    profile: 'story',
    bounds,
    worldBake: GRAYBOX_BAKE,
    lines: new Set(Object.keys(mission.lines)),
    lineText: mission.lines,
    i18n,
    landmarks,
    directors: mission.directors,
    ...(mission.cutscenes ? { cutscenes: mission.cutscenes } : {}),
    names,
    strings: compileStringMatcher(deny),
    realDerived: (who) => ('slot' in who ? true : roster.get(who.soul) === 'real_person'),
  };
}

/** The bake id of the gray-box fixture (`tests/fixtures/world/civic-graybox/README.md`): sha256 of the canonical bake description. */
export const GRAYBOX_BAKE = sha256Hex('{"configHashes":{},"sourceHashes":{},"toolVersion":"graybox@1"}');

function rosterBasis(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ['content/npcs/roster.json', 'content-private/npcs/roster.json']) {
    const p = path.join(root, f);
    if (!existsSync(p)) continue;
    for (const e of readJson<{ entries: { id: string; basis: string }[] }>(p).entries) out.set(e.id, e.basis);
  }
  return out;
}

function listMissionDirs(root: string, only?: string): string[] {
  const base = path.join(root, MISSIONS_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(base, d.name, 'mission.ts')) && (only === undefined || d.name === only))
    .map((d) => d.name)
    .sort();
}

/** Compiles every mission and plans every output file without writing anything. */
export async function planBuild(o: BuildOptions): Promise<BuildPlan> {
  const plan: BuildPlan = { files: new Map(), data: [], errors: [], problems: [], missions: [] };
  const dirs = listMissionDirs(o.root, o.mission);
  if (o.mission && dirs.length === 0) plan.problems.push(`no mission ${o.mission} under ${MISSIONS_DIR}`);
  const index: MissionIndexRow[] = [];
  // M05b2: the cutscene refs (content/story/**), their fallbacks, and the beat locks (D3.4): a beat edited without a rev bump fails.
  const refs: CutsceneRef[] = await loadCutsceneRefs(o.root);
  const directorIds = loadDirectorIds(o.root);
  const cutscenes = new Map(refs.map((r) => [r.id, { fallback: r.fallback !== '' && directorIds.has(r.fallback) }] as const));
  const lockFile = path.join(o.root, 'content/cutscenes/beats.lock.json');
  const lock: BeatsLock = existsSync(lockFile) ? readJson<BeatsLock>(lockFile) : emptyBeatsLock();
  for (const p of checkBeatsLock(refs, lock)) plan.problems.push(`beats.lock: ${p.ref} ${p.message}`);
  const linesByAct = new Map<number, Record<string, string>>();
  const audio: Record<string, { line: string; speaker: string }> = {};
  const addData = (id: string, file: string, text: string, tags: string[]): void => {
    plan.data.push({ id, file, path: `assets/src/data/${id}/${file}`, text, tags });
    plan.files.set(`assets/src/data/${id}/${file}`, text);
    plan.files.set(`assets/src/data/${id}/asset.json`, assetSpec(id, file, tags));
  };

  for (const dir of dirs) {
    const missionDir = path.join(o.root, MISSIONS_DIR, dir);
    const mod = (await import(`${pathToFileURL(path.join(missionDir, 'mission.ts')).href}`)) as { default?: MissionIR };
    const authored = mod.default;
    if (!authored) {
      plan.problems.push(`${dir}: mission.ts has no default export`);
      continue;
    }
    if (authored.id !== dir) plan.problems.push(`${dir}: the mission id is ${authored.id}, expected the directory name`);
    const linesFile = path.join(missionDir, `lines.${LANG}.json`);
    if (!existsSync(linesFile)) {
      plan.problems.push(`${dir}: lines.${LANG}.json is missing`);
      continue;
    }
    const lines = readJson<{ text: Record<string, string> }>(linesFile).text;
    const directors = new Map<string, DirectorScript>();
    const dirDir = path.join(missionDir, 'director');
    if (existsSync(dirDir)) {
      for (const f of readdirSync(dirDir).filter((n) => n.endsWith('.json') || n.endsWith('.ts')).sort()) {
        // a `.ts` script is written with `defineDirector` and default-exports the DirectorScript; a `.json` one is the data itself
        const d = f.endsWith('.ts')
          ? ((await import(`${pathToFileURL(path.join(dirDir, f)).href}`)) as { default: DirectorScript }).default
          : readJson<DirectorScript>(path.join(dirDir, f));
        directors.set(d.id, d);
      }
    }
    const env = loadEnv(o.root, { lines, directors: new Set([...directors.keys(), ...directorIds]), cutscenes });
    const res = compileMission(authored, env);
    for (const error of res.errors) plan.errors.push({ mission: dir, error });
    if (res.errors.length > 0) continue;
    plan.missions.push(dir);
    const irText = stableJson(res.ir);
    if (Buffer.byteLength(irText) > IR_LIMIT_BYTES) plan.problems.push(`${dir}: the IR is ${Buffer.byteLength(irText)} bytes (limit ${IR_LIMIT_BYTES})`);
    addData(`mission.${dir}`, 'mission.json', irText, ['story', `mission:${dir}`]);
    for (const [id, d] of directors) addData(`director.${id}`, 'director.json', stableJson(d), ['story', `mission:${dir}`]);
    index.push({
      id: res.ir.id, act: res.ir.act, district: res.ir.district, title: res.ir.title, giver: res.ir.giver, requires: res.ir.requires, start: res.ir.start,
      asset: `data/mission.${dir}`, version: res.ir.version, tags: res.ir.tags,
    });
    // the text of every key and line the mission refers to
    const used: Record<string, string> = linesByAct.get(res.ir.act) ?? {};
    // the cues of this mission's cutscene refs are shown by the video path and by its fallback alike
    const cueLines = new Set(refs.filter((r) => r.id.startsWith(`cut.story.${dir}.`)).flatMap((r) => r.cues.map((c) => c.line as string)));
    for (const cl of cueLines) if (!(cl in lines)) plan.problems.push(`${dir}: cue line ${cl} is not in lines.${LANG}.json`);
    for (const key of Object.keys(lines)) if (key.startsWith(`mission.${dir}.`) || res.ir.lines.includes(key as never) || cueLines.has(key) || key.startsWith('fail.reason.')) used[key] = lines[key] as string;
    linesByAct.set(res.ir.act, used);
    for (const a of res.audioNeeds) audio[a.line] = a;
  }

  if (plan.errors.length === 0 && plan.problems.length === 0) {
    if (index.length > 0) {
      addData('story.index', 'story.index.json', stableJson({ schema: 'story-index/1', rows: [...index].sort(byId) }), ['story']);
    }
    for (const [act, text] of [...linesByAct].sort((a, b) => a[0] - b[0])) {
      const body = stableJson({ schema: 'lines/1', lang: LANG, act, text });
      if (Buffer.byteLength(body) > LINES_LIMIT_BYTES) plan.problems.push(`lines.${act}.${LANG} is ${Buffer.byteLength(body)} bytes (limit ${LINES_LIMIT_BYTES})`);
      addData(`lines.${act}.${LANG}`, 'lines.json', body, ['story', `act:${act}`]);
    }
    const speakers: Record<string, string[]> = {};
    for (const a of Object.values(audio).sort((x, y) => (x.line < y.line ? -1 : 1))) (speakers[a.speaker] ??= []).push(a.line);
    plan.files.set('content/audio-needs/story.json', stableJson({ schema: 'audio-needs-story/1', speakers }));
  }
  return plan;
}

/** Writes the planned files that differ, adds provenance records for new data bytes, removes records of replaced bytes. */
export function writePlan(root: string, plan: BuildPlan, nowMs: number, log: (l: string) => void): string[] {
  const written: string[] = [];
  const put = (rel: string, text: string): void => {
    const abs = path.join(root, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === text) return;
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    written.push(rel);
  };
  for (const [rel, text] of plan.files) put(rel, text);
  const keep = new Set<string>();
  for (const d of plan.data) {
    const sha = sha256Hex(d.text);
    keep.add(sha);
    const recFile = `assets/provenance/${sha.slice(0, 2)}/${sha}.json`;
    if (!existsSync(path.join(root, recFile))) {
      const rec = buildRecord({ sha256: sha, paths: [d.path], kind: 'data', origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', authors: ['studio:dee-verse'], createdAt: isoSeconds(nowMs) });
      put(recFile, `${JSON.stringify(rec, null, 2)}\n`);
    }
  }
  // records of earlier bytes of the files this build owns
  const owned = new Set(plan.data.map((d) => d.path));
  for (const { file, raw } of loadRecords(root)) {
    const r = raw as { sha256?: string; paths?: string[] } | null;
    if (!r || typeof r.sha256 !== 'string' || !Array.isArray(r.paths) || r.paths.length === 0) continue;
    if (r.paths.every((p) => owned.has(p)) && !keep.has(r.sha256)) {
      rmSync(path.join(root, file));
      written.push(`${file} (removed)`);
    }
  }
  for (const w of written) log(`missions:build: wrote ${w}`);
  return written;
}

export async function runMissionsBuild(o: BuildOptions & { check?: boolean }): Promise<number> {
  const log = o.log ?? ((l: string) => console.log(l));
  const plan = await planBuild(o);
  for (const p of plan.problems) log(`missions:build: ${p}`);
  for (const e of plan.errors) log(`${e.mission}: ${e.error.code} ${e.error.pointer} ${e.error.message}`);
  if (plan.problems.length > 0 || plan.errors.length > 0) return 1;
  if (o.check) {
    let drift = 0;
    for (const [rel, text] of plan.files) {
      const abs = path.join(o.root, rel);
      if (!existsSync(abs) || readFileSync(abs, 'utf8') !== text) {
        log(`missions:build: ${rel} would change`);
        drift++;
      }
    }
    return drift === 0 ? 0 : 1;
  }
  writePlan(o.root, plan, o.nowMs ?? buildTimeMs(), log);
  for (const m of plan.missions) log(`${m} ok`);
  for (const d of plan.data) log(`  ${d.path}`);
  return 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: args(), options: { mission: { type: 'string' }, check: { type: 'boolean', default: false } } });
  const root = path.resolve(import.meta.dirname, '../../..');
  process.exitCode = await runMissionsBuild({ root, mission: values.mission, check: values.check });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
