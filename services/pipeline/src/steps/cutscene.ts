/**
 * The `cutscene_shot` job over `StepLike` (spec/domains/05-assets-pipeline.md section 6). The same function runs inside
 * `GenJobWorkflow` (a real WorkflowStep) and inside the in-process shim of `pnpm check:pipeline`.
 *
 * Stage order: gate, cache-check, budget-reserve, acquire, keyframes, plan, submit, wait, poll, copy-orig, transcode,
 * captions, qa-gate, resign, subs, publish (manifest last), record. Step results are JSON and small (F-024); bytes move
 * through BlobPort inside the step that produces them and only hashes and sizes are returned.
 *
 * Workers Free (M05c4, DL-745): with `transcodeMode: 'offedge'` the job stops after `copy-orig` (a stream into PRIVATE, no buffer, no
 * hash) and a `handoff` step; the operator's `prewarm --finish` transcodes and re-signs, and a second run of this function in phase
 * `publish` (`runPublishPhase`) re-runs the resign gate and copies the finished files into MEDIA, the manifest last.
 */
import {
  CUTSCENE_CACHE_CONTROL, FINISH_MAX_BYTES, HANDOFF_SCHEMA, REFUSED_SCHEMA, buildCutsceneManifest, finishKeyOf, finishOutKeyOf, handoffKeyOf, manifestKeyOf as sharedManifestKeyOf,
  origKeyOf as sharedOrigKeyOf, parseFinish, parseHandoff, refusedKeyOf, sha256Hex, type CutsceneFileMeta, type FinishRecord, type GateCode, type GenJob,
  type HandoffRecord, type RefusedRecord,
} from '@dv/shared';
import type { CutsceneManifest } from '@dv/shared/contracts/c09-cutscene';
import { FAL_DONE_EVENT } from '../fal.ts';
import { assertStageAllowed, type GateConfig, type GateStage } from '../gate.ts';
import type { FalSubmission, GenPorts } from '../ports.ts';

export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' };
  timeout?: string | number;
}

/** The slice of WorkflowStep this job uses. */
export interface StepLike {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T>;
  waitForEvent<T>(name: string, opts: { type: string; timeout?: string | number }): Promise<{ payload: T }>;
}

/** Where the transcode and re-sign run: `mock` is the in-Worker path with the fixture ports, `offedge` the operator's `prewarm --finish` (M05c4). */
export type TranscodeMode = 'mock' | 'offedge';

export interface RunContext {
  ports: GenPorts;
  gate: GateConfig;
  /** Workflow instance id: `cutscene_shot-<jobKey[0:12]>-<attempt>`. It rides in the webhook URL as `?wf=`. */
  instanceId: string;
  /** Origin that serves route 29 (HOST_API). */
  hostApi: string;
  /** True in mock mode: nothing is spent, so the settled amount is 0. */
  mock: boolean;
  /** Default `mock` (the M05b1 path). The Worker passes TRANSCODE_MODE; `offedge` ends the job at the hand-off. */
  transcodeMode?: TranscodeMode;
}

export interface JobOutcome {
  status: 'ready' | 'cached' | 'refused' | 'failed' | 'handed_off';
  code?: GateCode;
  detail?: string;
  manifestKey?: string;
  /** Object keys in the order they were written; the manifest is always last. */
  writes: string[];
  webhook?: 'event' | 'timeout';
}

export const WORKFLOW_ID_PREFIX = 'cutscene_shot';
export const FAL_DONE_TIMEOUT = '20 minutes';
export const SLOT_TTL_MS = 25 * 60 * 1000;
const FPS = 24;
const QA_FRAME_TOLERANCE = 17;

