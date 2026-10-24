/**
 * M05b2 AC-11: the gate lints the filled prompt before any FalPort call, with the real-side names read from the PRIVATE bucket
 * (`config/names-real.json`, DL-240). Runs under Node against Miniflare's R2 (the edge Worker's own bucket bindings), the way
 * `pnpm check:pipeline` does; `check:pipeline` runs this file.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type { GenJob, GovLevel } from '@dv/shared';
import { jobKey, sha256Hex } from '@dv/shared';
import {
  MemoryRecorder,
  MockFalPort,
  MockSignPort,
  MockTranscodePort,
  NAMES_REAL_KEY,
  PROMPT_LINT_CONFIG,
  GENAI_REGISTRY,
  blobNamePort,
  r2Blob,
  runCutsceneJob,
  type FalPort,
  type GenPorts,
  type StepConfig,
  type StepLike,
} from '../src/core.ts';
import { buildCutsceneJob } from '../../edge/src/cutscenes/job.ts';

const KEY = 'd'.repeat(64);
const REAL = 'Zaphod Quillfeather';
const CLAUSE = 'No text, no logos.';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ MEDIA: R2Bucket; PRIVATE: R2Bucket }>>>;
beforeAll(async () => {
  process.env['WRANGLER_LOG'] ??= 'error';
  const configPath = path.resolve(import.meta.dirname, '../../edge/wrangler.jsonc');
  // remoteBindings: false: the remote-only Workers AI binding must not start a remote proxy session (BD-FIX-CI4-E01).
  proxy = await getPlatformProxy({ configPath, environment: 'staging', persist: false, remoteBindings: false });
});
afterAll(async () => {
  await proxy.dispose();
});

const putNames = (): Promise<unknown> =>
  proxy.env.PRIVATE.put(NAMES_REAL_KEY, JSON.stringify({ schema: 'names/1', entries: [{ id: 'x', real: REAL, aliases: ['Zed Quill'] }] }));

function withPrompt(prompt: string): GenJob {
  const base = buildCutsceneJob(KEY, { FAL_MODE: 'mock', ENVIRONMENT: 'dev' }, 'test');
  const params = { ...base.params, prompt, shots: [{ shotId: 's1', durationS: 2, prompt }] };
  const promptSha256 = sha256Hex(prompt);
  return { ...base, params, promptSha256, jobKey: jobKey({ kind: 'cutscene_shot', endpointId: 'x', pinnedUpdatedAt: null, params, inputSha256: [], promptTemplate: 'mock@1', promptSha256, recipe: 'cut@1' }) };
}

/** Counts every call that reaches the mock executor. */
function countingFal(): { fal: FalPort; calls: () => number } {
  const inner = new MockFalPort({ recorder: new MemoryRecorder(), deliver: () => Promise.resolve(), now: Date.now });
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
      keyframe: wrap(inner.keyframe.bind(inner)),
    },
  };
}

const shim: StepLike = {
  async do<T>(_n: string, a: StepConfig | (() => Promise<T>), b?: () => Promise<T>): Promise<T> {
    return (typeof a === 'function' ? a : b!)();
  },
  waitForEvent: () => Promise.reject(new Error('the gate refuses before any wait')),
};

function setup(log: string[]): { ports: GenPorts; calls: () => number; ctx: Parameters<typeof runCutsceneJob>[1] } {
  const blob = r2Blob({ MEDIA: proxy.env.MEDIA, PRIVATE: proxy.env.PRIVATE });
  const { fal, calls } = countingFal();
  const ports: GenPorts = {
    fal,
    blob,
    roster: { lookup: () => Promise.resolve(null) },
    budget: { reserve: () => Promise.resolve({ ok: true, level: 0 as GovLevel }), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as GovLevel) },
    flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
    clock: { now: Date.now },
    transcode: new MockTranscodePort(),
    sign: new MockSignPort(),
    falGate: { acquire: () => Promise.resolve(true), release: () => Promise.resolve() },
    sink: { complete: () => Promise.resolve(), fail: () => Promise.resolve() },
    names: blobNamePort(blob),
  };
  const ctx = {
    ports,
    gate: { falMode: 'mock' as const, environment: 'dev', registry: GENAI_REGISTRY, lint: PROMPT_LINT_CONFIG, log: (l: string) => void log.push(l) },
    instanceId: 'cutscene_shot-test-1',
    hostApi: 'https://api.test',
    mock: true,
  };
  return { ports, calls, ctx };
}

