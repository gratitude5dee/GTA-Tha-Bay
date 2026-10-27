/**
 * Shared harness of the M05c4 scenarios (`prewarm-act1-offedge`, `prewarm-act1-publish`): the real CutsceneJobDO class of services/edge over
 * a fake DurableObjectState, a stand-in for the Workflows runtime that runs `runCutsceneJob` in-process, and Miniflare's R2 buckets.
 * Route 28 is `routePrewarm`: it calls the object's `ensure`, which is what the Worker's handler does per key.
 */
import type { GenJob, GovLevel } from '@dv/shared';
import { CutsceneJobDO } from '../../../edge/src/cutscenes/CutsceneJobDO.ts';
import { buildCutsceneJob } from '../../../edge/src/cutscenes/job.ts';
import type { Env } from '../../../edge/src/env.ts';
import {
  GENAI_REGISTRY, MemoryRecorder, MockFalPort, MockSignPort, MockTranscodePort, handleFalWebhook, mockJwks, r2Blob, runCutsceneJob, transcodeModeOf,
  type BlobPort, type FalPort, type GenPorts, type JobOutcome, type RosterEntry, type StepConfig, type StepLike,
} from '../../src/core.ts';

/** A Durable Object storage in memory: what CutsceneJobDO uses of `ctx.storage`, plus an alarm slot. */
class FakeStorage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;
  get<T>(k: string): Promise<T | undefined> {
    const v = this.map.get(k);
    return Promise.resolve(v === undefined ? undefined : (structuredClone(v) as T));
  }
  put(k: string, v: unknown): Promise<void> {
    this.map.set(k, structuredClone(v));
    return Promise.resolve();
  }
  setAlarm(t: number): Promise<void> {
    this.alarm = t;
    return Promise.resolve();
  }
  deleteAlarm(): Promise<void> {
    this.alarm = null;
    return Promise.resolve();
  }
}

