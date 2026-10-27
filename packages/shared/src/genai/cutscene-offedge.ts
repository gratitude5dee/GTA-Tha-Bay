/**
 * The files of the off-edge cutscene finish (M05c4, DL-745, DL-748, DL-750). On Workers Free the Worker cannot transcode or re-sign, so a
 * generated clip leaves the Worker as `handoff.json` beside `orig.mp4`, the operator's `prewarm --finish` uploads `finish.json` and the
 * rendition files, and a publish phase copies them into MEDIA with the manifest last. All three files live in the PRIVATE bucket under
 * `cutscenes-orig/<key>/` and are private to the pipeline and the CLI; no contract shape changes (C09's `CutsceneManifest` is only read).
 *
 * Pure: types, key names, the hand validators (DL-694: no schema library in a Worker) and the one manifest builder that the in-Worker
 * mock path, the publish phase's checks and the operator's `--finish` all share.
 */
import type { CutsceneManifest, Rendition } from '../contracts/c09-cutscene.ts';
import type { GenJob } from './types.ts';

export const HANDOFF_SCHEMA = 'cutscene-handoff/1';
export const FINISH_SCHEMA = 'cutscene-finish/1';
export const REFUSED_SCHEMA = 'cutscene-refused/1';

/** `finish.json` is read whole inside a Worker step: its size is capped before it is decoded. */
export const FINISH_MAX_BYTES = 64 * 1024;

export const origPrefixOf = (key: string): string => `cutscenes-orig/${key}/`;
export const origKeyOf = (key: string): string => `${origPrefixOf(key)}orig.mp4`;
export const handoffKeyOf = (key: string): string => `${origPrefixOf(key)}handoff.json`;
export const finishKeyOf = (key: string): string => `${origPrefixOf(key)}finish.json`;
export const refusedKeyOf = (key: string): string => `${origPrefixOf(key)}refused.json`;
export const finishOutKeyOf = (key: string, runId: string, file: string): string => `${origPrefixOf(key)}out/${runId}/${file}`;
export const manifestKeyOf = (key: string): string => `cutscenes/${key}/manifest.json`;

/** What a file is cached as once it is public. Everything under `cutscenes/<key>/` is immutable for its key; the manifest is the ready test. */
export type CutsceneCacheClass = 'immutable' | 'manifest';
export const CUTSCENE_CACHE_CONTROL: Readonly<Record<CutsceneCacheClass, string>> = {
  immutable: 'public, max-age=31536000, immutable',
  manifest: 'public, max-age=300',
};

export interface HandoffShot {
  shotId: string;
  durationS: number;
  prompt: string;
  startFrame: number;
  frames: number;
}

/** `PRIVATE cutscenes-orig/<key>/handoff.json`: written by the Worker after `copy-orig`, read by `--finish` and the publish phase. */
export interface HandoffRecord {
  schema: typeof HANDOFF_SCHEMA;
  key: string;
  jobKey: string;
  /** The job as it ran: the publish phase re-runs the gate over it (cast, preset, inputs, prompts). */
  job: GenJob;
  plan: HandoffShot[];
  requestId: string;
  providerKey: string;
  endpoint: string;
  pinnedUpdatedAt: string;
  characters: CutsceneManifest['characters'];
  licence: CutsceneManifest['licence'];
  /** Scripted subtitles by language (VTT text). */
  subs: Record<string, string>;
  /** Spend already settled in the ledger. */
  costUsdMicros: number;
  at: number;
}

export interface CutsceneFinishFile {
  /** File name under `cutscenes/<key>/`. */
  file: string;
  bytes: number;
  sha256: string;
  contentType: string;
  cacheClass: CutsceneCacheClass;
}

/** `PRIVATE cutscenes-orig/<key>/finish.json`: the last upload of `--finish`. The files sit under `out/<runId>/`. */
export interface FinishRecord {
  schema: typeof FINISH_SCHEMA;
  key: string;
  runId: string;
  files: CutsceneFinishFile[];
  manifest: CutsceneManifest;
  at: number;
}

/** `PRIVATE cutscenes-orig/<key>/refused.json`: why the publish phase wrote nothing to MEDIA. */
export interface RefusedRecord {
  schema: typeof REFUSED_SCHEMA;
  key: string;
  runId: string;
  code: string;
  detail: string;
  at: number;
}

