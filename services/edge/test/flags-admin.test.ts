import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFlagName, type KsRecord } from '../src/flags/admin.ts';
import { harness, type Harness } from './npc-helpers.ts';

// AC-7: route 47 needs the ops token, validates the flag name, writes KV and audit_log.
let h: Harness;
const touched = new Set<string>();
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  h.dispose();
  for (const k of touched) await env.FLAGS.delete(k);
  touched.clear();
});

const put = (name: string, body: unknown, extra: { ops?: boolean; bearer?: string } = {}) => {
  touched.add(name.startsWith('feature:') ? 'flags:features' : decodeURIComponent(name));
  return h.api(`/api/v1/admin/flags/${name}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...extra });
};

describe('PUT /api/v1/admin/flags/:flag (route 47)', () => {
  it('is 401 without the ops token and 400 for an unknown flag name or a bad body', async () => {
    expect((await put('ks:anthropic', { on: true })).status).toBe(401);
    expect((await put('ks:anthropic', { on: true }, { bearer: 'Bearer nope' })).status).toBe(401);
    expect((await put('ks:no-such-switch', { on: true }, { ops: true })).status).toBe(400);
    expect((await put('whatever', { on: true }, { ops: true })).status).toBe(400);
    expect((await put('feature:not.a.flag', { on: true }, { ops: true })).status).toBe(400);
    expect((await put('ks:anthropic', { on: 'yes' }, { ops: true })).status).toBe(400);
    expect((await put('ks:anthropic', {}, { ops: true })).status).toBe(400);
    expect((await put('ks:anthropic', { on: true, reason: 'x'.repeat(201) }, { ops: true })).status).toBe(400);
    expect((await put('ks:anthropic', { on: true, expiresAt: -5 }, { ops: true })).status).toBe(400);
    expect(await env.FLAGS.get('ks:anthropic')).toBeNull();
    expect(h.port.auditRows()).toHaveLength(0);
  });

  it('a valid ks:anthropic write lands in KV and in audit_log', async () => {
    const res = await put('ks:anthropic', { on: true, reason: 'vendor outage', expiresAt: h.clock.t + 3_600_000 }, { ops: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flag: 'ks:anthropic', on: true, ts: h.clock.t });
    const rec = (await env.FLAGS.get('ks:anthropic', { type: 'json' })) as KsRecord;
    expect(rec).toEqual({ on: true, reason: 'vendor outage', by: 'ops-token', ts: h.clock.t, expiresAt: h.clock.t + 3_600_000 });
    const rows = h.port.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'ops-token', role: 'ops', action: 'flag.set', targetKind: 'flag', targetId: 'ks:anthropic', details: { on: true, reason: 'vendor outage' } });
  });

  it('turning a switch off writes {on:false}, which the genAI paths read as not in force', async () => {
    await put('ks:tts:all', { on: true }, { ops: true });
    await put('ks:tts:all', { on: false, reason: 'resolved' }, { ops: true });
    expect(((await env.FLAGS.get('ks:tts:all', { type: 'json' })) as KsRecord).on).toBe(false);
    expect(h.port.auditRows().map((r) => r.details?.['on'])).toEqual([true, false]);
  });

  it('accepts the names of 09-backend-db.md section 5, percent-encoded where they hold a slash', async () => {
    for (const name of ['ks:genai:all', 'ks:anthropic:sonnet', 'ks:fal', 'ks:cutscene_gen', 'ks:npc_builder', 'ks:tts:elevenlabs', 'ks:telemetry:verbose', 'ks:rooms:new', 'ks:likeness:npc_test']) {
      expect((await put(name, { on: true }, { ops: true })).status, name).toBe(200);
    }
    expect((await put(encodeURIComponent('ks:fal:minimax/h3/image-to-video'), { on: true }, { ops: true })).status).toBe(200);
    expect(await env.FLAGS.get('ks:fal:minimax/h3/image-to-video')).not.toBeNull();
    expect(parseFlagName('ks:fal:')).toBeNull();
    expect(parseFlagName('ks:likeness:X')).toBeNull();
  });

  it('feature flags merge into flags:features', async () => {
    expect((await put('feature:npc.dialogue', { on: true }, { ops: true })).status).toBe(200);
    expect((await put('feature:npc.voice', { on: true }, { ops: true })).status).toBe(200);
    expect((await put('feature:npc.dialogue', { on: false }, { ops: true })).status).toBe(200);
    expect(await env.FLAGS.get('flags:features', { type: 'json' })).toEqual({ 'npc.dialogue': false, 'npc.voice': true });
  });

  it('answers 503 and writes nothing when no audit database is configured', async () => {
    const { createApp } = await import('../src/index.ts');
    const { call } = await import('./helpers.ts');
    const app = createApp({ data: () => null, now: () => h.clock.t });
    touched.add('ks:anthropic');
    const res = await call('/api/v1/admin/flags/ks:anthropic', { method: 'PUT', app, country: 'US', headers: { Authorization: 'Bearer ops-test-token' }, body: JSON.stringify({ on: true }), env: { OPS_TOKEN: 'ops-test-token' } });
    expect(res.status).toBe(503);
    expect(await env.FLAGS.get('ks:anthropic')).toBeNull();
  });

  it('is not geo gated (staff may be anywhere); a player route is', async () => {
    expect((await h.api('/api/v1/admin/flags/ks:anthropic', { method: 'PUT', ops: true, country: 'DE', body: JSON.stringify({ on: true }) })).status).toBe(200);
    touched.add('ks:anthropic');
    expect((await h.api('/api/v1/roster', { country: 'DE' })).status).toBe(451);
  });
});
