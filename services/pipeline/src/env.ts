/**
 * Bindings the pipeline needs from the Worker that hosts it, and the adapters that turn them into ports.
 * `tha-bay-web` passes its own Env, which is a superset of PipelineEnv.
 */
import { GENAI_GUARDRAILS, type GovLevel, type Vendor } from '@dv/shared';
import { handleFalWebhook, liveJwksSource, LiveFalPort, type JwksSource, type WebhookDeps } from './fal.ts';
import type { GateConfig } from './gate.ts';
import { GENAI_REGISTRY } from './registry.ts';
import { MockFalPort, type MockCallKind, type MockRecorder } from './mock/MockFalPort.ts';
import { MockSignPort } from './mock/MockSignPort.ts';
import { MockTranscodePort } from './mock/MockTranscodePort.ts';
import { mockJwks } from './mock/test-key.ts';
import type { Bucket, BlobPort, BudgetPort, FalGatePort, FlagsPort, GenPorts, JobSinkPort, RosterPort, SignPort, TranscodePort } from './ports.ts';
import { cutsceneKeyOf } from './steps/cutscene.ts';
import type { GenJob } from '@dv/shared';

export interface PipelineEnv {
  FAL_MODE: string;
  /** prod | staging | preview | dev */
  ENVIRONMENT: string;
  /** Origin that serves route 29. */
  HOST_API: string;
  FAL_KEY?: string | undefined;
  MEDIA: R2Bucket;
  PRIVATE: R2Bucket;
  FLAGS: KVNamespace;
  FAL_GATE: DurableObjectNamespace;
  GOVERNOR: DurableObjectNamespace;
  CUTSCENE_JOB: DurableObjectNamespace;
  GEN_WF: Workflow;
}

/** RPC surface of the DOs as the pipeline sees them (the classes live in services/edge and services/pipeline). */
interface GovernorRpc {
  reserve(v: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }>;
  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void>;
  level(): Promise<{ level: GovLevel }>;
}
interface FalGateRpc {
  acquire(jobId: string, ttlMs: number, slots?: number): Promise<boolean>;
  release(jobId: string): Promise<void>;
}
interface CutsceneJobRpc {
  complete(r: { manifestKey: string; costUsdMicros: number }): Promise<void>;
  fail(err: string): Promise<void>;
}

export const isMock = (env: Pick<PipelineEnv, 'FAL_MODE'>): boolean => env.FAL_MODE === 'mock';

/** `test` in mock mode, `production` on prod, `previs` elsewhere (GENAI_ENV of spec/domains/05-assets.md section 4.7). */
export function genaiEnv(env: Pick<PipelineEnv, 'FAL_MODE' | 'ENVIRONMENT'>): 'production' | 'previs' | 'test' {
  if (isMock(env)) return 'test';
  return env.ENVIRONMENT === 'prod' ? 'production' : 'previs';
}

export function gateConfig(env: Pick<PipelineEnv, 'FAL_MODE' | 'ENVIRONMENT'>): GateConfig {
  return { falMode: isMock(env) ? 'mock' : 'live', environment: env.ENVIRONMENT, registry: GENAI_REGISTRY };
}

export function r2Blob(env: Pick<PipelineEnv, 'MEDIA' | 'PRIVATE'>): BlobPort {
  const bucket = (b: Bucket): R2Bucket => (b === 'MEDIA' ? env.MEDIA : env.PRIVATE);
  return {
    async head(b, key) {
      const o = await bucket(b).head(key);
      return o === null ? null : { size: o.size };
    },
    async get(b, key) {
      const o = await bucket(b).get(key);
      return o === null ? null : new Uint8Array(await o.arrayBuffer());
    },
    async put(b, key, body, meta) {
      await bucket(b).put(key, body, {
        ...(meta?.contentType !== undefined ? { httpMetadata: { contentType: meta.contentType } } : {}),
        ...(meta?.custom !== undefined ? { customMetadata: meta.custom } : {}),
      });
    },
  };
}

interface KillRecord {
  on?: boolean;
  expiresAt?: number | null;
}

/** `ks:<name>` keys of the FLAGS namespace (spec/domains/09-backend-db.md section 5); a record is in force when `on` and unexpired. */
export function kvFlags(kv: KVNamespace, now: () => number = Date.now): FlagsPort {
  return {
    async killSwitches() {
      const out = new Set<string>();
      const listed = await kv.list({ prefix: 'ks:' });
      for (const k of listed.keys) {
        const rec = await kv.get<KillRecord>(k.name, { type: 'json', cacheTtl: 30 });
        if (rec?.on === true && (rec.expiresAt == null || rec.expiresAt > now())) out.add(k.name);
      }
      return out;
    },
  };
}