export type OffedgeParsed<T> = { ok: true; value: T } | { ok: false; error: string };

const HEX64 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function parseHandoff(text: string): OffedgeParsed<HandoffRecord> {
  const v = parseJson(text);
  if (!isRecord(v) || v['schema'] !== HANDOFF_SCHEMA) return { ok: false, error: `handoff.json: schema must be ${HANDOFF_SCHEMA}` };
  if (!isStr(v['key']) || !HEX64.test(v['key'])) return { ok: false, error: 'handoff.json: key must be 64 lowercase hex characters' };
  if (!isStr(v['jobKey']) || !isRecord(v['job']) || !isRecord(v['job']['params'])) return { ok: false, error: 'handoff.json: jobKey and job are required' };
  if (!Array.isArray(v['plan']) || v['plan'].length === 0) return { ok: false, error: 'handoff.json: plan must list the shots' };
  for (const s of v['plan'] as unknown[]) {
    if (!isRecord(s) || !isStr(s['shotId']) || !isNum(s['durationS']) || !isInt(s['startFrame']) || !isInt(s['frames'])) return { ok: false, error: 'handoff.json: a plan shot is malformed' };
  }
  if (!isStr(v['requestId']) || !isStr(v['providerKey']) || !isStr(v['endpoint']) || !isStr(v['pinnedUpdatedAt'])) return { ok: false, error: 'handoff.json: requestId, providerKey, endpoint and pinnedUpdatedAt are required' };
  if (!Array.isArray(v['characters']) || !isRecord(v['licence']) || !isRecord(v['subs'])) return { ok: false, error: 'handoff.json: characters, licence and subs are required' };
  if (!isInt(v['costUsdMicros']) || (v['costUsdMicros'] as number) < 0 || !isNum(v['at'])) return { ok: false, error: 'handoff.json: costUsdMicros must be a non-negative integer' };
  return { ok: true, value: v as unknown as HandoffRecord };
}

/** Hand validator of `finish.json` (DL-694). The caller has already capped the size at FINISH_MAX_BYTES. */
export function parseFinish(text: string): OffedgeParsed<FinishRecord> {
  const v = parseJson(text);
  if (!isRecord(v) || v['schema'] !== FINISH_SCHEMA) return { ok: false, error: `finish.json: schema must be ${FINISH_SCHEMA}` };
  if (!isStr(v['key']) || !HEX64.test(v['key'])) return { ok: false, error: 'finish.json: key must be 64 lowercase hex characters' };
  if (!isStr(v['runId']) || !RUN_ID.test(v['runId'])) return { ok: false, error: 'finish.json: runId is malformed' };
  if (!isNum(v['at'])) return { ok: false, error: 'finish.json: at must be epoch milliseconds' };
  if (!Array.isArray(v['files']) || v['files'].length === 0 || v['files'].length > 24) return { ok: false, error: 'finish.json: files must list 1 to 24 entries' };
  const seen = new Set<string>();
  for (const f of v['files'] as unknown[]) {
    if (!isRecord(f) || !isStr(f['file']) || !FILE_NAME.test(f['file'])) return { ok: false, error: 'finish.json: a file name is malformed' };
    if (f['file'] === 'manifest.json') return { ok: false, error: 'finish.json: manifest.json is written by the Worker, not copied' };
    if (seen.has(f['file'])) return { ok: false, error: `finish.json: ${f['file']} is listed twice` };
    seen.add(f['file']);
    if (!isInt(f['bytes']) || (f['bytes'] as number) <= 0) return { ok: false, error: `finish.json: ${f['file']} needs a positive byte count` };
    if (!isStr(f['sha256']) || !HEX64.test(f['sha256'])) return { ok: false, error: `finish.json: ${f['file']} needs a SHA-256` };
    if (!isStr(f['contentType']) || f['contentType'].length === 0 || f['contentType'].length > 64) return { ok: false, error: `finish.json: ${f['file']} needs a content type` };
    if (f['cacheClass'] !== 'immutable' && f['cacheClass'] !== 'manifest') return { ok: false, error: `finish.json: ${f['file']} has an unknown cache class` };
  }
  const m = v['manifest'];
  if (!isRecord(m) || m['schema'] !== 'cutscene-asset/1' || m['key'] !== v['key'] || m['recipe'] !== 'cut@1') return { ok: false, error: 'finish.json: manifest must be a cutscene-asset/1 for this key' };
  const prov = m['provenance'];
  if (!isRecord(prov) || prov['aiGenerated'] !== true || !isStr(prov['origSha256']) || !HEX64.test(prov['origSha256'])) return { ok: false, error: 'finish.json: manifest.provenance needs aiGenerated: true and origSha256' };
  if (!isRecord(m['renditions'])) return { ok: false, error: 'finish.json: manifest.renditions is required' };
  // Every file the manifest names must be one of the uploaded files, so a manifest never points at a missing object.
  const named: string[] = [];
  for (const r of Object.values(m['renditions'])) if (isRecord(r) && isStr(r['file'])) named.push(r['file']);
  if (isStr(m['poster'])) named.push(m['poster']);
  if (isStr(m['last'])) named.push(m['last']);
  if (isRecord(m['subs'])) for (const s of Object.values(m['subs'])) if (isStr(s)) named.push(s);
  for (const n of named) if (!seen.has(n)) return { ok: false, error: `finish.json: the manifest names ${n}, which is not in files` };
  if (!isRecord(m['renditions']['v768']) && !isRecord(m['renditions']['v540'])) return { ok: false, error: 'finish.json: the manifest needs a v768 or v540 rendition' };
  return { ok: true, value: v as unknown as FinishRecord };
}

