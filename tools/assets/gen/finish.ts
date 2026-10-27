/**
 * `pnpm assets:gen prewarm -- --finish` (M05c4, DL-745, DL-748): the off-edge half of a live cutscene job. The Worker ran the fal-facing
 * steps and left each key `handed_off` with `orig.mp4` and `handoff.json` in the PRIVATE bucket. This runs steps 6 and 8 to 10 of
 * 05-assets-pipeline.md section 6 on the operator's workstation: transcode (`cut@1`, pinned ffmpeg), qa-gate, C2PA re-sign, scripted
 * subtitles, manifest. It uploads the files under `cutscenes-orig/<key>/out/<runId>/`, then `finish.json` as the last upload of a key, and
 * calls route 28 for the key; the Worker's publish phase re-runs the kill, consent and licence gate and copies the files to MEDIA, manifest
 * last. This code never holds a MEDIA key and never writes MEDIA.
 *
 * All local work (download, transcode, sign) for every key comes before the first upload, so a refusal (unsupported ffmpeg, a signing
 * credential that does not read back, a failed qa-gate) leaves the bucket as it was.
 *
 * Secrets (names only): `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY` (scoped to tha-bay-private-{staging,prod}, DL-287),
 * `CLOUDFLARE_ACCOUNT_ID`, `OPS_TOKEN`; `C2PA_CERT_CHAIN_PEM`, `C2PA_KEY_PEM` (never in CI or the Worker). Absent: a SKIP line and exit 0,
 * except `--env prod` without the signing pair, which refuses with exit 1.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FINISH_SCHEMA, buildCutsceneManifest, finishKeyOf, finishOutKeyOf, handoffKeyOf, manifestKeyOf, origKeyOf, parseHandoff, refusedKeyOf,
  type CutsceneFinishFile, type CutsceneFileMeta, type FinishRecord, type HandoffRecord,
} from '../../../packages/shared/src/genai/cutscene-offedge.ts';
import type { CutsceneManifest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { SignPort, TranscodePort, TranscodeResult } from '../../../services/pipeline/src/ports.ts';
import type { RemoteFiles } from '../src/uploader-rclone.ts';
import { qaVerdict, type OffEdgeTranscode } from './ffmpeg-port.ts';

export interface FinishOptions {
  release: string;
  env: 'staging' | 'prod';
  ffmpeg: 'native' | 'docker';
  /** `--local`: the original to run through the ladder and the re-signer without R2 or the Worker. */
  local?: string;
  /** `--local`: the output directory. */
  out?: string;
}

export interface FinishPorts {
  log(line: string): void;
  env: NodeJS.ProcessEnv;
  /** The PRIVATE bucket as `rclone` sees it; built only once the credentials are known to be there. */
  makeRemote(): RemoteFiles;
  makeTranscode(): TranscodePort;
  makeSign(): SignPort;
  /** Route 28 and route 27 of our Worker. */
  api: { prewarm(keys: string[]): Promise<CutsceneStatus[]>; status(key: string): Promise<CutsceneStatus> } | null;
  clock: { now(): number; sleep(ms: number): Promise<void> };
  /** Scratch directory root; default: the system temporary directory. */
  tmpRoot?: string;
  /** How long to wait for the Worker's publish phase per run, and how often to look. */
  pollMs?: number;
  pollLimitMs?: number;
}

export const SIGNING_VARS = ['C2PA_CERT_CHAIN_PEM', 'C2PA_KEY_PEM'] as const;
export const PRIVATE_VARS = ['R2_PRIVATE_ACCESS_KEY_ID', 'R2_PRIVATE_SECRET_ACCESS_KEY', 'CLOUDFLARE_ACCOUNT_ID'] as const;

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const enc = (v: unknown): string => `${JSON.stringify(v)}\n`;

/** The env handed to rclone: the private-bucket pair under the names M01d's uploader reads, and no media pair, whatever the shell holds. */
export function privateRcloneEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'XDG_CONFIG_HOME']) if (env[k] !== undefined) out[k] = env[k];
  out['R2_ACCESS_KEY_ID'] = env['R2_PRIVATE_ACCESS_KEY_ID'] ?? '';
  out['R2_SECRET_ACCESS_KEY'] = env['R2_PRIVATE_SECRET_ACCESS_KEY'] ?? '';
  out['CLOUDFLARE_ACCOUNT_ID'] = env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  return out;
}