describe('gate prompt lint over the PRIVATE names object (AC-11)', () => {
  it('refuses a real name, refuses banned vocabulary with rule 2, passes a clean prompt, and degrades to the public lists without the object', async () => {
    await putNames();
    const log: string[] = [];
    const { calls, ctx, ports } = setup(log);

    // 1. a name from the PRIVATE object (any case, with a different separator)
    const named = await runCutsceneJob(shim, ctx, withPrompt(`A plaza at dusk. ${REAL.toLowerCase().replace(' ', '-')} waves. ${CLAUSE}`));
    expect(named.status).toBe('refused');
    expect(named.code).toBe('NAME_IN_PROMPT');
    expect(named.detail).toContain('rule 1');
    expect(JSON.stringify(named)).not.toMatch(/quillfeather/i);

    // 2. banned vocabulary
    const bad = await runCutsceneJob(shim, ctx, withPrompt(`A plaza at dusk. A pistol on a bench. ${CLAUSE}`));
    expect(bad.status).toBe('refused');
    expect(bad.code).toBe('POLICY_REFUSED');
    expect(bad.detail).toContain('rule 2');

    // zero FalPort calls for both
    expect(calls()).toBe(0);
    expect(log).toEqual([]);

    // 3. a clean prompt passes the gate (the gate stage alone: the rest of the job is check:pipeline's)
    const { assertStageAllowed } = await import('../src/core.ts');
    expect(await assertStageAllowed(withPrompt(`A plaza at dusk, soft light. ${CLAUSE}`), 'gate', ports, ctx.gate)).toEqual({ ok: true });

    // 4. the object removed: SKIP is logged, the real name is no longer known, the public denylist still applies
    await proxy.env.PRIVATE.delete(NAMES_REAL_KEY);
    const first = await assertStageAllowed(withPrompt(`A plaza at dusk. ${REAL}. ${CLAUSE}`), 'gate', ports, ctx.gate);
    expect(first).toEqual({ ok: true });
    expect(log.some((l) => l.startsWith('SKIP') && l.includes('names-real.json'))).toBe(true);
    const term = (PROMPT_LINT_CONFIG.denylist.terms[0] ?? 'x').toUpperCase();
    const denied = await assertStageAllowed(withPrompt(`A plaza at dusk. ${term}. ${CLAUSE}`), 'gate', ports, ctx.gate);
    expect(denied).toMatchObject({ ok: false, code: 'NAME_IN_PROMPT' });
    expect(calls()).toBe(0);
  });

  it('maps the other rules to the existing GateCodes and keeps the empty-prompt refusal', async () => {
    const log: string[] = [];
    const { ports, ctx } = setup(log);
    const { assertStageAllowed } = await import('../src/core.ts');
    const gate = (p: string) => assertStageAllowed(withPrompt(p), 'gate', ports, ctx.gate);
    expect(await gate('A plaza at dusk.')).toMatchObject({ code: 'POLICY_REFUSED', detail: expect.stringContaining('rule 5') });
    expect(await gate(`${'a calm street. '.repeat(100)}${CLAUSE}`)).toMatchObject({ code: 'POLICY_REFUSED', detail: expect.stringContaining('rule 4') });
    expect(await gate('   ')).toMatchObject({ code: 'POLICY_REFUSED', detail: 'empty prompt' });
    // rule 3 needs a non-consented cast member the roster knows
    const cast = { ...withPrompt(`A plaza. Photorealistic. ${CLAUSE}`) };
    cast.params = { ...cast.params, characters: [{ id: 'npc_test' }] };
    const withRoster = { ...ports, roster: { lookup: () => Promise.resolve({ id: 'npc_test', tier: 'fictionalized' as const, soulVersion: 1, killed: [] }) } };
    expect(await assertStageAllowed(cast, 'gate', withRoster, ctx.gate)).toMatchObject({ code: 'PHOTOREAL_FORBIDDEN' });
  });
});
