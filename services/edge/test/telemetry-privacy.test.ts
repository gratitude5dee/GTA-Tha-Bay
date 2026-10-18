import { describe, expect, it } from 'vitest';
import { scrub } from '../src/scrub.ts';
import { aeStub, batch, call, event } from './helpers.ts';

const EMAIL = 'player.one@example.com';
const BEARER = 'Bearer eyJhbGciOi.abcdef.ghijkl';
const HEX = 'deadbeef0123456789abcdef0123456789abcdef';
const IP = '203.0.113.77';
const UA = 'TestAgent/9.9 (Privacy)';

describe('telemetry privacy', () => {
  it('drops the unknown name, scrubs PII, and never stores the IP or user agent', async () => {
    const ae = aeStub();
    const events = [
      ...Array.from({ length: 8 }, (_, i) => event('perf.minute', {
        fpsP50: 60 + i, fpsP5: 40, frameP95Ms: 20, drawCalls: 300, tris: 100000, texMBEst: 200, gpuMBEst: 300, memEstMB: 900,
      })),
      event('err.js', { fp: 'abc123', msg: `failed for ${EMAIL} with ${BEARER} and ${HEX} at /x?token=secret`, top: 'app.js:1:2' }),
      event('not.a.real.name', { a: 1 }),
    ];
    const req = {
      method: 'POST',
      country: 'US',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': IP,
        'User-Agent': UA,
        Cookie: 'session=abc',
      },
      body: JSON.stringify(batch(events)),
      env: { AE: ae.dataset },
    };
    const res = await call('/api/v1/t', req);
    expect(res.status).toBe(204);
    expect(res.headers.get('X-DV-Dropped')).toBe('1');
    expect(ae.points).toHaveLength(9);
    for (const p of ae.points) expect(p.indexes).toHaveLength(1);
    expect(ae.points[0]?.indexes?.[0]).toBe('perf.minute');
    expect(ae.points[8]?.indexes?.[0]).toBe('err.js');

    const stored = JSON.stringify(ae.points);
    for (const secret of [EMAIL, 'eyJhbGciOi', HEX, 'token=secret', IP, UA, 'session=abc']) expect(stored).not.toContain(secret);
    expect(stored).toContain('[redacted]');
    // The server adds only the country (empty in this stub environment), never network identifiers.
    expect(ae.points[8]?.blobs?.[5]).toBe('US');
  });

  it('drops events that miss required props, exceed 16 keys, or carry a wrong type', async () => {
    const ae = aeStub();
    const tooMany = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
    const res = await call('/api/v1/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch([
        event('storage.persist', {}),
        event('storage.persist', { granted: 'yes' }),
        event('storage.persist', tooMany),
        event('server.only', {}),
        event('genai.cost', { usdMicros: 1 }),
        event('storage.persist', { granted: false }),
      ])),
      env: { AE: ae.dataset },
    });
    expect(res.status).toBe(204);
    expect(ae.points).toHaveLength(1);
    expect(res.headers.get('X-DV-Dropped')).toBe('5');
  });

  it('still answers 204 when no AE binding exists', async () => {
    const res = await call('/api/v1/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch([event('storage.persist', { granted: true })])),
      env: { AE: undefined },
    });
    expect(res.status).toBe(204);
  });

  it('scrub removes emails, bearer tokens, query strings and long runs, and truncates to 512', () => {
    expect(scrub('mail me at a.b@c.io')).not.toContain('@');
    expect(scrub('Authorization: Bearer abc.def')).not.toContain('abc.def');
    expect(scrub('/path?a=1&b=2')).toBe('/path');
    expect(scrub('0123456789abcdef01234567')).toBe('[redacted]');
    expect(scrub('QUJDREVGR0hJSktMTU5PUFFSU1RVVldY')).toBe('[redacted]');
    expect(scrub('short 0123456789abcdef')).toBe('short 0123456789abcdef');
    expect(scrub('ab '.repeat(1000))).toHaveLength(512);
  });
});