export function governorBudget(env: Pick<PipelineEnv, 'GOVERNOR' | 'ENVIRONMENT'>): BudgetPort {
  const stub = (): GovernorRpc => env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as GovernorRpc;
  return {
    reserve: (v, est, jobId) => stub().reserve(v, est, jobId),
    settle: (jobId, actual, requestId) => stub().settle(jobId, actual, requestId),
    level: async () => (await stub().level()).level,
  };
}

export function falGateDo(env: Pick<PipelineEnv, 'FAL_GATE' | 'ENVIRONMENT'>): FalGatePort {
  const stub = (): FalGateRpc => env.FAL_GATE.get(env.FAL_GATE.idFromName(`fal-gate:${env.ENVIRONMENT}`)) as unknown as FalGateRpc;
  return {
    acquire: (jobId, ttlMs) => stub().acquire(jobId, ttlMs, GENAI_GUARDRAILS.falConcurrency),
    release: (jobId) => stub().release(jobId),
  };
}

export function cutsceneSink(env: Pick<PipelineEnv, 'CUTSCENE_JOB'>, cutsceneKey: string): JobSinkPort {
  const stub = (): CutsceneJobRpc => env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${cutsceneKey}`)) as unknown as CutsceneJobRpc;
  return { complete: (r) => stub().complete(r), fail: (err) => stub().fail(err) };
}

/** No roster until M06a1 and M10a1: every character is unknown, so a job with a cast is refused (TIER_UNKNOWN). */
export const emptyRoster: RosterPort = { lookup: () => Promise.resolve(null) };

export function webhookDeps(env: Pick<PipelineEnv, 'FAL_MODE' | 'GEN_WF' | 'FLAGS'>): WebhookDeps {
  const jwks: JwksSource = isMock(env)
    ? { get: () => mockJwks() }
    : liveJwksSource({
        fetch: (...a) => fetch(...a),
        now: Date.now,
        store: { get: (k) => env.FLAGS.get(k === 'fal:jwks' ? 'jwks:fal' : k), put: (k, v, ttl) => env.FLAGS.put(k === 'fal:jwks' ? 'jwks:fal' : k, v, { expirationTtl: ttl }) },
      });
  return {
    jwks,
    now: Date.now,
    getInstance: async (id) => {
      try {
        return await env.GEN_WF.get(id);
      } catch {
        return null;
      }
    },
  };
}

/** Records mock calls as objects in PRIVATE (`mock-fal/<kind>/<jobKey>/<uuid>`), readable across isolates. */
export function r2Recorder(bucket: R2Bucket): MockRecorder {
  return {
    async record(kind: MockCallKind, jobKey: string, detail: string) {
      await bucket.put(`mock-fal/${kind}/${jobKey}/${crypto.randomUUID()}`, detail);
    },
  };
}

class UnavailableTranscode implements TranscodePort {
  transcode(): never {
    throw new Error('the Transcoder container (TRANSCODER) lands with the first live run (M05c3)');
  }
}
class UnavailableSign implements SignPort {
  resign(): never {
    throw new Error('the live SignPort adapter runs where the transcoder runs (M05c3)');
  }
}

/** Ports for one job. Mock mode replays fixtures; live mode binds fal and the not-yet-built container adapters. */
export function makePorts(env: PipelineEnv, job: GenJob): GenPorts {
  const blob = r2Blob(env);
  const base = {
    blob,
    roster: emptyRoster,
    budget: governorBudget(env),
    flags: kvFlags(env.FLAGS),
    clock: { now: () => Date.now() },
    falGate: falGateDo(env),
    sink: cutsceneSink(env, cutsceneKeyOf(job)),
  };
  if (isMock(env)) {
    const deps = webhookDeps(env);
    return {
      ...base,
      fal: new MockFalPort({
        recorder: r2Recorder(env.PRIVATE),
        deliver: async (request) => {
          await handleFalWebhook(request, deps);
        },
        now: Date.now,
        // Test hook: the FLAGS key `mock:fal:drop-webhook` = "1" holds the webhook back, so the test can send it by hand or let polling finish.
        dropWebhook: async () => (await env.FLAGS.get('mock:fal:drop-webhook')) === '1',
      }),
      transcode: new MockTranscodePort(),
      sign: new MockSignPort(),
    };
  }
  return { ...base, fal: new LiveFalPort({ key: env.FAL_KEY ?? '', fetch: (...a) => fetch(...a) }), transcode: new UnavailableTranscode(), sign: new UnavailableSign() };
}