interface Prepared {
  key: string;
  runId: string;
  dir: string;
  files: CutsceneFinishFile[];
  manifest: CutsceneManifest;
}

/** The files of one key, hashed, signed and described; the same builder as the Worker's own path. */
async function prepare(args: {
  key: string;
  handoff: HandoffRecord;
  orig: Uint8Array;
  transcode: TranscodePort;
  sign: SignPort;
  workDir: string;
  now: number;
}): Promise<Prepared | { failed: string }> {
  const { key, handoff, orig } = args;
  const origSha = sha256(orig);
  const tc: TranscodeResult & Partial<Pick<OffEdgeTranscode, 'qa'>> = await args.transcode.transcode(orig);

  // qa-gate: frame count within 17 of the plan, no mostly black or frozen clip, sane loudness
  const expected = handoff.plan.reduce((n, s) => n + s.frames, 0);
  if (tc.qa !== undefined) {
    const verdict = qaVerdict(tc.qa, expected);
    if (!verdict.ok) return { failed: `qa-gate: ${verdict.reasons.join('; ')}` };
  } else if (!(tc.frames > 0)) {
    return { failed: 'qa-gate: the transcode reported no frames' };
  }

  // resign: every video rendition, orig.mp4 as the ingredient
  const signed: Record<string, { sha256: string; bytes: number; c2pa: string }> = {};
  const outFiles = new Map<string, { bytes: Uint8Array; contentType: string }>();
  for (const f of tc.files) {
    let bytes = f.bytes;
    if (f.contentType.startsWith('video/')) {
      const s = await args.sign.resign({ file: f.file, bytes: f.bytes, contentType: f.contentType }, orig);
      bytes = s.bytes;
      signed[f.file] = { sha256: sha256(bytes), bytes: bytes.length, c2pa: s.c2pa };
    }
    outFiles.set(f.file, { bytes, contentType: f.contentType });
  }

  // subs: the scripted VTT of the job
  const subs: Record<string, string> = {};
  for (const [lang, vtt] of Object.entries(handoff.subs)) {
    if (typeof vtt !== 'string') continue;
    const file = `subs.${lang}.vtt`;
    outFiles.set(file, { bytes: new TextEncoder().encode(vtt), contentType: 'text/vtt' });
    subs[lang] = file;
  }

  const metas: CutsceneFileMeta[] = [];
  const files: CutsceneFinishFile[] = [];
  for (const [file, f] of outFiles) {
    const src = tc.files.find((x) => x.file === file);
    metas.push({ file, bytes: f.bytes.length, sha256: sha256(f.bytes), contentType: f.contentType, ...(src?.codecs !== undefined ? { codecs: src.codecs } : {}), ...(src?.kbps !== undefined ? { kbps: src.kbps } : {}) });
    files.push({ file, bytes: f.bytes.length, sha256: sha256(f.bytes), contentType: f.contentType, cacheClass: 'immutable' });
  }
  const manifest = buildCutsceneManifest({
    key, plan: handoff.plan, characters: handoff.characters, licence: handoff.licence, endpoint: handoff.endpoint, pinnedUpdatedAt: handoff.pinnedUpdatedAt, requestId: handoff.requestId,
    origSha256: origSha, frames: tc.frames, width: tc.width, height: tc.height, renditions: tc.renditions, files: metas, signed, origC2pa: tc.origC2pa, subs,
  });
  if (manifest.provenance.resigned !== true) return { failed: 'the renditions were not re-signed' };
  if (manifest.renditions.v768 === undefined && manifest.renditions.v540 === undefined) return { failed: 'the ladder produced no v768 or v540 rendition' };

  const dir = path.join(args.workDir, key);
  mkdirSync(path.join(dir, 'out'), { recursive: true });
  for (const [file, f] of outFiles) writeFileSync(path.join(dir, 'out', file), f.bytes);
  const runId = `r${args.now.toString(36)}-${origSha.slice(0, 8)}`;
  return { key, runId, dir, files, manifest };
}

/** Which keys wait: a handoff.json, no finish.json. Names come from a recursive listing of `cutscenes-orig/`. */
export function pendingKeys(listing: readonly string[]): string[] {
  const has = new Map<string, Set<string>>();
  for (const name of listing) {
    const [key, ...rest] = name.split('/');
    if (key === undefined || !/^[0-9a-f]{64}$/.test(key)) continue;
    const set = has.get(key) ?? new Set<string>();
    set.add(rest.join('/'));
    has.set(key, set);
  }
  return [...has].filter(([, s]) => s.has('handoff.json') && !s.has('finish.json')).map(([k]) => k).sort();
}

