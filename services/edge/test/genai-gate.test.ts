import { describe, expect, it } from 'vitest';
import { jobKey, sha256Hex, type GenJob, type GovLevel } from '@dv/shared';
import {
  assertStageAllowed,
  evaluateGate,
  GENAI_REGISTRY,
  genaiEnv,
  MemoryRecorder,
  MockFalPort,
  MockSignPort,
  MockTranscodePort,
  runCutsceneJob,
  type GateInputs,
  type GenPorts,
  type RosterEntry,
  type StepConfig,
  type StepLike,
} from '@dv/pipeline/core';
import { buildCutsceneJob } from '../src/cutscenes/job.ts';
import { keyOf } from './cutscene-helpers.ts';

const mockEnv = { FAL_MODE: 'mock', ENVIRONMENT: 'staging' };
const liveEnv = { FAL_MODE: 'live', ENVIRONMENT: 'staging' };
const key = keyOf('gate');

function inputs(over: Partial<GateInputs> = {}): GateInputs {
  return { falMode: 'mock', environment: 'staging', registry: GENAI_REGISTRY, killSwitches: new Set(), govLevel: 0 as GovLevel, roster: new Map(), ...over };
}

function withCast(ids: string[], extra: Record<string, unknown> = {}): GenJob {
  const base = buildCutsceneJob(key, mockEnv, 'test');
  const params = { ...base.params, characters: ids.map((id) => ({ id, soulVersion: 1, tier: 'parody' })), ...extra };
  return { ...base, params, jobKey: jobKey({ kind: 'cutscene_shot', endpointId: 'x', pinnedUpdatedAt: null, params, inputSha256: [], promptTemplate: 'mock@1', promptSha256: base.promptSha256, recipe: 'cut@1' }) };
}

const roster = (rows: Partial<RosterEntry>[]): Map<string, RosterEntry | null> =>
  new Map(rows.map((r) => [r.id ?? 'x', { id: 'x', tier: 'parody', soulVersion: 1, killed: [], ...r } as RosterEntry]));

/** In-process WorkflowStep: runs each step once, no sleeping, retries without delay. */
function shim(): StepLike {
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
    waitForEvent: () => Promise.reject(new Error('timeout')),
  };
}

describe('registry state this milestone relies on', () => {
  it('no video provider is cleared (pending or blocked until ADR-GENAI-01)', () => {
    for (const p of Object.values(GENAI_REGISTRY.videoProviders)) expect(['pending', 'blocked']).toContain(p.licence.status);
  });
});

describe('the gate refuses before any FalPort call (AC-8)', () => {
  it('FAL_MODE=live with every provider pending: ENDPOINT_NOT_CLEARED, and FalPort.submit is never called', async () => {
    const recorder = new MemoryRecorder();
    const fal = new MockFalPort({ recorder, deliver: () => Promise.resolve(), now: Date.now });
    const sinkCalls: string[] = [];
    const ports: GenPorts = {
      fal,
      blob: { head: () => Promise.resolve(null), get: () => Promise.resolve(null), put: () => Promise.resolve(), putStream: () => Promise.resolve(), copy: () => Promise.resolve(null) },
      roster: { lookup: () => Promise.resolve(null) },
      budget: { reserve: () => Promise.resolve({ ok: true, level: 0 as GovLevel }), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as GovLevel) },
      flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
      clock: { now: Date.now },
      transcode: new MockTranscodePort(),
      sign: new MockSignPort(),
      falGate: { acquire: () => Promise.resolve(true), release: () => Promise.resolve() },
      sink: { complete: () => Promise.resolve(), fail: (e) => void sinkCalls.push(e) as unknown as Promise<void>, handoff: () => Promise.resolve() },
    };
    const job = buildCutsceneJob(key, liveEnv, 'test');
    expect(job.env).toBe('previs');
    const out = await runCutsceneJob(shim(), { ports, gate: { falMode: 'live', environment: 'staging', registry: GENAI_REGISTRY }, instanceId: 'wf', hostApi: 'https://x.test', mock: false }, job);
    expect(out).toMatchObject({ status: 'refused', code: 'ENDPOINT_NOT_CLEARED' });
    expect(recorder.count('submit')).toBe(0);
    expect(recorder.count('keyframe')).toBe(0);
    expect(sinkCalls[0]).toMatch(/^ENDPOINT_NOT_CLEARED/);
  });

  it('production refuses even in mock mode; mock mode in staging passes the static rules', () => {
    const job = buildCutsceneJob(key, mockEnv, 'test');
    expect(evaluateGate(job, 'gate', inputs({ environment: 'prod' }))).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
    expect(evaluateGate(job, 'gate', inputs({ falMode: 'live' }))).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
    expect(evaluateGate(job, 'gate', inputs())).toEqual({ ok: true });
    expect(genaiEnv(mockEnv)).toBe('test');
    expect(genaiEnv({ FAL_MODE: 'live', ENVIRONMENT: 'prod' })).toBe('production');
  });

  it('a cleared provider passes in live mode (the day ADR-GENAI-01 clears one)', () => {
    const reg = structuredClone(GENAI_REGISTRY);
    reg.videoProviders[reg.defaults.videoProvider]!.licence.status = 'cleared';
    expect(evaluateGate(buildCutsceneJob(key, liveEnv, 'test'), 'gate', inputs({ falMode: 'live', registry: reg }))).toEqual({ ok: true });
  });

  it('refuses an unknown provider and a banned endpoint', () => {
    const job = buildCutsceneJob(key, mockEnv, 'test');
    expect(evaluateGate({ ...job, endpointKey: 'nope' }, 'gate', inputs())).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
    const reg = structuredClone(GENAI_REGISTRY);
    reg.videoProviders[job.endpointKey]!.endpoints.i2v = 'minimax/h3-max/recast';
    expect(evaluateGate(job, 'gate', inputs({ registry: reg }))).toMatchObject({ ok: false, code: 'ENDPOINT_BANNED' });
  });
});

