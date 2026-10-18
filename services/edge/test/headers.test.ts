import { describe, expect, it } from 'vitest';
import { withIsolationHeaders } from '../src/headers.ts';
import { call, isUuidV7, ISOLATION } from './helpers.ts';

describe('isolation headers and request ids', () => {
  it('health: 200 with COOP/COEP/CORP and a UUIDv7 X-Request-Id', async () => {
    const res = await call('/api/v1/health');
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(ISOLATION)) expect(res.headers.get(name)).toBe(value);
    expect(isUuidV7(res.headers.get('X-Request-Id'))).toBe(true);
    const body = (await res.json()) as { ok: boolean; build: string; env: string };
    expect(body.ok).toBe(true);
    expect(typeof body.build).toBe('string');
  });

  it('error responses carry the isolation headers too', async () => {
    const res = await call('/api/v1/nope');
    expect(res.status).toBe(404);
    for (const [name, value] of Object.entries(ISOLATION)) expect(res.headers.get(name)).toBe(value);
  });

  it('every response gets a fresh request id', async () => {
    const a = await call('/api/v1/health');
    const b = await call('/api/v1/health');
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });

  it('paths under /account/ get no COOP or COEP', () => {
    const res = withIsolationHeaders(
      new Response('x', { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }),
      '/account/link',
    );
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBeNull();
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBeNull();
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('other paths get all three', () => {
    const res = withIsolationHeaders(new Response('x'), '/api/v1/health');
    for (const [name, value] of Object.entries(ISOLATION)) expect(res.headers.get(name)).toBe(value);
  });
});