export const cutsceneKeyOf = (job: GenJob): string => {
  const k = job.params['cutsceneKey'];
  if (typeof k !== 'string' || k.length === 0) throw new Error('job.params.cutsceneKey is required for cutscene_shot');
  return k;
};
export const manifestKeyOf = sharedManifestKeyOf;
export const origKeyOf = sharedOrigKeyOf;
/** `params.phase` of the job a publish-phase Workflow instance receives (route 28 on a handed-off key with `finish.json`). */
export const PUBLISH_PHASE = 'publish';
export const isPublishPhase = (job: GenJob): boolean => job.params['phase'] === PUBLISH_PHASE;
export const publishWorkflowId = (jobKey: string, attempt: number): string => `${WORKFLOW_ID_PREFIX}-${jobKey.slice(0, 12)}-p${attempt}`;
export const workflowId = (jobKey: string, attempt: number): string => `${WORKFLOW_ID_PREFIX}-${jobKey.slice(0, 12)}-${attempt}`;

export interface PlannedShot {
  shotId: string;
  durationS: number;
  prompt: string;
  startFrame: number;
  frames: number;
}

/** `plan`: shots as authored (6 to 10 s in production, 2 s for the fixture), mapped to frame ranges at 24 fps. */
export function planShots(job: GenJob): PlannedShot[] {
  const raw = job.params['shots'];
  const authored = Array.isArray(raw) && raw.length > 0 ? (raw as { shotId?: unknown; durationS?: unknown; prompt?: unknown }[]) : [{ shotId: 's1', durationS: 2, prompt: '' }];
  let start = 0;
  return authored.map((s, i) => {
    const durationS = typeof s.durationS === 'number' && s.durationS > 0 ? s.durationS : 2;
    const frames = Math.round(durationS * FPS);
    const shot: PlannedShot = { shotId: typeof s.shotId === 'string' ? s.shotId : `s${i + 1}`, durationS, prompt: typeof s.prompt === 'string' ? s.prompt : '', startFrame: start, frames };
    start += frames;
    return shot;
  });
}

function falInput(job: GenJob, shots: PlannedShot[], keyframes: string[]): Record<string, unknown> {
  // Field names follow the H3-family recipe of the story spec (D3.3); the exact vendor schema is confirmed in M05c3.
  return {
    prompt: shots[0]?.prompt ?? '',
    duration: shots[0]?.durationS ?? 0,
    seed: job.params['seed'],
    prompt_expansion_mode: 'disabled',
    resolution: '768P',
    aspect_ratio: '16:9',
    keyframe_sha256: keyframes,
  };
}

interface TranscodeMeta {
  files: CutsceneFileMeta[];
  width: number;
  height: number;
  frames: number;
  renditions: Record<string, string>;
  speechDetected: boolean;
  origC2pa: CutsceneManifest['provenance']['c2pa'];
}

/** The transcode mode of a run: the Worker's TRANSCODE_MODE, else what FAL_MODE implies. */
export const modeOf = (ctx: Pick<RunContext, 'mock' | 'transcodeMode'>): TranscodeMode => ctx.transcodeMode ?? (ctx.mock ? 'mock' : 'offedge');

/** The pairing rule of M05c4: a live fal run must hand off to the operator (see `modePairingError` in env.ts). */
export function pairingErrorOf(ctx: Pick<RunContext, 'mock' | 'transcodeMode'>): string | null {
  if (!ctx.mock && modeOf(ctx) === 'mock') return 'TRANSCODE_MODE=mock cannot be paired with FAL_MODE=live: live output would be transcoded and signed with fixtures';
  return null;
}

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** The licence block of a manifest: the provider's status in the registry now. */
export function licenceOf(job: GenJob, registry: GateConfig['registry']): CutsceneManifest['licence'] {
  const provider = registry.videoProviders[job.endpointKey];
  return {
    gate: 'ADR-GENAI-01',
    provider: job.endpointKey,
    status: provider?.licence.status === 'cleared' ? 'cleared' : 'pending',
    termsSnapshotSha256: provider?.licence.evidence.map((e) => e.termsSnapshotSha256) ?? [],
  };
}

function charactersOf(job: GenJob): CutsceneManifest['characters'] {
  const raw = job.params['characters'];
  return Array.isArray(raw) ? (raw as CutsceneManifest['characters']) : [];
}

