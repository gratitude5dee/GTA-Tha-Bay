import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_FOR } from '@dv/shared';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-5: images and submit answer tier_required for a P0 token. Also the flag and kill switch (feature_disabled), assets and the community list.
let b: Builder;
afterEach(() => b.dispose());

const err = async (res: Response): Promise<{ status: number; code: string }> => ({ status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code });

describe('builder phases and switches', () => {
  it('answers tier_required to a P0 token on images and submit', async () => {
    b = await builderSetup();
    const d = await b.create();
    for (const path of [`/drafts/${d.id}/submit`, `/drafts/${d.id}/images`]) {
      const res = await b.api('POST', path, path.endsWith('images') ? { uploadIds: [] } : {});
      expect(await err(res)).toEqual({ status: HTTP_FOR.tier_required, code: 'tier_required' });
    }
    // the phase is answered before any lookup: a draft that does not exist gets the same answer
    expect((await err(await b.api('POST', '/drafts/0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000/submit', {}))).code).toBe('tier_required');
    expect((await b.get(d.id)).state).toBe('draft'); // nothing moved
  });

  it('keeps assets and the community list closed', async () => {
    b = await builderSetup();
    const d = await b.create();
    expect((await err(await b.api('POST', `/drafts/${d.id}/assets`, {}))).code).toBe('feature_disabled');
    expect((await err(await b.api('GET', '/community'))).code).toBe('feature_disabled');
  });

  it('needs a play token', async () => {
    b = await builderSetup();
    const res = await b.t.h.api('/api/v1/npc-builder/drafts', { method: 'GET' });
    expect((await err(res)).code).toBe('unauthorized');
  });

  it('answers feature_disabled when the flag is off or the kill switch is on', async () => {
    b = await builderSetup({ env: { FLAGS_JSON: JSON.stringify({ 'npc.dialogue': true, 'npc.builder': false }) } });
    expect(await err(await b.api('GET', '/drafts'))).toEqual({ status: HTTP_FOR.feature_disabled, code: 'feature_disabled' });
    b.dispose();
    b = await builderSetup();
    expect((await b.api('GET', '/drafts')).status).toBe(200);
    const { env } = await import('cloudflare:test');
    await env.FLAGS.put('ks:npc_builder', JSON.stringify({ on: true, reason: 'test', by: 'test', ts: 1, expiresAt: null }));
    try {
      expect((await err(await b.api('GET', '/drafts'))).code).toBe('feature_disabled');
    } finally {
      await env.FLAGS.delete('ks:npc_builder');
    }
  });

  it('rejects bad input with bad_request and unknown methods with 405', async () => {
    b = await builderSetup();
    expect((await err(await b.api('POST', '/drafts', { fields: { name: 'x' }, attestation: 'original' }))).code).toBe('bad_request');
    expect((await err(await b.api('POST', '/drafts', { fields: { name: 'Fine Name', shortBio: 'ok', archetype: 'vendor', tags: [], district: 'atlantis', voiceRef: null, appearancePreset: null }, attestation: 'original' }))).code).toBe('bad_request');
    expect((await err(await b.api('POST', '/drafts', { fields: { name: 'Fine Name', shortBio: 'ok', archetype: 'vendor', tags: [], district: 'mission', voiceRef: null, appearancePreset: null }, attestation: 'self' }))).code).toBe('bad_request');
    expect((await b.api('PATCH', '/drafts')).status).toBe(405);
    expect((await err(await b.api('POST', '/drafts', { fields: { name: 'Fine Name', shortBio: 'ok', archetype: 'vendor', tags: [], district: 'mission', voiceRef: 'voice/not-a-voice', appearancePreset: null }, attestation: 'original' }))).code).toBe('bad_request');
  });
});
