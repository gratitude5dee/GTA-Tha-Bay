/**
 * pnpm check:pipeline — one cutscene_shot job end to end over MockFalPort, then the same key again (M05b1 AC-9).
 *
 * The stages run through an in-process WorkflowStep shim (no Workflows runtime) against a Miniflare R2 bucket pair, so the
 * first run proves renditions, poster, last frame, subtitles and the manifest (written last, aiGenerated and resigned true),
 * and the second run proves that a published key makes 0 FalPort calls. The mock executor posts its signed webhook through
 * the real verifier and wakes the shim's waitForEvent. The same code runs inside GenJobWorkflow; services/edge/test covers
 * the Workflows runtime (cutscene-singleflight, genjob-poll-fallback, fal-webhook-verify).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { NO_ENV_FILE, scrubProcessEnv } from '../../../tools/ci/secret-env.ts';
import {
  FAL_DONE_EVENT,
  GENAI_REGISTRY,
  MemoryRecorder,
  MockFalPort,
  MockSignPort,
  MockTranscodePort,
  handleFalWebhook,
  mockJwks,
  r2Blob,
  runCutsceneJob,
  type FalPort,
  type GenPorts,
  type JobOutcome,
  type StepConfig,
  type StepLike,
} from '../src/core.ts';
import { buildCutsceneJob } from '../../edge/src/cutscenes/job.ts';

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const failures: string[] = [];
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || detail === '' ? '' : ` (${detail})`}`);
  if (!ok) failures.push(what);
};

/** Counts every call that reaches the mock executor. */
function countingFal(inner: MockFalPort): { fal: FalPort; calls: () => number } {
  let n = 0;
  const wrap = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => {
    n += 1;
    return f(...a);
  };
  return {
    calls: () => n,
    fal: {
      submit: wrap(inner.submit.bind(inner)),
      status: wrap(inner.status.bind(inner)),
      result: wrap(inner.result.bind(inner)),
      cancel: wrap(inner.cancel.bind(inner)),
      fetchFile: wrap(inner.fetchFile.bind(inner)),
      fetchStream: wrap(inner.fetchStream.bind(inner)),
      keyframe: wrap(inner.keyframe.bind(inner)),
    },
  };
}

function makeShim(events: { wake: (payload: unknown) => void; wait: (ms: number) => Promise<unknown> }, log: string[]): StepLike {
  return {
    async do<T>(name: string, a: StepConfig | (() => Promise<T>), b?: () => Promise<T>): Promise<T> {
      const fn = typeof a === 'function' ? a : b!;
      const limit = typeof a === 'function' ? 0 : (a.retries?.limit ?? 0);
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await fn();
          log.push(name);
          return out;
        } catch (e) {
          if (attempt >= limit) throw e;
        }
      }
    },
    async waitForEvent<T>(name: string): Promise<{ payload: T }> {
      log.push(`wait:${name}`);
      return { payload: (await events.wait(5000)) as T };
    },
  };
}

