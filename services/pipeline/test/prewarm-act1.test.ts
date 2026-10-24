/**
 * M05c3 AC-5 (`prewarm-act1`, part of `pnpm check:pipeline`): the prewarm CLI's live path over the Miniflare pipeline and
 * `MockFalPort`. The first run submits the planned keys through "route 28" and every key ends with a manifest written last; the
 * second run finds every manifest, plans nothing and makes 0 FalPort calls and 0 route 28 submissions. Runs under Node against
 * Miniflare's R2 (the edge Worker's own bucket bindings), like `gate.prompt-lint.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { CutsceneStatus } from '@dv/shared';
import type { CutsceneRequest } from '@dv/shared/contracts/c09-cutscene';
import {
  GENAI_REGISTRY, MemoryRecorder, MockFalPort, MockSignPort, MockTranscodePort, fixtureEntry, handleFalWebhook, mockJwks, r2Blob, runCutsceneJob,
  type FalPort, type GenPorts, type StepConfig, type StepLike,
} from '../src/core.ts';
import { buildCutsceneJob } from '../../edge/src/cutscenes/job.ts';
import { manifestFindings } from '../../../tools/ci/check-c2pa.ts';
import { runPrewarm, type LedgerPort, type PrewarmOptions, type PrewarmPorts } from '../../../tools/assets/gen/prewarm.ts';

const fx = (f: string): string => path.join(import.meta.dirname, '../../../tools/assets/test/fixtures', f);
const act1 = (JSON.parse(readFileSync(fx('act1-requests.json'), 'utf8')) as { requests: CutsceneRequest[] }).requests;

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ MEDIA: R2Bucket; PRIVATE: R2Bucket }>>>;
beforeAll(async () => {
  process.env['WRANGLER_LOG'] ??= 'error';
  const configPath = path.resolve(import.meta.dirname, '../../edge/wrangler.jsonc');
  // remoteBindings: false keeps the remote-only Workers AI binding from starting a remote session (BD-FIX-CI4-E01).
  proxy = await getPlatformProxy({ configPath, environment: 'staging', persist: false, remoteBindings: false });
});
afterAll(async () => {
  await proxy.dispose();
});

/** In-process WorkflowStep shim: stages run in order, a retrying step retries, waitForEvent waits for the webhook. */
function shim(events: { wait: (ms: number) => Promise<unknown> }): StepLike {
  return {
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
      return { payload: (await events.wait(5000)) as T };
    },
  };
}