/** `blockConcurrencyWhile` runs one call at a time, as the runtime does for input gates. */
function fakeState(): { storage: FakeStorage; blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> } {
  const storage = new FakeStorage();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    storage,
    blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

export interface HarnessOptions {
  MEDIA: R2Bucket;
  PRIVATE: R2Bucket;
  falMode: 'mock' | 'live';
  transcodeMode: string;
  /** The registry the gate reads; default: the repository's (every video provider pending). */
  registry?: typeof GENAI_REGISTRY;
  /** Character ids the roster reports as killed. */
  killed?: ReadonlySet<string>;
  /** Bytes the mock executor streams as the fal output (a large body proves nothing is hashed). */
  streamBytes?: () => Uint8Array;
}

export interface Counters {
  falCalls: number;
  reserves: number;
  settles: number;
  instancesStarted: number;
  publishInstances: number;
  blobOps: number;
}

const settleAll = async (ps: Promise<unknown>[]): Promise<void> => void (await Promise.allSettled(ps));

export class Harness {
  readonly counters: Counters = { falCalls: 0, reserves: 0, settles: 0, instancesStarted: 0, publishInstances: 0, blobOps: 0 };
  readonly recorder = new MemoryRecorder();
  readonly outcomes = new Map<string, JobOutcome>();
  readonly errors: unknown[] = [];
  readonly env: Pick<Env, 'FAL_MODE' | 'TRANSCODE_MODE' | 'ENVIRONMENT'> & Record<string, unknown>;
  private readonly objects = new Map<string, { state: ReturnType<typeof fakeState>; obj: CutsceneJobDO }>();
  private readonly running: Promise<unknown>[] = [];
  private readonly registry: typeof GENAI_REGISTRY;

  constructor(private readonly o: HarnessOptions) {
    this.registry = o.registry ?? GENAI_REGISTRY;
    this.env = {
      FAL_MODE: o.falMode,
      TRANSCODE_MODE: o.transcodeMode,
      ENVIRONMENT: o.falMode === 'live' ? 'staging' : 'dev',
      MEDIA: o.MEDIA,
      PRIVATE: o.PRIVATE,
      HOST_MEDIA: 'https://media.test',
      GEN_WF: { create: (a: { id: string; params: GenJob }) => this.startInstance(a.params, a.id) },
    };
  }

  /** The Durable Object of a key (instance `cut:<key>`), created on first use. */
  objectOf(key: string): CutsceneJobDO {
    let e = this.objects.get(key);
    if (e === undefined) {
      const state = fakeState();
      e = { state, obj: new CutsceneJobDO(state as never, this.env as unknown as Env) };
      this.objects.set(key, e);
    }
    return e.obj;
  }

  alarmOf(key: string): number | null {
    this.objectOf(key);
    return this.objects.get(key)!.state.storage.alarm;
  }

  jobFor(key: string, extra: Record<string, unknown> = {}): GenJob {
    const job = buildCutsceneJob(key, this.env as unknown as Pick<Env, 'FAL_MODE' | 'ENVIRONMENT'>, 'ops:prewarm');
    return { ...job, params: { ...job.params, ...extra } };
  }

  /** Route 28: per key, the single-flight object's `ensure` with generation allowed (the Worker's handler does exactly this). */
  async routePrewarm(keys: string[], extra: Record<string, unknown> = {}): Promise<Awaited<ReturnType<CutsceneJobDO['ensure']>>[]> {
    const out: Awaited<ReturnType<CutsceneJobDO['ensure']>>[] = [];
    for (const key of keys) out.push(await this.objectOf(key).ensure(this.jobFor(key, extra), { allowGenerate: true }));
    return out;
  }

  /** Waits for every started instance, including the ones they start. */
  async idle(): Promise<void> {
    for (let n = -1; n !== this.running.length; ) {
      n = this.running.length;
      await settleAll([...this.running]);
    }
  }

  private startInstance(job: GenJob, instanceId: string): Promise<void> {
    this.counters.instancesStarted++;
    if (job.params['phase'] === 'publish') this.counters.publishInstances++;
    const run = this.runInstance(job, instanceId).catch((e: unknown) => void this.errors.push(e));
    this.running.push(run);
    return Promise.resolve();
  }

  private ports(key: string, instanceId: string): { ports: GenPorts; steps: StepLike } {
    const { counters } = this;
    const obj = this.objectOf(key);
    const blob = r2Blob({ MEDIA: this.o.MEDIA, PRIVATE: this.o.PRIVATE });
    const counted: BlobPort = {
      head: (...a) => (counters.blobOps++, blob.head(...a)),
      get: (...a) => (counters.blobOps++, blob.get(...a)),
      put: (...a) => (counters.blobOps++, blob.put(...a)),
      // The Node proxy of Miniflare cannot take a stream of unknown length, so the test reads it whole; the Worker's own putStream
      // (FixedLengthStream into R2) is covered in workerd by services/edge/test/pipeline-blob-stream.test.ts.
      putStream: async (b, key, body, _size, meta) => {
        counters.blobOps++;
        await blob.put(b, key, new Uint8Array(await new Response(body).arrayBuffer()), meta);
      },
      copy: (...a) => ((counters.blobOps += 2), blob.copy(...a)),
    };
    let wake: (p: unknown) => void = () => undefined;
    const woken = new Promise((r) => (wake = r));
    const inner = new MockFalPort({
      recorder: this.recorder,
      now: Date.now,
      ...(this.o.streamBytes !== undefined ? { streamBytes: this.o.streamBytes } : {}),
      deliver: async (request) => {
        await handleFalWebhook(request, {
          jwks: { get: () => mockJwks() },
          now: Date.now,
          getInstance: (id) => Promise.resolve(id === instanceId ? { sendEvent: (e) => Promise.resolve(wake(e.payload)) } : null),
        });
      },
    });
    const count = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => (counters.falCalls++, f(...a));
    const fal: FalPort = {
      submit: count(inner.submit.bind(inner)), status: count(inner.status.bind(inner)), result: count(inner.result.bind(inner)), cancel: count(inner.cancel.bind(inner)),
      fetchFile: count(inner.fetchFile.bind(inner)), fetchStream: count(inner.fetchStream.bind(inner)), keyframe: count(inner.keyframe.bind(inner)),
    };
    const killed = this.o.killed ?? new Set<string>();
    const slots = new Set<string>();
    const ports: GenPorts = {
      fal,
      blob: counted,
      roster: { lookup: (id): Promise<RosterEntry | null> => Promise.resolve({ id, tier: 'fictionalized', soulVersion: 1, killed: killed.has(id) ? ['all'] : [] }) },
      budget: {
        reserve: () => (counters.reserves++, Promise.resolve({ ok: true, level: 0 as GovLevel })),
        settle: () => (counters.settles++, Promise.resolve()),
        level: () => Promise.resolve(0 as GovLevel),
      },
      flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
      clock: { now: () => Date.now() },
      transcode: new MockTranscodePort(),
      sign: new MockSignPort(),
      falGate: { acquire: (id) => Promise.resolve(slots.size < 2 && (slots.add(id), true)), release: (id) => Promise.resolve(void slots.delete(id)) },
      sink: { complete: (r) => obj.complete(r), fail: (e, c) => obj.fail(e, c), handoff: (r) => obj.handoff(r) },
    };
    const steps: StepLike = {
      async do<T>(_name: string, a: StepConfig | (() => Promise<T>), b?: () => Promise<T>): Promise<T> {
        const fn = typeof a === 'function' ? a : b!;
        const limit = typeof a === 'function' ? 0 : (a.retries?.limit ?? 0);
        for (let attempt = 0; ; attempt++) {
          try {
            return await fn();
          } catch (e) {
            if (attempt >= limit) throw e;
          }
        }
      },
      async waitForEvent<T>(): Promise<{ payload: T }> {
        return { payload: (await Promise.race([woken, new Promise((_, rej) => setTimeout(() => rej(new Error('waitForEvent timed out')), 5000))])) as T };
      },
    };
    return { ports, steps };
  }

  private async runInstance(job: GenJob, instanceId: string): Promise<void> {
    const key = job.params['cutsceneKey'] as string;
    const { ports, steps } = this.ports(key, instanceId);
    const out = await runCutsceneJob(
      steps,
      {
        ports,
        gate: { falMode: this.o.falMode, environment: this.o.falMode === 'live' ? 'staging' : 'dev', registry: this.registry, log: () => undefined },
        instanceId,
        hostApi: 'https://api.test',
        mock: this.o.falMode === 'mock',
        transcodeMode: transcodeModeOf({ FAL_MODE: this.o.falMode, TRANSCODE_MODE: this.o.transcodeMode }) ?? 'mock',
      },
      job,
    );
    this.outcomes.set(key, out);
  }

  /** Runs one job directly, without the object (the pairing guard of the run function). */
  async runDirect(key: string, ctxOverride: { mock: boolean; transcodeMode: 'mock' | 'offedge' }): Promise<{ outcome: JobOutcome; failures: string[] }> {
    const failures: string[] = [];
    const { ports, steps } = this.ports(key, 'direct');
    ports.sink = { complete: () => Promise.resolve(), fail: (e) => Promise.resolve(void failures.push(e)), handoff: () => Promise.resolve() };
    const outcome = await runCutsceneJob(
      steps,
      { ports, gate: { falMode: ctxOverride.mock ? 'mock' : 'live', environment: 'staging', registry: this.registry, log: () => undefined }, instanceId: 'direct', hostApi: 'https://api.test', ...ctxOverride },
      this.jobFor(key),
    );
    return { outcome, failures };
  }
}

/** A registry copy in which the default video provider is `cleared` (so a live-mode gate passes) or any other status. */
export function registryWith(status: 'cleared' | 'pending'): typeof GENAI_REGISTRY {
  const reg = structuredClone(GENAI_REGISTRY);
  const p = reg.videoProviders[reg.defaults.videoProvider];
  if (p === undefined) throw new Error('registry has no default video provider');
  p.licence.status = status;
  return reg;
}
