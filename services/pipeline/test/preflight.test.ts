/**
 * M05c3: a live cutscene job checks its container, its signer and the re-sign switch before it reserves any money
 * (stage `preflight`, after the cache check and before `budget-reserve`). In-memory ports, no Workers runtime.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GenAiRegistry } from '@dv/shared';
import { MockFalPort, MemoryRecorder, runCutsceneJob, type GenPorts, type JobOutcome, type RunContext, type StepConfig, type StepLike } from '../src/core.ts';
import { buildCutsceneJob } from '../../edge/src/cutscenes/job.ts';

const registry = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../tools/assets/test/fixtures/registry-cleared.json'), 'utf8')) as GenAiRegistry;
const KEY = 'e'.repeat(64);

const step: StepLike = {
  async do<T>(_name: string, a: StepConfig | (() => Promise<T>), b?: () => Promise<T>): Promise<T> {
    return (typeof a === 'function' ? a : b!)();
  },
  waitForEvent: () => Promise.reject(new Error('the job must stop before it waits for fal')),
};

interface Probe {
  reserves: number;
  steps: string[];
  failed: string[];
}

function run(o: { environment: 'prod' | 'staging'; resign?: boolean; transcodeReady?: string | null; signReady?: string | null; ready?: boolean }): Promise<{ out: JobOutcome; probe: Probe }> {
  const probe: Probe = { reserves: 0, steps: [], failed: [] };
  const recorder = new MemoryRecorder();
  const ports: GenPorts = {
    fal: new MockFalPort({ recorder, now: Date.now, deliver: () => Promise.resolve() }),
    blob: { head: () => Promise.resolve(null), get: () => Promise.resolve(null), put: () => Promise.resolve() },
    roster: { lookup: () => Promise.resolve(null) },
    // the governor refuses, so a job that passes the preflight stops right after it
    budget: { reserve: () => (probe.reserves++, Promise.resolve({ ok: false, level: 0 as const })), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as const) },
    flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
    clock: { now: Date.now },
    transcode: { transcode: () => Promise.reject(new Error('not reached')), ...(o.transcodeReady !== undefined ? { ready: () => Promise.resolve(o.transcodeReady ?? null) } : {}) },
    sign: { resign: () => Promise.reject(new Error('not reached')), ...(o.signReady !== undefined ? { ready: () => Promise.resolve(o.signReady ?? null) } : {}) },
    falGate: { acquire: () => Promise.resolve(true), release: () => Promise.resolve() },
    sink: { complete: () => Promise.resolve(), fail: (e) => Promise.resolve(void probe.failed.push(e)) },
  };
  const ctx: RunContext = {
    ports,
    gate: { falMode: 'live', environment: o.environment, registry },
    instanceId: 'cutscene_shot-test-1',
    hostApi: 'https://api.test',
    mock: false,
    ...(o.resign !== undefined ? { resign: o.resign } : {}),
  };
  // the cleared fixture registry names h3.partner; the job's provider and env follow the Worker environment
  const job = { ...buildCutsceneJob(KEY, { FAL_MODE: 'live', ENVIRONMENT: o.environment }, 'test'), endpointKey: 'h3.partner' };
  const counting: StepLike = {
    do: ((name: string, a: StepConfig | (() => Promise<unknown>), b?: () => Promise<unknown>) => (probe.steps.push(name), step.do(name, a as never, b as never))) as StepLike['do'],
    waitForEvent: step.waitForEvent,
  };
  return runCutsceneJob(counting, ctx, job).then((out) => ({ out, probe }));
}

describe('preflight', () => {
  it('a production run with C2PA_RESIGN off is refused before any reservation', async () => {
    const { out, probe } = await run({ environment: 'prod', resign: false, transcodeReady: null, signReady: null });
    expect(out).toMatchObject({ status: 'refused', code: 'POLICY_REFUSED' });
    expect(out.detail).toMatch(/C2PA_RESIGN is off/);
    expect(probe.reserves).toBe(0);
  });

  it('a container that is not ready, or a signer that is missing, refuses before any reservation', async () => {
    const a = await run({ environment: 'prod', transcodeReady: 'the container did not answer /health', signReady: null });
    expect(a.out).toMatchObject({ status: 'refused', code: 'POLICY_REFUSED' });
    expect(a.out.detail).toMatch(/transcoder: the container did not answer/);
    expect(a.probe.reserves).toBe(0);
    expect(a.probe.failed[0]).toMatch(/preflight/);
    const b = await run({ environment: 'prod', transcodeReady: null, signReady: 'the container holds no C2PA signing key' });
    expect(b.out.detail).toMatch(/c2pa signer: the container holds no C2PA signing key/);
    expect(b.probe.reserves).toBe(0);
  });

  it('with everything ready the job goes on to the budget reservation', async () => {
    const { out, probe } = await run({ environment: 'prod', transcodeReady: null, signReady: null });
    expect(probe.reserves).toBe(1);
    expect(out).toMatchObject({ status: 'refused', code: 'BUDGET' });
    expect(probe.steps).toContain('preflight');
  });

  it('with re-signing off outside production the signer is not consulted', async () => {
    const { out, probe } = await run({ environment: 'staging', resign: false, transcodeReady: null, signReady: 'no key' });
    expect(probe.reserves).toBe(1);
    expect(out.code).toBe('BUDGET');
  });

  it('adapters without a ready() add no preflight step (the mock path keeps its stage order)', async () => {
    const { probe } = await run({ environment: 'prod' });
    expect(probe.steps).not.toContain('preflight');
    expect(probe.reserves).toBe(1);
  });
});