export interface FinishResult {
  code: number;
  /** Local mode: the key the original was filed under. */
  key?: string;
  /** Remote mode: the order of uploads, for the report and the tests. */
  uploads?: string[];
}

/** `--finish --local <orig.mp4> --out <dir>`: the ladder and the re-signer over one file, no R2 and no Worker. */
async function runLocal(o: FinishOptions, p: FinishPorts): Promise<FinishResult> {
  if (o.out === undefined) {
    p.log('refused: --local needs --out <dir>');
    return { code: 2 };
  }
  const orig = new Uint8Array(readFileSync(o.local!));
  const key = sha256(orig); // a local original has no job: its content hash stands in for the cutscene key
  const work = mkdtempSync(path.join(p.tmpRoot ?? os.tmpdir(), 'dv-finish-'));
  try {
    const transcode = p.makeTranscode();
    const probe = await transcode.transcode(orig);
    const handoff: HandoffRecord = {
      schema: 'cutscene-handoff/1', key, jobKey: key, job: { schema: 'genjob/1', jobKey: key, kind: 'cutscene_shot', endpointKey: 'local', env: 'test', subject: { assetRef: `cutscene/cut-${key.slice(0, 16)}` }, params: {}, inputs: [], promptTemplate: 'local@1', promptSha256: key, budgetUsdMicros: 0, requestedBy: 'finish:local' },
      plan: [{ shotId: 's1', durationS: probe.frames / 24, prompt: '', startFrame: 0, frames: probe.frames }], requestId: 'local', providerKey: 'local', endpoint: 'local', pinnedUpdatedAt: '',
      characters: [], licence: { gate: 'ADR-GENAI-01', provider: 'local', status: 'pending', termsSnapshotSha256: [] }, subs: {}, costUsdMicros: 0, at: p.clock.now(),
    };
    const prepared = await prepare({ key, handoff, orig, transcode: { transcode: () => Promise.resolve(probe) }, sign: p.makeSign(), workDir: work, now: p.clock.now() });
    if ('failed' in prepared) {
      p.log(`finish --local: ${prepared.failed}`);
      return { code: 1 };
    }
    const dest = path.join(o.out, key);
    mkdirSync(dest, { recursive: true });
    for (const f of prepared.files) writeFileSync(path.join(dest, f.file), readFileSync(path.join(prepared.dir, 'out', f.file)));
    writeFileSync(path.join(dest, 'manifest.json'), enc(prepared.manifest));
    writeFileSync(path.join(o.out, 'cutscene-index.json'), enc({ schema: 'cutscene-index/1', entries: [{ key }] }));
    p.log(`finish --local ok: ${key.slice(0, 12)} -> ${dest} (${prepared.files.map((f) => f.file).join(', ')}, manifest.json) and ${path.join(o.out, 'cutscene-index.json')}`);
    return { code: 0, key };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function runFinish(o: FinishOptions, p: FinishPorts): Promise<FinishResult> {
  // 1. credentials: production refuses without the signing pair; anything else absent is a SKIP
  const missingSign = SIGNING_VARS.filter((v) => !p.env[v]);
  if (missingSign.length > 0) {
    if (o.env === 'prod') {
      p.log(`refused: --finish --env prod needs ${missingSign.join(' and ')} in the shell (the re-signer's chain and key); nothing was uploaded`);
      return { code: 1 };
    }
    p.log(`SKIP finish: ${missingSign.join(', ')} not set (the re-signer's chain and key come from the operator's shell); nothing was done`);
    return { code: 0 };
  }
  if (o.local !== undefined) return runLocal(o, p);

  const missing = [...PRIVATE_VARS, 'OPS_TOKEN'].filter((v) => !p.env[v]);
  if (missing.length > 0 || p.api === null) {
    p.log(`SKIP finish: ${missing.length > 0 ? missing.join(', ') : 'the API host'} not set (the private bucket pair of ${o.env}, the account and the staff token); nothing was done`);
    return { code: 0 };
  }

  const remote = p.makeRemote();
  const keys = pendingKeys(remote.list('cutscenes-orig/'));
  const todo: string[] = [];
  for (const key of keys) {
    const st = await p.api.status(key);
    if (st.state === 'ready') continue;
    if (st.state === 'blocked') {
      p.log(`skip ${key.slice(0, 12)}: blocked (a kill or quarantine is in force)`);
      continue;
    }
    todo.push(key);
  }
  if (todo.length === 0) {
    p.log('finish: no handed-off key waits for a finish');
    return { code: 0, uploads: [] };
  }
  p.log(`finish: ${todo.length} key(s) to finish`);

  // 2. local work for every key first: download, transcode, qa-gate, re-sign. Nothing is uploaded yet.
  const work = mkdtempSync(path.join(p.tmpRoot ?? os.tmpdir(), 'dv-finish-'));
  const prepared: Prepared[] = [];
  let code = 0;
  try {
    const transcode = p.makeTranscode();
    const sign = p.makeSign();
    for (const key of todo) {
      const handoffRaw = remote.readJson(handoffKeyOf(key));
      const parsed = handoffRaw === null ? null : parseHandoff(JSON.stringify(handoffRaw));
      if (parsed === null || !parsed.ok) {
        p.log(`failed ${key.slice(0, 12)}: ${parsed === null ? 'handoff.json vanished' : parsed.error}`);
        code = 1;
        continue;
      }
      const origPath = path.join(work, `${key}.orig.mp4`);
      remote.download(origKeyOf(key), origPath);
      const r = await prepare({ key, handoff: parsed.value, orig: new Uint8Array(readFileSync(origPath)), transcode, sign, workDir: work, now: p.clock.now() });
      if ('failed' in r) {
        p.log(`failed ${key.slice(0, 12)}: ${r.failed}; nothing was uploaded for it`);
        code = 1;
        continue;
      }
      prepared.push(r);
      p.log(`prepared ${key.slice(0, 12)}: ${r.files.map((f) => f.file).join(', ')}`);
    }

    // 3. upload: the files under out/<runId>/, finish.json last, then route 28 for the key
    const uploads: string[] = [];
    const finished: Prepared[] = [];
    for (const k of prepared) {
      for (const f of k.files) {
        const remoteKey = finishOutKeyOf(k.key, k.runId, f.file);
        remote.putFile(path.join(k.dir, 'out', f.file), remoteKey, { contentType: f.contentType });
        uploads.push(remoteKey);
      }
      const finish: FinishRecord = { schema: FINISH_SCHEMA, key: k.key, runId: k.runId, files: k.files, manifest: k.manifest, at: p.clock.now() };
      const finishFile = path.join(k.dir, 'finish.json');
      writeFileSync(finishFile, enc(finish));
      remote.putFile(finishFile, finishKeyOf(k.key), { contentType: 'application/json' });
      uploads.push(finishKeyOf(k.key));
      await p.api.prewarm([k.key]);
      finished.push(k);
    }

    // 4. wait for the Worker's publish phase: ready, or refused.json for this run
    const poll = p.pollMs ?? 5_000;
    const limit = p.pollLimitMs ?? 10 * 60 * 1000;
    const started = p.clock.now();
    const open = new Map(finished.map((k) => [k.key, k]));
    while (open.size > 0) {
      for (const [key, k] of [...open]) {
        const st = await p.api.status(key);
        if (st.state === 'ready') {
          p.log(`ready ${key.slice(0, 12)}: ${st.manifestUrl ?? manifestKeyOf(key)}`);
          open.delete(key);
          continue;
        }
        const refused = remote.readJson(refusedKeyOf(key)) as { runId?: string; code?: string; detail?: string } | null;
        if (refused !== null && refused.runId === k.runId) {
          p.log(`refused ${key.slice(0, 12)}: ${refused.code ?? 'unknown'}: ${refused.detail ?? ''}`);
          code = 1;
          open.delete(key);
        } else if (st.state === 'blocked') {
          p.log(`blocked ${key.slice(0, 12)}`);
          code = 1;
          open.delete(key);
        }
      }
      if (open.size === 0) break;
      if (p.clock.now() - started >= limit) {
        p.log(`timeout: ${[...open.keys()].map((k) => k.slice(0, 12)).join(', ')} not ready yet; call route 28 again later (the files are uploaded)`);
        code = 1;
        break;
      }
      await p.clock.sleep(poll);
    }
    return { code, uploads };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
