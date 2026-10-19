import { env, introspectWorkflow } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { CutsceneStatus } from '@dv/shared';
import { buildCutsceneJob } from '../src/cutscenes/job.ts';
import { bindings, getStatus, keyOf, mockCalls, prewarm, seedManifest, waitForState } from './cutscene-helpers.ts';

interface JobRpc {
  ensure(job: ReturnType<typeof buildCutsceneJob>, opts: { allowGenerate: boolean }): Promise<CutsceneStatus>;
  inspect(): Promise<{ attempt: number; instanceId: string | null; state: string }>;
}

describe('cutscene single-flight (AC-1)', () => {
  it('a key whose manifest exists: 10 concurrent GETs and one prewarm are all ready, 0 submits', async () => {
    const key = keyOf('cached');
    await seedManifest(key);
    const gets = Array.from({ length: 10 }, () => getStatus(key));
    const [pre, ...states] = await Promise.all([prewarm([key]), ...gets]);
    expect(pre.status).toBe(202);
    const body = (await pre.json()) as { keys: CutsceneStatus[] };
    expect(body.keys[0]?.state).toBe('ready');
    for (const s of states) {
      expect(s.state).toBe('ready');
      expect(s.manifestUrl).toBe(`${bindings().HOST_MEDIA}/cutscenes/${key}/manifest.json`);
    }
    expect(await mockCalls('submit', key)).toBe(0);
    expect(await mockCalls('submit')).toBe(0);
  });

  it('an absent catalog key: 10 concurrent ensure() calls start exactly 1 Workflow instance and 1 submit', { timeout: 60_000 }, async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('absent');
    const job = buildCutsceneJob(key, bindings(), 'test');
    const stub = env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as JobRpc;

    const results = await Promise.all(Array.from({ length: 10 }, () => stub.ensure(job, { allowGenerate: true })));
    for (const r of results) expect(['pending', 'ready']).toContain(r.state);

    const instances = await introspector.get();
    expect(instances).toHaveLength(1);
    await instances[0]!.waitForStatus('complete');

    const ready = await waitForState(key, 'ready');
    expect(ready.manifestUrl).toContain(`/cutscenes/${key}/manifest.json`);
    expect(await mockCalls('submit', key)).toBe(1);
    expect((await stub.inspect()).attempt).toBe(1);

    // the same key again, prewarmed: ready, no second instance, no second submit
    const again = await prewarm([key]);
    expect(((await again.json()) as { keys: CutsceneStatus[] }).keys[0]?.state).toBe('ready');
    expect(await introspector.get()).toHaveLength(1);
    expect(await mockCalls('submit', key)).toBe(1);
  });
});
