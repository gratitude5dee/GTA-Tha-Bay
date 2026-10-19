import { env, introspectWorkflow } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call } from './helpers.ts';
import { getStatus, keyOf, mockCalls, seedManifest, withCatalog } from './cutscene-helpers.ts';

interface JobRpc {
  quarantine(scope: string): Promise<void>;
  unquarantine(): Promise<void>;
}

describe('route 27 status (AC-4)', () => {
  it('a key outside the catalog is absent with reason not_in_catalog and starts nothing', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('outside');
    const res = await call(`/api/v1/cutscenes/${key}`, withCatalog([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key, state: 'absent', reason: 'not_in_catalog' });
    expect(await introspector.get()).toHaveLength(0);
    expect(await mockCalls('submit', key)).toBe(0);
  });

  it('a manifest in MEDIA does not make an uncatalogued key ready', async () => {
    const key = keyOf('outside-but-stored');
    await seedManifest(key);
    expect((await getStatus(key, [])).state).toBe('absent');
  });

  it('a key under a kill scope answers blocked, even with a manifest stored, and starts nothing', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('quarantined');
    await seedManifest(key);
    const stub = env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as JobRpc;
    await stub.quarantine('cutscene');
    expect(await getStatus(key)).toEqual({ key, state: 'blocked' });
    expect(await introspector.get()).toHaveLength(0);
    await stub.unquarantine();
    expect((await getStatus(key)).state).toBe('ready');
  });

  it('GET never starts generation: an absent catalog key stays absent', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('get-does-not-generate');
    expect(await getStatus(key)).toEqual({ key, state: 'absent' });
    expect(await introspector.get()).toHaveLength(0);
  });

  it('rejects a malformed key', async () => {
    const res = await call('/api/v1/cutscenes/not-a-key', withCatalog([]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('is geo-gated like other public routes', async () => {
    const res = await call(`/api/v1/cutscenes/${keyOf('geo')}`, { country: 'DE', ...withCatalog([]) });
    expect(res.status).toBe(451);
  });
});