async function main(): Promise<void> {
  // BD-FIX-SEC-01: the Miniflare proxy (edge wrangler config) and the spawned Vitest start without a live secret.
  scrubProcessEnv({ label: 'check:pipeline' });
  process.env['WRANGLER_LOG'] ??= 'error'; // the edge config binds Durable Objects that a Node proxy cannot host; only R2 is used
  // The R2 buckets come from the edge Worker's own wrangler config (Miniflare under the hood, nothing persisted).
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../edge/wrangler.jsonc');
  // remoteBindings: false keeps every binding local (wrangler's GetPlatformProxyOptions; default true). Without it the
  // remote-only Workers AI `ai` binding (M06a4) starts a remote proxy session, which needs CLOUDFLARE_API_TOKEN (BD-FIX-CI4-E01).
  // envFiles: NO_ENV_FILE alone: the proxy reads neither services/edge/.dev.vars nor any .env file, which may hold live secrets (BD-FIX-SEC-02).
  const proxy = await getPlatformProxy<{ MEDIA: R2Bucket; PRIVATE: R2Bucket }>({
    configPath,
    environment: 'staging',
    persist: false,
    remoteBindings: false,
    envFiles: [NO_ENV_FILE],
  });
  try {
    const { MEDIA, PRIVATE } = proxy.env;
    const blob = r2Blob({ MEDIA, PRIVATE });

    const key = 'c'.repeat(64);
    const env = { FAL_MODE: 'mock', ENVIRONMENT: 'dev' };
    const job = buildCutsceneJob(key, env, 'check:pipeline');
    const instanceId = `cutscene_shot-${job.jobKey.slice(0, 12)}-1`;

    // wake-up channel between the webhook handler and the shim's waitForEvent
    let wake: (p: unknown) => void = () => undefined;
    let woken: Promise<unknown> = new Promise((r) => (wake = r));
    const events = {
      wake: (p: unknown): void => wake(p),
      wait: (ms: number): Promise<unknown> =>
        Promise.race([woken, new Promise((_, rej) => setTimeout(() => rej(new Error('waitForEvent timed out')), ms))]),
    };

    const recorder = new MemoryRecorder();
    const sink = { completed: [] as string[], failed: [] as string[] };
    const slots = new Set<string>();
    const reserved = new Map<string, number>();
    const inner = new MockFalPort({
      recorder,
      now: Date.now,
      deliver: async (request) => {
        const res = await handleFalWebhook(request, {
          jwks: { get: () => mockJwks() },
          now: Date.now,
          getInstance: (id) => Promise.resolve(id === instanceId ? { sendEvent: (e) => Promise.resolve(events.wake(e.payload)) } : null),
        });
        check(res.status === 200 && res.delivered, 'the signed mock webhook verifies and wakes the instance', JSON.stringify(res));
      },
    });
    const { fal, calls } = countingFal(inner);
    const ports: GenPorts = {
      fal,
      blob,
      roster: { lookup: () => Promise.resolve(null) },
      budget: {
        reserve: (_v, est, id) => {
          reserved.set(id, est);
          return Promise.resolve({ ok: true, level: 0 });
        },
        settle: () => Promise.resolve(),
        level: () => Promise.resolve(0),
      },
      flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
      clock: { now: Date.now },
      transcode: new MockTranscodePort(),
      sign: new MockSignPort(),
      falGate: {
        acquire: (id) => Promise.resolve(slots.size < 2 && (slots.add(id), true)),
        release: (id) => Promise.resolve(void slots.delete(id)),
      },
      sink: {
        complete: (r) => Promise.resolve(void sink.completed.push(r.manifestKey)),
        fail: (e) => Promise.resolve(void sink.failed.push(e)),
        handoff: () => Promise.resolve(),
      },
    };
    const ctx = { ports, gate: { falMode: 'mock' as const, environment: 'dev', registry: GENAI_REGISTRY }, instanceId, hostApi: 'https://api.test', mock: true, transcodeMode: 'mock' as const };

    // run 1: generate
    const log1: string[] = [];
    const out1: JobOutcome = await runCutsceneJob(makeShim(events, log1), ctx, job);
    const manifestKey = `cutscenes/${key}/manifest.json`;
    check(out1.status === 'ready', 'run 1: the job is ready', JSON.stringify(out1));
    check(out1.writes.at(-1) === manifestKey && out1.writes.filter((w) => w === manifestKey).length === 1, 'run 1: manifest.json is written last');
    for (const f of ['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt']) {
      check((await MEDIA.head(`cutscenes/${key}/${f}`)) !== null, `run 1: cutscenes/<key>/${f} is in MEDIA`);
    }
    check((await PRIVATE.head(`cutscenes-orig/${key}/orig.mp4`)) !== null, 'run 1: orig.mp4 is kept in PRIVATE only');
    check((await MEDIA.head(`cutscenes-orig/${key}/orig.mp4`)) === null, 'run 1: orig.mp4 is not public');
    const manifest = (await (await MEDIA.get(manifestKey))!.json()) as { provenance: { aiGenerated: boolean; resigned: boolean; origSha256: string }; schema: string };
    check(manifest.schema === 'cutscene-asset/1', 'run 1: manifest schema is cutscene-asset/1');
    check(manifest.provenance.aiGenerated === true, 'run 1: provenance.aiGenerated is true');
    check(manifest.provenance.resigned === true, 'run 1: provenance.resigned is true');
    check(/^[0-9a-f]{64}$/.test(manifest.provenance.origSha256), 'run 1: provenance.origSha256 is recorded');
    check(recorder.count('submit') === 1, 'run 1: exactly 1 submit', String(recorder.count('submit')));
    check(out1.webhook === 'event', 'run 1: the webhook woke waitForEvent', String(out1.webhook));
    check(sink.completed.length === 1 && sink.failed.length === 0, 'run 1: the single-flight object was told once');
    check(slots.size === 0, 'run 1: the fal slot was released');
    const order = ['gate:gate', 'cache-check', 'gate:budget-reserve', 'budget-reserve', 'acquire', 'keyframes', 'plan', 'submit', `wait:${FAL_DONE_EVENT}`, 'poll', 'release', 'copy-orig', 'transcode', 'captions', 'qa-gate', 'gate:resign', 'resign', 'subs', 'publish', 'record', 'complete'];
    check(JSON.stringify(log1) === JSON.stringify(order), 'run 1: the stages ran in the specified order', log1.join(' > '));

    // run 2: same key, nothing generated, nothing spent
    const before = calls();
    woken = new Promise((r) => (wake = r));
    const log2: string[] = [];
    const out2 = await runCutsceneJob(makeShim(events, log2), ctx, job);
    check(out2.status === 'cached', 'run 2: the key is cached', JSON.stringify(out2));
    check(calls() - before === 0, 'run 2: 0 FalPort calls', String(calls() - before));
    check(recorder.count('submit') === 1, 'run 2: still exactly 1 submit overall');
    check(log2.join(' > ') === 'gate:gate > cache-check > complete', 'run 2: stops after the cache check', log2.join(' > '));
  } finally {
    await proxy.dispose();
  }

  // M05b2: the gate's prompt lint over the PRIVATE names object (AC-11); M05c3: the prewarm-act1 scenario (AC-5); M05c4: the prewarm-act1-offedge
  // (AC-1, AC-2) and prewarm-act1-publish (AC-6) scenarios. All run in Node over Miniflare's R2; the last two construct the real CutsceneJobDO.
  // M10a1: character.pipeline.test.ts runs the character chain (tier check to publish, human gates answered by fixture decisions) over MockFalPort.
  const lint = spawnSync('pnpm', ['exec', 'vitest', 'run', '--root', 'services/pipeline'], { cwd: repoRootDir, stdio: 'inherit' });
  check(lint.status === 0, 'gate.prompt-lint, prewarm-act1, prewarm-act1-offedge and prewarm-act1-publish: the gate lints the filled prompt with the real-side names from PRIVATE; the Act 1 plan submits its keys once and the second run makes 0 calls; a live job hands off and survives the watchdog, the re-arm and a quarantine; the publish phase copies, refuses a killed cast and writes the manifest last; a character runs from the tier check through publish on recorded fixtures, writes every gate report, chains its provenance to generated roots, makes zero calls on the second run and falls to the second mesh when the rig answers 422');

  if (failures.length > 0) {
    console.error(`check:pipeline FAIL ${failures.length} check(s)`);
    process.exit(1);
  }
  console.log('check:pipeline ok');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
