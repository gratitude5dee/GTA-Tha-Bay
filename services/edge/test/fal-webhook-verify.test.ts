import { env, introspectWorkflow } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { FAL_WEBHOOK_HEADERS, handleFalWebhook, mockJwks, mockKeyPair, webhookMessage, type JobOutcome, type WebhookDeps } from '@dv/pipeline/core';
import { call } from './helpers.ts';
import { keyOf, prewarm, waitForState } from './cutscene-helpers.ts';

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

async function signed(wf: string, opts: { tsOffsetS?: number; tamper?: boolean } = {}): Promise<{ url: string; init: RequestInit }> {
  const bodyText = JSON.stringify({ request_id: 'req-1', gateway_request_id: 'req-1', status: 'OK', payload: {} });
  const body = enc.encode(bodyText);
  const timestamp = String(Math.floor(Date.now() / 1000) + (opts.tsOffsetS ?? 0));
  const message = await webhookMessage({ requestId: 'req-1', userId: 'user-1', timestamp }, body.buffer as ArrayBuffer);
  const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, (await mockKeyPair()).privateKey, message));
  return {
    url: `/api/v1/hooks/fal?wf=${wf}`,
    init: {
      method: 'POST',
      body: opts.tamper === true ? enc.encode(bodyText.replace('OK', 'ERROR')) : body,
      headers: {
        [FAL_WEBHOOK_HEADERS.requestId]: 'req-1',
        [FAL_WEBHOOK_HEADERS.userId]: 'user-1',
        [FAL_WEBHOOK_HEADERS.timestamp]: timestamp,
        [FAL_WEBHOOK_HEADERS.signature]: signature,
      },
    },
  };
}

afterEach(async () => {
  await env.FLAGS.delete('mock:fal:drop-webhook');
});

describe('fal webhook verification (AC-6)', () => {
  function fakeDeps(events: unknown[]): WebhookDeps {
    return {
      jwks: { get: () => mockJwks() },
      now: Date.now,
      getInstance: () => Promise.resolve({ sendEvent: (e) => void events.push(e) as unknown as Promise<void> }),
    };
  }
  const toRequest = ({ url, init }: { url: string; init: RequestInit }): Request => new Request(`https://example.test${url}`, init);

  it('accepts a body signed with the test key and wakes its instance once', async () => {
    const events: unknown[] = [];
    const r = await handleFalWebhook(toRequest(await signed('wf-1')), fakeDeps(events));
    expect(r).toMatchObject({ status: 200, delivered: true });
    expect(events).toEqual([{ type: 'fal-done', payload: { request_id: 'req-1', status: 'OK' } }]);
  });

  it('rejects 301 s of clock skew in both directions, a tampered body, missing headers and a foreign key', async () => {
    const events: unknown[] = [];
    for (const off of [301, -301]) expect((await handleFalWebhook(toRequest(await signed('wf-1', { tsOffsetS: off })), fakeDeps(events))).status).toBe(401);
    expect((await handleFalWebhook(toRequest(await signed('wf-1', { tamper: true })), fakeDeps(events))).status).toBe(401);
    expect((await handleFalWebhook(new Request('https://example.test/api/v1/hooks/fal?wf=wf-1', { method: 'POST', body: '{}' }), fakeDeps(events))).status).toBe(401);
    const foreign = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const x = ((await crypto.subtle.exportKey('jwk', (foreign as CryptoKeyPair).publicKey)) as { x: string }).x;
    const deps = { ...fakeDeps(events), jwks: { get: () => Promise.resolve({ keys: [{ kty: 'OKP', crv: 'Ed25519', x }] }) } };
    expect((await handleFalWebhook(toRequest(await signed('wf-1')), deps)).status).toBe(401);
    expect(events).toHaveLength(0);
  });

  it('accepts a 300 s skew and a JWKS key whose x carries "=" padding', async () => {
    const events: unknown[] = [];
    const { jwks } = await mockKeyPair();
    const padded = { keys: [{ ...jwks.keys[0]!, x: `${jwks.keys[0]!.x}=` }] };
    const deps: WebhookDeps = { ...fakeDeps(events), jwks: { get: () => Promise.resolve(padded) } };
    expect((await handleFalWebhook(toRequest(await signed('wf-1', { tsOffsetS: -299 })), deps)).status).toBe(200);
  });

  it('serves the test key at the non-production JWKS route', async () => {
    const res = await call('/api/v1/_test/fal-jwks');
    expect(await res.json()).toEqual(await mockJwks());
  });

  it('route 29: bad deliveries are 401 and wake nothing; the good one wakes the waiting Workflow', { timeout: 60_000 }, async () => {
    await env.FLAGS.put('mock:fal:drop-webhook', '1'); // the mock executor posts no webhook of its own
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('webhook-route');
    expect((await prewarm([key])).status).toBe(202);
    const [instance] = await introspector.get();
    await instance!.waitForStepResult({ name: 'submit' });
    const id = ((await (env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as { inspect(): Promise<{ instanceId: string }> }).inspect()).instanceId);

    for (const bad of [await signed(id, { tsOffsetS: 301 }), await signed(id, { tamper: true })]) {
      const res = await call(bad.url, bad.init);
      expect(res.status).toBe(401);
    }
    await new Promise((r) => setTimeout(r, 300));
    expect((await (await env.GEN_WF.get(id)).status()).status).not.toBe('complete'); // still waiting: nothing was woken

    const good = await signed(id);
    const res = await call(good.url, good.init);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    await instance!.waitForStatus('complete');
    expect(((await instance!.getOutput()) as JobOutcome).webhook).toBe('event');
    await waitForState(key, 'ready');
  });

  it('route 29 answers 2xx for an unknown instance so that fal stops retrying', async () => {
    const good = await signed('cutscene_shot-000000000000-1');
    const res = await call(good.url, { ...good.init, country: 'DE' }); // vendor-signed routes are geo-exempt
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: false });
  });
});