function subsOf(job: GenJob): Record<string, string> {
  const authored = job.params['subs'];
  const out: Record<string, string> = {};
  if (typeof authored === 'object' && authored !== null) for (const [lang, vtt] of Object.entries(authored as Record<string, unknown>)) if (typeof vtt === 'string') out[lang] = vtt;
  return out;
}

export async function runCutsceneJob(step: StepLike, ctx: RunContext, job: GenJob): Promise<JobOutcome> {
  const { ports } = ctx;
  const key = cutsceneKeyOf(job);
  const manifestKey = manifestKeyOf(key);
  const writes: string[] = [];
  let acquired = false;

  // M05c4: the pairing check comes first, before the gate, the budget or any FalPort call.
  const pairing = pairingErrorOf(ctx);
  if (pairing !== null) {
    await step.do('fail', () => ports.sink.fail(pairing, 'POLICY_REFUSED'));
    return { status: 'refused', code: 'POLICY_REFUSED', detail: pairing, writes };
  }
  if (isPublishPhase(job)) return runPublishPhase(step, ctx, job);
  const offedge = modeOf(ctx) === 'offedge';

  const gate = async (stage: GateStage): Promise<{ ok: true } | { ok: false; code: GateCode; detail: string }> =>
    step.do(`gate:${stage}`, async () => assertStageAllowed(job, stage, ports, ctx.gate));

  const refuse = async (code: GateCode, detail: string): Promise<JobOutcome> => {
    await step.do('fail', () => ports.sink.fail(`${code}: ${detail}`));
    return { status: 'refused', code, detail, writes };
  };

  try {
    // 1. gate: tier, kill state, provider status, prompt lint. Production and live need a cleared provider.
    const g1 = await gate('gate');
    if (!g1.ok) return await refuse(g1.code, g1.detail);

    // 2. cache-check: a published manifest means the key is done, whatever the budget or kill state.
    const cached = await step.do('cache-check', async () => (await ports.blob.head('MEDIA', manifestKey)) !== null);
    if (cached) {
      await step.do('complete', () => ports.sink.complete({ manifestKey, costUsdMicros: 0 }));
      return { status: 'cached', manifestKey, writes };
    }
    // A key that was already handed off is never paid for twice, whatever the stored state says (an operator reset deletes handoff.json too).
    if (offedge && (await step.do('handoff-check', async () => (await ports.blob.head('PRIVATE', handoffKeyOf(key))) !== null))) {
      await step.do('handoff', () => ports.sink.handoff({ costUsdMicros: 0 }));
      return { status: 'handed_off', writes };
    }

    // 3. budget-reserve (submit-time gate rules first: kill switches, governor level)
    const g2 = await gate('budget-reserve');
    if (!g2.ok) return await refuse(g2.code, g2.detail);
    const reserved = await step.do('budget-reserve', async () => ports.budget.reserve('fal', job.budgetUsdMicros, job.jobKey));
    if (!reserved.ok) return await refuse('BUDGET', 'the governor refused the reservation');

    // 4. acquire a FalGate slot: up to 20 minutes of 30 s retries
    await step.do('acquire', { retries: { limit: 40, delay: '30 seconds', backoff: 'constant' } }, async () => {
      if (!(await ports.falGate.acquire(job.jobKey, SLOT_TTL_MS))) throw new Error('fal slot busy');
      return true;
    });
    acquired = true;

    // 5. keyframes (not video submits)
    const shots = planShots(job);
    const keyframes = await step.do('keyframes', async () => {
      const out: string[] = [];
      for (const s of shots) out.push((await ports.fal.keyframe({ jobKey: job.jobKey, shotId: s.shotId, prompt: s.prompt })).sha256);
      return out;
    });

    // 6. plan (pure; recorded so the manifest maps shots to frames)
    const plan = await step.do('plan', async () => shots);

    // 7. submit with ?fal_webhook=
    const provider = ctx.gate.registry.videoProviders[job.endpointKey];
    const endpointId = provider?.endpoints.i2v ?? job.endpointKey;
    const webhookUrl = `${ctx.hostApi}/api/v1/hooks/fal?wf=${encodeURIComponent(ctx.instanceId)}`;
    const sub: FalSubmission = await step.do('submit', { retries: { limit: 5, delay: '15 seconds', backoff: 'exponential' } }, async () =>
      ports.fal.submit(endpointId, falInput(job, plan, keyframes), { webhookUrl, jobKey: job.jobKey }),
    );

    // 8. wait for the webhook; a lost one (retries stop after about 6 minutes for large results) falls through to polling
    let webhook: 'event' | 'timeout' = 'event';
    try {
      await step.waitForEvent(FAL_DONE_EVENT, { type: FAL_DONE_EVENT, timeout: FAL_DONE_TIMEOUT });
    } catch {
      webhook = 'timeout';
    }

    // 9. poll status, then read the result: 12 tries from 30 s, exponential
    const out = await step.do('poll', { retries: { limit: 12, delay: '30 seconds', backoff: 'exponential' } }, async () => {
      const st = await ports.fal.status(sub);
      if (st.status !== 'COMPLETED') throw new Error(`pending ${st.status}`);
      if (st.error !== undefined) throw new Error(`fal ${st.errorType ?? 'error'}: ${st.error}`);
      return ports.fal.result(sub);
    });

    // the fal slot is free as soon as the request has completed
    await step.do('release', () => ports.falGate.release(job.jobKey));
    acquired = false;

    // 10. copy-orig: unmodified, PRIVATE only. Off-edge it is a stream: nothing is buffered or hashed in the Worker (10 ms of CPU a step).
    if (offedge) {
      const stored = await step.do('copy-orig', async () => {
        const src = await ports.fal.fetchStream(out.videoUrl);
        if (src.size === null) throw new Error('the fal output has no Content-Length, which R2 needs to accept a stream');
        await ports.blob.putStream('PRIVATE', origKeyOf(key), src.body, src.size, { contentType: out.contentType, custom: { falRequestId: sub.requestId, jobKey: job.jobKey } });
        return { key: origKeyOf(key), bytes: src.size };
      });
      writes.push(stored.key);
      // 11. handoff: spend settled, handoff.json beside orig.mp4, the key stored as handed_off; no manifest. `--finish` does the rest.
      const costUsdMicros = ctx.mock ? 0 : job.budgetUsdMicros;
      const record: HandoffRecord = {
        schema: HANDOFF_SCHEMA,
        key,
        jobKey: job.jobKey,
        job,
        plan,
        requestId: sub.requestId,
        providerKey: job.endpointKey,
        endpoint: provider?.endpoints.i2v ?? job.endpointKey,
        pinnedUpdatedAt: typeof job.params['pinnedUpdatedAt'] === 'string' ? job.params['pinnedUpdatedAt'] : '',
        characters: charactersOf(job),
        licence: licenceOf(job, ctx.gate.registry),
        subs: subsOf(job),
        costUsdMicros,
        at: ports.clock.now(),
      };
      await step.do('handoff', async () => {
        await ports.blob.put('PRIVATE', handoffKeyOf(key), enc(record), { contentType: 'application/json' });
        await ports.budget.settle(job.jobKey, costUsdMicros, sub.requestId);
        await ports.sink.handoff({ costUsdMicros });
        return true;
      });
      writes.push(handoffKeyOf(key));
      return { status: 'handed_off', writes, webhook };
    }
    const orig = await step.do('copy-orig', async () => {
      const bytes = await ports.fal.fetchFile(out.videoUrl);
      await ports.blob.put('PRIVATE', origKeyOf(key), bytes, { contentType: out.contentType, custom: { falRequestId: sub.requestId, jobKey: job.jobKey } });
      return { sha256: sha256Hex(bytes), bytes: bytes.length, key: origKeyOf(key) };
    });
    writes.push(orig.key);

    // 11. probe + transcode in the container (recipe cut@1); renditions land under cutscenes/<key>/
    const tc: TranscodeMeta = await step.do('transcode', async () => {
      const bytes = await ports.blob.get('PRIVATE', origKeyOf(key));
      if (bytes === null) throw new Error('orig.mp4 vanished before transcode');
      const r = await ports.transcode.transcode(bytes);
      const files: CutsceneFileMeta[] = [];
      for (const f of r.files) {
        await ports.blob.put('MEDIA', `cutscenes/${key}/${f.file}`, f.bytes, { contentType: f.contentType });
        files.push({ file: f.file, bytes: f.bytes.length, sha256: sha256Hex(f.bytes), contentType: f.contentType, ...(f.codecs !== undefined ? { codecs: f.codecs } : {}), ...(f.kbps !== undefined ? { kbps: f.kbps } : {}) });
      }
      return { files, width: r.width, height: r.height, frames: r.frames, renditions: r.renditions, speechDetected: r.speechDetected, origC2pa: r.origC2pa };
    });
    for (const f of tc.files) writes.push(`cutscenes/${key}/${f.file}`);

    // 12. captions: speech detection result (Workers AI in live mode); speech withholds the audio until human review (H7)
    await step.do('captions', async () => ({ speechDetected: tc.speechDetected }));

    // 13. qa-gate: frame count within 17 of duration x 24 (black/frozen frame and loudness probes arrive with the live transcoder)
    const expectedFrames = plan.reduce((n, s) => n + s.frames, 0);
    const qa = await step.do('qa-gate', async () => ({ ok: tc.frames > 0 && Math.abs(tc.frames - expectedFrames) <= QA_FRAME_TOLERANCE, frames: tc.frames, expectedFrames }));
    if (!qa.ok) return await refuse('POLICY_REFUSED', `qa: ${qa.frames} frames, expected ${qa.expectedFrames} +-${QA_FRAME_TOLERANCE}`);

    // 14. re-gate (kill state and consent again) before anything is signed or published
    const g3 = await gate('resign');
    if (!g3.ok) return await refuse(g3.code, g3.detail);

    // 15. resign: each video rendition gets our C2PA claim with orig.mp4 as ingredient
    const signed = await step.do('resign', async () => {
      const origBytes = await ports.blob.get('PRIVATE', origKeyOf(key));
      if (origBytes === null) throw new Error('orig.mp4 vanished before resign');
      const meta: Record<string, { sha256: string; bytes: number; c2pa: string }> = {};
      for (const f of tc.files.filter((x) => x.contentType.startsWith('video/'))) {
        const bytes = await ports.blob.get('MEDIA', `cutscenes/${key}/${f.file}`);
        if (bytes === null) throw new Error(`${f.file} vanished before resign`);
        const s = await ports.sign.resign({ file: f.file, bytes, contentType: f.contentType }, origBytes);
        await ports.blob.put('MEDIA', `cutscenes/${key}/${f.file}`, s.bytes, { contentType: f.contentType });
        meta[f.file] = { sha256: sha256Hex(s.bytes), bytes: s.bytes.length, c2pa: s.c2pa };
      }
      return meta;
    });

    // 16. subs: scripted VTT from the dialogue refs
    const subs = await step.do('subs', async () => {
      const map: Record<string, string> = {};
      for (const [lang, vtt] of Object.entries(subsOf(job))) {
        const file = `subs.${lang}.vtt`;
        await ports.blob.put('MEDIA', `cutscenes/${key}/${file}`, new TextEncoder().encode(vtt), { contentType: 'text/vtt' });
        map[lang] = file;
      }
      return map;
    });
    for (const file of Object.values(subs)) writes.push(`cutscenes/${key}/${file}`);

    // 17. publish: the manifest is written last; it is the ready test
    const manifest = buildCutsceneManifest({
      key,
      plan,
      characters: charactersOf(job),
      licence: licenceOf(job, ctx.gate.registry),
      endpoint: provider?.endpoints.i2v ?? job.endpointKey,
      pinnedUpdatedAt: typeof job.params['pinnedUpdatedAt'] === 'string' ? job.params['pinnedUpdatedAt'] : '',
      requestId: sub.requestId,
      origSha256: orig.sha256,
      frames: tc.frames,
      width: tc.width,
      height: tc.height,
      renditions: tc.renditions,
      files: tc.files,
      signed,
      origC2pa: tc.origC2pa,
      subs,
    });
    await step.do('publish', async () => {
      await ports.blob.put('MEDIA', manifestKey, new TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json', custom: { jobKey: job.jobKey } });
      return true;
    });
    writes.push(manifestKey);

    // 18. record: provenance summary beside the original, ledger settle, notify the single-flight object
    const costUsdMicros = ctx.mock ? 0 : job.budgetUsdMicros;
    await step.do('record', async () => {
      const record = { schema: 'genrun/1', jobKey: job.jobKey, kind: job.kind, endpoint: job.endpointKey, requestId: sub.requestId, origSha256: orig.sha256, manifestKey, costUsdMicros, at: ports.clock.now() };
      await ports.blob.put('PRIVATE', `cutscenes-orig/${key}/record.json`, new TextEncoder().encode(JSON.stringify(record)), { contentType: 'application/json' });
      await ports.budget.settle(job.jobKey, costUsdMicros, sub.requestId);
      return true;
    });
    await step.do('complete', () => ports.sink.complete({ manifestKey, costUsdMicros }));
    return { status: 'ready', manifestKey, writes, webhook };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await step.do('fail', () => ports.sink.fail(message));
    throw e;
  } finally {
    if (acquired) await step.do('release', () => ports.falGate.release(job.jobKey));
  }
}


/**
 * Phase `publish` (M05c4): route 28 found `finish.json` beside a handed-off key. No FalPort call, no budget movement (the spend was settled at
 * the hand-off). Reads `handoff.json` and `finish.json` (at most 64 KiB, hand validator), re-runs the `resign` gate over the job as it ran
 * (kill state, consent, licence), checks every file's size, copies each one from `out/<runId>/` into MEDIA as a stream (one I/O-only step
 * per file; content type and Cache-Control from `finish.json`), writes `manifest.json` last, records, and notifies the single-flight object.
 * A refusal writes nothing to MEDIA and leaves `refused.json`; a kill blocks the key, any other refusal leaves it handed off.
 * Subrequests: about 4 for the loads and checks, 1 per file to verify, 2 per file to copy, 3 to finish: 31 for the 8 files of one clip, under 40.
 */
export async function runPublishPhase(step: StepLike, ctx: RunContext, job: GenJob): Promise<JobOutcome> {
  const { ports } = ctx;
  const key = cutsceneKeyOf(job);
  const manifestKey = manifestKeyOf(key);
  const writes: string[] = [];

  const refuse = async (code: GateCode, detail: string, runId: string): Promise<JobOutcome> => {
    await step.do('refuse', async () => {
      const rec: RefusedRecord = { schema: REFUSED_SCHEMA, key, runId, code, detail, at: ports.clock.now() };
      await ports.blob.put('PRIVATE', refusedKeyOf(key), enc(rec), { contentType: 'application/json' });
      await ports.sink.fail(`${code}: ${detail}`, code);
      return true;
    });
    return { status: 'refused', code, detail, writes };
  };

  try {
    // 1. a published manifest ends the key whatever else is stored
    if (await step.do('cache-check', async () => (await ports.blob.head('MEDIA', manifestKey)) !== null)) {
      await step.do('complete', () => ports.sink.complete({ manifestKey, costUsdMicros: 0 }));
      return { status: 'cached', manifestKey, writes };
    }

    // 2. load: both files are small JSON; a malformed or oversized one is a refusal, not a retry
    const loaded = await step.do('load', async (): Promise<{ handoff: HandoffRecord; finish: FinishRecord } | { error: string; runId: string }> => {
      const hb = await ports.blob.get('PRIVATE', handoffKeyOf(key));
      if (hb === null) return { error: 'handoff.json is missing', runId: 'unknown' };
      const h = parseHandoff(new TextDecoder().decode(hb));
      if (!h.ok) return { error: h.error, runId: 'unknown' };
      const fh = await ports.blob.head('PRIVATE', finishKeyOf(key));
      if (fh === null) return { error: 'finish.json is missing', runId: 'unknown' };
      if (fh.size > FINISH_MAX_BYTES) return { error: `finish.json is ${fh.size} bytes, over the ${FINISH_MAX_BYTES} limit`, runId: 'unknown' };
      const fb = await ports.blob.get('PRIVATE', finishKeyOf(key));
      if (fb === null) return { error: 'finish.json is missing', runId: 'unknown' };
      const f = parseFinish(new TextDecoder().decode(fb));
      if (!f.ok) return { error: f.error, runId: 'unknown' };
      if (f.value.key !== key || h.value.key !== key) return { error: 'finish.json or handoff.json names another key', runId: f.value.runId };
      return { handoff: h.value, finish: f.value };
    });
    if ('error' in loaded) return await refuse('POLICY_REFUSED', loaded.error, loaded.runId);
    const { handoff, finish } = loaded;

    // 3. the resign gate again, over the job as it ran: kill state, consent and licence can have changed since the hand-off
    const g = await step.do('gate:resign', async () => assertStageAllowed(handoff.job, 'resign', ports, ctx.gate));
    if (!g.ok) return await refuse(g.code, g.detail, finish.runId);

    // 4. every listed file is there with the byte count finish.json states, before anything reaches MEDIA
    const bad = await step.do('verify', async () => {
      const out: string[] = [];
      for (const f of finish.files) {
        const h = await ports.blob.head('PRIVATE', finishOutKeyOf(key, finish.runId, f.file));
        if (h === null) out.push(`${f.file} is missing under out/${finish.runId}/`);
        else if (h.size !== f.bytes) out.push(`${f.file} holds ${h.size} bytes, finish.json says ${f.bytes}`);
      }
      return out;
    });
    if (bad.length > 0) return await refuse('POLICY_REFUSED', bad.join('; '), finish.runId);

    // 5. copy each file as a stream; the manifest comes after all of them
    for (const f of finish.files) {
      const to = `cutscenes/${key}/${f.file}`;
      await step.do(`copy:${f.file}`, async () => {
        const n = await ports.blob.copy(
          { bucket: 'PRIVATE', key: finishOutKeyOf(key, finish.runId, f.file) },
          { bucket: 'MEDIA', key: to },
          { contentType: f.contentType, cacheControl: CUTSCENE_CACHE_CONTROL[f.cacheClass], custom: { jobKey: job.jobKey } },
          f.bytes,
        );
        if (n === null) throw new Error(`${f.file} vanished from out/${finish.runId}/`);
        return n;
      });
      writes.push(to);
    }

    // 6. publish: the manifest is written last; it is the ready test
    await step.do('publish', async () => {
      await ports.blob.put('MEDIA', manifestKey, enc(finish.manifest), { contentType: 'application/json', cacheControl: CUTSCENE_CACHE_CONTROL.manifest, custom: { jobKey: job.jobKey } });
      return true;
    });
    writes.push(manifestKey);

    // 7. record: the provenance summary beside the original; the ledger was settled at the hand-off, so nothing is settled twice
    await step.do('record', async () => {
      const record = {
        schema: 'genrun/1', jobKey: handoff.jobKey, kind: handoff.job.kind, endpoint: handoff.endpoint, requestId: handoff.requestId,
        origSha256: finish.manifest.provenance.origSha256, manifestKey, costUsdMicros: handoff.costUsdMicros, finishRunId: finish.runId, at: ports.clock.now(),
      };
      await ports.blob.put('PRIVATE', `cutscenes-orig/${key}/record.json`, enc(record), { contentType: 'application/json' });
      return true;
    });
    await step.do('complete', () => ports.sink.complete({ manifestKey, costUsdMicros: handoff.costUsdMicros }));
    return { status: 'ready', manifestKey, writes };
  } catch (e) {
    // an unexpected error leaves the key handed off (the sink keeps the hand-off); the next route 28 call tries again
    const message = e instanceof Error ? e.message : String(e);
    await step.do('fail', () => ports.sink.fail(message));
    throw e;
  }
}