describe('prewarm-act1 over MockFalPort', () => {
  it('first run submits the planned keys and writes manifests last; the second run makes 0 calls', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const blob = r2Blob({ MEDIA, PRIVATE });
    const env = { FAL_MODE: 'mock', ENVIRONMENT: 'dev' };

    const counts = { falCalls: 0, route28Calls: 0, route28Keys: 0 };
    const outcomes = new Map<string, { writes: string[]; status: string }>();
    const recorder = new MemoryRecorder();

    /** What route 28 does for one key: the single-flight object runs the job, here in-process. */
    async function runJob(key: string): Promise<void> {
      const job = buildCutsceneJob(key, env, 'ops:prewarm');
      const instanceId = `cutscene_shot-${job.jobKey.slice(0, 12)}-1`;
      let wake: (p: unknown) => void = () => undefined;
      const woken = new Promise((r) => (wake = r));
      const events = { wait: (ms: number) => Promise.race([woken, new Promise((_, rej) => setTimeout(() => rej(new Error('waitForEvent timed out')), ms))]) };
      const inner = new MockFalPort({
        recorder,
        now: Date.now,
        deliver: async (request) => {
          await handleFalWebhook(request, {
            jwks: { get: () => mockJwks() },
            now: Date.now,
            getInstance: (id) => Promise.resolve(id === instanceId ? { sendEvent: (e) => Promise.resolve(wake(e.payload)) } : null),
          });
        },
      });
      const count = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => (counts.falCalls++, f(...a));
      const fal: FalPort = {
        submit: count(inner.submit.bind(inner)), status: count(inner.status.bind(inner)), result: count(inner.result.bind(inner)),
        cancel: count(inner.cancel.bind(inner)), fetchFile: count(inner.fetchFile.bind(inner)), keyframe: count(inner.keyframe.bind(inner)),
      };
      const slots = new Set<string>();
      const ports: GenPorts = {
        fal, blob,
        roster: { lookup: () => Promise.resolve(null) },
        budget: { reserve: () => Promise.resolve({ ok: true, level: 0 }), settle: () => Promise.resolve(), level: () => Promise.resolve(0) },
        flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
        clock: { now: Date.now },
        transcode: new MockTranscodePort(),
        sign: new MockSignPort(),
        falGate: { acquire: (id) => Promise.resolve(slots.size < 2 && (slots.add(id), true)), release: (id) => Promise.resolve(void slots.delete(id)) },
        sink: { complete: () => Promise.resolve(), fail: () => Promise.resolve() },
      };
      const out = await runCutsceneJob(shim(events), { ports, gate: { falMode: 'mock', environment: 'dev', registry: GENAI_REGISTRY }, instanceId, hostApi: 'https://api.test', mock: true }, job);
      outcomes.set(key, { writes: out.writes, status: out.status });
    }

    const ready = async (key: string): Promise<boolean> => (await MEDIA.head(`cutscenes/${key}/manifest.json`)) !== null;
    const ledger: LedgerPort = { capMicros: () => Promise.resolve(100_000_000), spentMicros: () => Promise.resolve(0) };
    const files = new Map<string, string>();
    const logs: string[] = [];
    const ports: PrewarmPorts = {
      log: (l) => logs.push(l),
      readText: (f) => {
        try {
          return readFileSync(f, 'utf8');
        } catch {
          return files.get(f) ?? null;
        }
      },
      writeText: (f, t) => void files.set(f, t),
      isReady: ready,
      ledger,
      resign: { resignOn: () => Promise.resolve(true) },
      worker: {
        prewarm: async (keys) => {
          counts.route28Calls++;
          counts.route28Keys += keys.length;
          const out: CutsceneStatus[] = [];
          for (const key of keys) {
            await runJob(key);
            out.push({ key, state: (await ready(key)) ? 'ready' : 'failed' });
          }
          return out;
        },
        status: async (key) => ({ key, state: (await ready(key)) ? 'ready' : 'failed' }),
      },
      rebuildIndex: () => Promise.resolve(0),
      sleep: () => Promise.resolve(),
      now: Date.now,
      defaults: { requests: () => fx('act1-requests.json'), registry: fx('registry-cleared.json'), sheets: fx('sheets-lock.json'), reportFile: (r) => `docs/releases/${r}/cutscenes.md` },
    };
    // every Act 1 character has approved crops in this scenario, so all nine refs are planned
    const allSheets = JSON.stringify({ schema: 'sheets-lock/1', sheets: Object.fromEntries(act1.flatMap((r) => r.characters.map((c) => [c.id, { approved: true, crops: ['a'.repeat(64)] }] as const))) });
    const options: PrewarmOptions = {
      release: 'fixture-act1', priority: 1, capMicros: 16_000_000, live: true, env: 'prod', report: true, offline: false,
      requestsFile: fx('act1-requests.json'), registryFile: fx('registry-cleared.json'), sheetsFile: 'inline-sheets.json',
    };
    const base = ports.readText;
    ports.readText = (f) => (f === 'inline-sheets.json' ? allSheets : base(f));

    // run 1
    const r1 = await runPrewarm(options, ports);
    expect(r1.code).toBe(0);
    const keys = act1.map((r) => r.key);
    expect(r1.plan!.rows.filter((x) => x.status === 'planned').map((x) => x.key)).toEqual(keys);
    expect(counts.route28Calls).toBe(1);
    expect(counts.route28Keys).toBe(9);
    const callsAfterRun1 = counts.falCalls;
    expect(callsAfterRun1).toBeGreaterThan(0);
    expect(recorder.count('submit')).toBe(9);
    for (const key of keys) {
      const manifestKey = `cutscenes/${key}/manifest.json`;
      const o = outcomes.get(key)!;
      expect(o.status).toBe('ready');
      expect(o.writes.at(-1)).toBe(manifestKey); // manifest written last
      expect(o.writes.filter((w) => w === manifestKey)).toHaveLength(1);
      const manifest = (await (await MEDIA.get(manifestKey))!.json()) as { provenance: { aiGenerated: boolean; resigned: boolean }; renditions: Record<string, { sha256: string }> };
      // the mock output was re-signed once with the pinned C2PA tool: it passes the production rules of check:c2pa
      expect(manifestFindings(key, manifest, { env: 'prod' })).toEqual([]);
      expect(manifest.provenance).toMatchObject({ aiGenerated: true, resigned: true });
      expect(manifest.renditions['v768']?.sha256).toBe(fixtureEntry('v768.mp4').sha256);
    }
    expect(files.get('docs/releases/fixture-act1/cutscenes.md')).toContain('Generated clips: 9 of 9');

    // run 2: nothing to do
    logs.length = 0;
    const r2 = await runPrewarm(options, ports);
    expect(r2.code).toBe(0);
    expect(r2.plan!.rows.every((x) => x.status === 'ready')).toBe(true);
    expect(counts.route28Calls).toBe(1); // 0 route 28 submissions in run 2
    expect(counts.falCalls).toBe(callsAfterRun1); // 0 FalPort calls in run 2
    expect(recorder.count('submit')).toBe(9);
    expect(logs.join('\n')).toContain('nothing to submit');
  }, 120_000);
});
