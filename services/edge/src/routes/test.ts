import { mockJwks } from '@dv/pipeline/core';
import type { GovLevel, SpendEvent, Vendor } from '@dv/shared';
import { apiError, json } from '../errors.ts';
import { requestCountry } from '../geo.ts';
import { CRON_JOBS, JOBS, SCHEDULE, dueJobs, runJobs, slotOf, type JobName } from '../ops/scheduled.ts';
import { authenticatePlayer } from '../id/tofu.ts';
import type { EncounterDO, TurnUsage } from '../npc/EncounterDO.ts';
import { auraSpeak } from '../npc/ai.ts';
import { drainBuilder } from '../npc-builder/queue.ts';
import { UUIDV7_PATTERN } from '../uuidv7.ts';
import type { Ctx, Route } from '../router.ts';

/**
 * The /api/v1/_test namespace exists only in staging and preview bundles. index.ts imports this file inside
 * `if (__DV_TEST_ROUTES__)`, so the production bundle contains neither the handlers nor the path strings
 * (proved by check:prod-routes). These routes are not geo-gated: the geo-gate e2e reads the edge country here.
 */
function handleEchoCountry({ request }: Ctx): Response {
  return json({ country: requestCountry(request) ?? null });
}

/** The public half of the mock webhook signing key, in the shape of fal's own JWKS. */
async function handleFalJwks(): Promise<Response> {
  return json(await mockJwks());
}

interface GovernorTestRpc {
  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number> }>;
  ingest(batch: SpendEvent[]): Promise<void>;
  alarmLog(): Promise<{ threshold: string; spent: number }[]>;
  spentMicros(v: Vendor): Promise<number>;
}

/** GET: the governor's level, per-vendor percentages, fal spend and alarm log. POST: ingest a SpendEvent batch. */
async function handleSpend({ request, env, requestId }: Ctx): Promise<Response> {
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as GovernorTestRpc;
  if (request.method === 'POST') {
    const batch = (await request.json()) as unknown;
    if (!Array.isArray(batch)) return apiError('bad_request', 'Expected a SpendEvent array.', requestId);
    await gov.ingest(batch as SpendEvent[]);
  }
  return json({ ...(await gov.level()), falSpentUsdMicros: await gov.spentMicros('fal'), alarms: await gov.alarmLog() });
}

/**
 * Runs the scheduled jobs the way the dispatcher would (Previews run no Cron Triggers): `?job=<name>` runs one job of `JOBS`;
 * `?at=HH:MM` (UTC) runs what the dispatcher tick of that slot runs (BD-FIX-CRON-01; `03:10` is catalog-sync, ledger-export and transcripts,
 * a slot with no row runs nothing); neither, or `job=all`, runs catalog-sync and ledger-export. `job` and `at` together are a bad_request.
 */
async function handleRunScheduled({ url, env, deps, requestId }: Ctx): Promise<Response> {
  const job = url.searchParams.get('job');
  const at = url.searchParams.get('at');
  let names: readonly JobName[];
  if (at !== null) {
    if (job !== null) return apiError('bad_request', 'Give job or at, not both.', requestId);
    const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(at);
    if (!m) return apiError('bad_request', 'at is HH:MM (UTC).', requestId, { details: { slots: Object.keys(SCHEDULE) } });
    const t = (Number(m[1]) * 60 + Number(m[2])) * 60_000;
    return json({ slot: slotOf(t), ran: await runJobs(env, deps, dueJobs(t)) });
  }
  if (job === null || job === 'all') names = CRON_JOBS;
  else if (Object.hasOwn(JOBS, job)) names = [job as JobName];
  else return apiError('bad_request', 'Unknown job.', requestId, { details: { jobs: Object.keys(JOBS) } });
  return json({ ran: await runJobs(env, deps, names) });
}

/** No queue consumers exist yet (SPEND arrives with M06a3); nothing to drain. */
function handleDrainQueue(): Response {
  return json({ drained: 0 });
}

/**
 * GET /api/v1/_test/npc/usage?npc=<id>&encounter=<id> (M06a3): the token counts of the caller's own encounter, from its play token. The staging
 * suite `npc-cache` reads `cacheRead` here, because the dialogue stream itself carries only the cost. Never any text.
 */