describe('likeness, prompt and submit-time rules', () => {
  it('unknown, minor and killed characters; non-consented casts are toon-pbr only with first-party inputs', () => {
    expect(evaluateGate(withCast(['npc:a']), 'gate', inputs())).toMatchObject({ ok: false, code: 'TIER_UNKNOWN' });
    expect(evaluateGate(withCast(['npc:a']), 'gate', inputs({ roster: roster([{ id: 'npc:a', minor: true }]) }))).toMatchObject({ code: 'TIER_UNKNOWN' });
    expect(evaluateGate(withCast(['npc:a']), 'gate', inputs({ roster: roster([{ id: 'npc:a', killed: ['cutscene'] }]) }))).toMatchObject({ code: 'KILLED' });
    expect(evaluateGate(withCast(['npc:a']), 'gate', inputs({ roster: roster([{ id: 'npc:a', killed: ['voice'] }]) }))).toEqual({ ok: true });
    expect(evaluateGate(withCast(['npc:a'], { preset: 'photoreal' }), 'gate', inputs({ roster: roster([{ id: 'npc:a' }]) }))).toMatchObject({ code: 'PHOTOREAL_FORBIDDEN' });
    const photo = { ...withCast(['npc:a']), inputs: [{ role: 'face', sha256: 'a'.repeat(64), origin: 'consented_photo' as const, realHumanVisible: true }] };
    expect(evaluateGate(photo, 'gate', inputs({ roster: roster([{ id: 'npc:a' }]) }))).toMatchObject({ code: 'FACE_REF_FORBIDDEN' });
  });

  it('the prompt-lint stub fails an empty prompt; a supplied linter decides otherwise', () => {
    const empty = { ...buildCutsceneJob(key, mockEnv, 'test'), params: { cutsceneKey: key, seed: 1 } };
    expect(evaluateGate(empty, 'gate', inputs())).toMatchObject({ ok: false, code: 'POLICY_REFUSED', detail: 'empty prompt' });
    const job = buildCutsceneJob(key, mockEnv, 'test');
    const lint = (t: string): { ok: boolean; code?: 'NAME_IN_PROMPT'; detail?: string } => (t.includes('Mock') ? { ok: false, code: 'NAME_IN_PROMPT', detail: 'name' } : { ok: true });
    expect(evaluateGate(job, 'gate', inputs({ lintPrompt: lint }))).toMatchObject({ code: 'NAME_IN_PROMPT' });
  });

  it('kill switches and governor level 3 stop new submits only from budget-reserve on', () => {
    const job = buildCutsceneJob(key, mockEnv, 'test');
    for (const ks of ['ks:genai:all', 'ks:fal', 'ks:cutscene_gen', `ks:fal:${GENAI_REGISTRY.videoProviders[job.endpointKey]!.endpoints.i2v}`]) {
      const g = inputs({ killSwitches: new Set([ks]) });
      expect(evaluateGate(job, 'gate', g)).toEqual({ ok: true });
      expect(evaluateGate(job, 'budget-reserve', g)).toMatchObject({ ok: false, code: 'KILL_SWITCH' });
    }
    expect(evaluateGate(job, 'submit', inputs({ govLevel: 3 }))).toMatchObject({ ok: false, code: 'BUDGET' });
    expect(evaluateGate(job, 'submit', inputs({ govLevel: 2 }))).toEqual({ ok: true });
  });

  it('assertStageAllowed reads the ports', async () => {
    const job = buildCutsceneJob(key, mockEnv, 'test');
    const ports = {
      roster: { lookup: () => Promise.resolve(null) },
      flags: { killSwitches: () => Promise.resolve(new Set(['ks:cutscene_gen'])) },
      budget: { reserve: () => Promise.resolve({ ok: true, level: 0 as GovLevel }), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as GovLevel) },
    };
    const cfg = { falMode: 'mock' as const, environment: 'staging', registry: GENAI_REGISTRY };
    expect(await assertStageAllowed(job, 'gate', ports, cfg)).toEqual({ ok: true });
    expect(await assertStageAllowed(job, 'submit', ports, cfg)).toMatchObject({ ok: false, code: 'KILL_SWITCH' });
    expect(sha256Hex('x')).toHaveLength(64);
  });
});
