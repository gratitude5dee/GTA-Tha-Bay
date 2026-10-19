/**
 * The `cutscene_shot` job over `StepLike` (spec/domains/05-assets-pipeline.md section 6). The same function runs inside
 * `GenJobWorkflow` (a real WorkflowStep) and inside the in-process shim of `pnpm check:pipeline`.
 *
 * Stage order: gate, cache-check, budget-reserve, acquire, keyframes, plan, submit, wait, poll, copy-orig, transcode,
 * captions, qa-gate, resign, subs, publish (manifest last), record. Step results are JSON and small (F-024); bytes move
 * through BlobPort inside the step that produces them and only hashes and sizes are returned.
 */
import { sha256Hex, type GateCode, type GenJob } from '@dv/shared';
import type { CutsceneManifest, Rendition } from '@dv/shared/contracts/c09-cutscene';
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

export interface RunContext {
  ports: GenPorts;
  gate: GateConfig;
  /** Workflow instance id: `cutscene_shot-<jobKey[0:12]>-<attempt>`. It rides in the webhook URL as `?wf=`. */
  instanceId: string;
  /** Origin that serves route 29 (HOST_API). */
  hostApi: string;
  /** True in mock mode: nothing is spent, so the settled amount is 0. */
  mock: boolean;
}

export interface JobOutcome {
  status: 'ready' | 'cached' | 'refused' | 'failed';
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
export const manifestKeyOf = (key: string): string => `cutscenes/${key}/manifest.json`;
export const origKeyOf = (key: string): string => `cutscenes-orig/${key}/orig.mp4`;
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

interface FileMeta {
  file: string;
  bytes: number;
  sha256: string;
  contentType: string;
  codecs?: string;
  kbps?: number;
}

interface TranscodeMeta {
  files: FileMeta[];
  width: number;
  height: number;
  frames: number;
  renditions: Record<string, string>;
  speechDetected: boolean;
  origC2pa: CutsceneManifest['provenance']['c2pa'];
}

export async function runCutsceneJob(step: StepLike, ctx: RunContext, job: GenJob): Promise<JobOutcome> {
  const { ports } = ctx;
  const key = cutsceneKeyOf(job);
  const manifestKey = manifestKeyOf(key);
  const writes: string[] = [];
  let acquired = false;

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

    // 10. copy-orig: unmodified, PRIVATE only
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
      const files: FileMeta[] = [];
      for (const f of r.files) {
        await ports.blob.put('MEDIA', `cutscenes/${key}/${f.file}`, f.bytes, { contentType: f.contentType });
        files.push({ file: f.file, bytes: f.bytes.length, sha256: sha256Hex(f.bytes), contentType: f.contentType, ...(f.codecs !== undefined ? { codecs: f.codecs } : {}), ...(f.kbps !== undefined ? { kbps: f.kbps } : {}) });
      }
      return { files, width: r.width, height: r.height, frames: r.frames, renditions: r.renditions, speechDetected: r.speechDetected, origC2pa: r.origC2pa };
    });
    for (const f of tc.files) writes.push(`cutscenes/${key}/${f.file}`);

    // 12. captions: speech detection result (Workers AI in live mode); speech withholds the audio until human review (H7)
    const captions = await step.do('captions', async () => ({ speechDetected: tc.speechDetected }));

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
      const authored = job.params['subs'];
      const entries = typeof authored === 'object' && authored !== null ? Object.entries(authored as Record<string, unknown>) : [];
      for (const [lang, vtt] of entries) {
        if (typeof vtt !== 'string') continue;
        const file = `subs.${lang}.vtt`;
        await ports.blob.put('MEDIA', `cutscenes/${key}/${file}`, new TextEncoder().encode(vtt), { contentType: 'text/vtt' });
        map[lang] = file;
      }
      return map;
    });
    for (const file of Object.values(subs)) writes.push(`cutscenes/${key}/${file}`);

    // 17. publish: the manifest is written last; it is the ready test
    const manifest = buildManifest({ job, ctx, key, tc, signed, subs, plan, orig: { sha256: orig.sha256 }, requestId: sub.requestId, speechDetected: captions.speechDetected });
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

function buildManifest(a: {
  job: GenJob;
  ctx: RunContext;
  key: string;
  tc: TranscodeMeta;
  signed: Record<string, { sha256: string; bytes: number; c2pa: string }>;
  subs: Record<string, string>;
  plan: PlannedShot[];
  orig: { sha256: string };
  requestId: string;
  speechDetected: boolean;
}): CutsceneManifest {
  const renditions: CutsceneManifest['renditions'] = {};
  for (const [id, file] of Object.entries(a.tc.renditions)) {
    const f = a.tc.files.find((x) => x.file === file);
    if (f === undefined) continue;
    const s = a.signed[file];
    const r: Rendition = { file, bytes: s?.bytes ?? f.bytes, sha256: s?.sha256 ?? f.sha256, codecs: f.codecs ?? '', kbps: f.kbps ?? 0 };
    if (id === 'v540' || id === 'v768' || id === 'v1080' || id === 'p720') renditions[id] = r;
  }
  const provider = a.ctx.gate.registry.videoProviders[a.job.endpointKey];
  const charsRaw = a.job.params['characters'];
  const characters = Array.isArray(charsRaw) ? (charsRaw as CutsceneManifest['characters']) : [];
  return {
    schema: 'cutscene-asset/1',
    key: a.key,
    recipe: 'cut@1',
    fps: 24,
    frames: a.tc.frames,
    width: a.tc.width,
    height: a.tc.height,
    renditions,
    poster: 'poster.webp',
    last: 'last.webp',
    subs: a.subs,
    shots: a.plan.map((s) => ({ shotId: s.shotId, startFrame: s.startFrame, frames: s.frames })),
    characters,
    licence: {
      gate: 'ADR-GENAI-01',
      provider: a.job.endpointKey,
      status: provider?.licence.status === 'cleared' ? 'cleared' : 'pending',
      termsSnapshotSha256: provider?.licence.evidence.map((e) => e.termsSnapshotSha256) ?? [],
    },
    provenance: {
      endpoint: provider?.endpoints.i2v ?? a.job.endpointKey,
      pinnedUpdatedAt: typeof a.job.params['pinnedUpdatedAt'] === 'string' ? a.job.params['pinnedUpdatedAt'] : '',
      requestIds: [a.requestId],
      origSha256: a.orig.sha256,
      c2pa: a.tc.origC2pa,
      resigned: Object.keys(a.signed).length > 0 && Object.values(a.signed).every((s) => s.c2pa !== 'invalid'),
      aiGenerated: true,
    },
  };
}