async function handleNpcUsage(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const npc = ctx.url.searchParams.get('npc') ?? '';
  const encounter = ctx.url.searchParams.get('encounter') ?? '';
  if (!/^[a-z][a-z0-9_-]{2,47}$/.test(npc) || !UUIDV7_PATTERN.test(encounter)) return apiError('bad_request', 'npc and encounter are required.', ctx.requestId);
  const stub = ctx.env.ENCOUNTER.get(ctx.env.ENCOUNTER.idFromName(`enc:${auth.profileId}:${npc}:${encounter}`)) as DurableObjectStub<EncounterDO>;
  return json({ turns: (await stub.usages()) as TurnUsage[] });
}

/** What the first bytes of a TTS answer say about its container. */
function sniffAudio(b: Uint8Array): 'mp3' | 'wav' | 'ogg' | 'flac' | 'unknown' {
  const ascii = (from: number, n: number): string => String.fromCharCode(...b.subarray(from, from + n));
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(0, 4) === 'RIFF') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  return 'unknown';
}

const TTS_MODELS: Record<string, string> = { 'aura-1': '@cf/deepgram/aura-1', 'aura-2': '@cf/deepgram/aura-2-en' };

/**
 * POST /api/v1/_test/npc/tts?model=aura-1|aura-2&speaker=<name> with `{ "text": "..." }` (M06a4 AC-10): voices one sentence through the `AI` binding and
 * answers what came back: the container sniffed from the first bytes, the size and the wall time. Never the audio. The suite `npc-tts` writes the
 * readings to tests/reports/npc/tts.json, which settles U-NPC-05 (Aura-1 encoding and latency). Play token required; the text is at most 200 characters.
 */
async function handleNpcTts(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const model = TTS_MODELS[ctx.url.searchParams.get('model') ?? ''];
  const speaker = ctx.url.searchParams.get('speaker') ?? '';
  let text = '';
  try {
    text = String(((await ctx.request.json()) as { text?: unknown }).text ?? '');
  } catch {
    text = '';
  }
  if (model === undefined || !/^[a-z]{3,16}$/.test(speaker) || text.trim() === '' || text.length > 200) return apiError('bad_request', 'model, speaker and text (at most 200 characters) are required.', ctx.requestId);
  if (ctx.env.AI === undefined) return apiError('feature_disabled', 'The AI binding is not available here.', ctx.requestId);
  const r = await auraSpeak(ctx.env, model, speaker, text);
  if (r === null) return json({ model, speaker, ok: false, bytes: 0, ms: null, container: 'unknown' });
  return json({ model, speaker, ok: true, bytes: r.bytes.length, ms: r.ms, container: sniffAudio(r.bytes), head: Array.from(r.bytes.subarray(0, 4)) });
}

/**
 * POST /api/v1/_test/builder/drain (M06b1): waits for the NPC builder jobs that ran inline in this isolate (a Preview, `wrangler dev`, a Worker with
 * no queue bound), so a test can poll one request later without sleeping. Where the Queue `npc-builder` is bound its consumer does the work.
 */
async function handleBuilderDrain(): Promise<Response> {
  return json({ drained: await drainBuilder() });
}

export const TEST_ROUTES: readonly Route[] = [
  { methods: ['GET'], path: '/api/v1/_test/echo-country', handler: handleEchoCountry },
  { methods: ['GET'], path: '/api/v1/_test/fal-jwks', handler: handleFalJwks },
  { methods: ['GET', 'POST'], path: '/api/v1/_test/spend', handler: handleSpend },
  { methods: ['POST'], path: '/api/v1/_test/run-scheduled', handler: handleRunScheduled },
  { methods: ['POST'], path: '/api/v1/_test/drain-queue', handler: handleDrainQueue },
  { methods: ['GET'], path: '/api/v1/_test/npc/usage', handler: handleNpcUsage },
  { methods: ['POST'], path: '/api/v1/_test/npc/tts', handler: handleNpcTts },
  { methods: ['POST'], path: '/api/v1/_test/builder/drain', handler: handleBuilderDrain },
];
