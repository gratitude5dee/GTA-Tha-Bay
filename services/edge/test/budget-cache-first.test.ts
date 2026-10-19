import { env, introspectWorkflow } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { CutsceneStatus, GovLevel } from '@dv/shared';
import { bindings, getStatus, keyOf, mockCalls, prewarm, seedManifest } from './cutscene-helpers.ts';

interface GovRpc {
  forceLevel(l: GovLevel, by: string, reason: string): Promise<void>;
}

const governor = (): GovRpc => env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${bindings().ENVIRONMENT}`)) as unknown as GovRpc;

afterEach(async () => {
  await governor().forceLevel(0, 'test', 'reset');
  await env.FLAGS.delete('ks:cutscene_gen');
  await env.FLAGS.delete('ks:genai:all');
});

describe('cache hits are served under a kill switch or governor level 3 (AC-3)', () => {
  async function check(reasonWanted: 'budget' | 'kill_switched'): Promise<void> {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const cached = keyOf(`cached-${reasonWanted}`);
    const uncached = keyOf(`uncached-${reasonWanted}`);
    const catalog = [cached, uncached];
    await seedManifest(cached);

    expect((await getStatus(cached, catalog)).state).toBe('ready');
    const un = await getStatus(uncached, catalog);
    expect(un).toMatchObject({ state: 'absent', reason: reasonWanted });

    // a prewarm is held back the same way; the cached key stays ready
    const res = await prewarm([cached, uncached], catalog);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { keys: CutsceneStatus[] };
    expect(body.keys.find((k) => k.key === cached)?.state).toBe('ready');
    expect(body.keys.find((k) => k.key === uncached)).toMatchObject({ state: 'absent', reason: reasonWanted });

    expect(await mockCalls('submit', cached)).toBe(0);
    expect(await mockCalls('submit', uncached)).toBe(0);
    expect(await introspector.get()).toHaveLength(0);
  }

  it('governor level 3: cached ready, uncached absent with reason budget, 0 submits', async () => {
    await governor().forceLevel(3, 'test', 'budget drill');
    await check('budget');
  });

  it('ks:cutscene_gen set: cached ready, uncached absent with reason kill_switched, 0 submits', async () => {
    await env.FLAGS.put('ks:cutscene_gen', JSON.stringify({ on: true, reason: 'drill', by: 'test', ts: Date.now(), expiresAt: null }));
    await check('kill_switched');
  });

  it('ks:genai:all set behaves the same', async () => {
    await env.FLAGS.put('ks:genai:all', JSON.stringify({ on: true, reason: 'drill', by: 'test', ts: Date.now(), expiresAt: null }));
    await check('kill_switched');
  });

  it('an expired or off kill record does not block', async () => {
    await env.FLAGS.put('ks:cutscene_gen', JSON.stringify({ on: false }));
    await env.FLAGS.put('ks:genai:all', JSON.stringify({ on: true, expiresAt: Date.now() - 1000 }));
    const key = keyOf('not-blocked');
    expect((await getStatus(key)).reason).toBeUndefined();
  });
});