export interface CutsceneFileMeta {
  file: string;
  bytes: number;
  sha256: string;
  contentType: string;
  codecs?: string;
  kbps?: number;
}

export interface CutsceneSignedMeta {
  sha256: string;
  bytes: number;
  c2pa: string;
}

export interface ManifestInput {
  key: string;
  plan: readonly { shotId: string; startFrame: number; frames: number }[];
  characters: CutsceneManifest['characters'];
  licence: CutsceneManifest['licence'];
  endpoint: string;
  pinnedUpdatedAt: string;
  requestId: string;
  origSha256: string;
  frames: number;
  width: number;
  height: number;
  /** Rendition id to the file name, e.g. `{ v768: 'v768.mp4' }`. */
  renditions: Readonly<Record<string, string>>;
  files: readonly CutsceneFileMeta[];
  /** Re-signed video files by name. */
  signed: Readonly<Record<string, CutsceneSignedMeta>>;
  origC2pa: CutsceneManifest['provenance']['c2pa'];
  /** Language to subtitle file name. */
  subs: Readonly<Record<string, string>>;
}

/** The one `CutsceneManifest` builder (05-assets-pipeline.md section 6 step 11). Captions are not run off-edge, so `audio` is absent (C09 allows it). */
export function buildCutsceneManifest(a: ManifestInput): CutsceneManifest {
  const renditions: CutsceneManifest['renditions'] = {};
  for (const [id, file] of Object.entries(a.renditions)) {
    const f = a.files.find((x) => x.file === file);
    if (f === undefined) continue;
    const s = a.signed[file];
    const r: Rendition = { file, bytes: s?.bytes ?? f.bytes, sha256: s?.sha256 ?? f.sha256, codecs: f.codecs ?? '', kbps: f.kbps ?? 0 };
    if (id === 'v540' || id === 'v768' || id === 'v1080' || id === 'p720') renditions[id] = r;
  }
  const signed = Object.values(a.signed);
  return {
    schema: 'cutscene-asset/1',
    key: a.key,
    recipe: 'cut@1',
    fps: 24,
    frames: a.frames,
    width: a.width,
    height: a.height,
    renditions,
    poster: 'poster.webp',
    last: 'last.webp',
    subs: { ...a.subs },
    shots: a.plan.map((s) => ({ shotId: s.shotId, startFrame: s.startFrame, frames: s.frames })),
    characters: a.characters,
    licence: a.licence,
    provenance: {
      endpoint: a.endpoint,
      pinnedUpdatedAt: a.pinnedUpdatedAt,
      requestIds: [a.requestId],
      origSha256: a.origSha256,
      c2pa: a.origC2pa,
      resigned: signed.length > 0 && signed.every((s) => s.c2pa !== 'invalid'),
      aiGenerated: true,
    },
  };
}
