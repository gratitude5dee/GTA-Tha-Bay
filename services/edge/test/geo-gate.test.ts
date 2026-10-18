import { describe, expect, it } from 'vitest';
import { aeStub, batch, call, event, post } from './helpers.ts';

const okBatch = batch([event('storage.persist', { granted: true })]);

describe('geo gate (A-10)', () => {
  it('country FR: boot answers with region blocked, legal is not 451, /t is 451 region_blocked', async () => {
    const boot = await call('/api/v1/boot', { country: 'FR' });
    expect(boot.status).toBe(200);
    expect(((await boot.json()) as { region: string }).region).toBe('blocked');

    const legal = await call('/api/v1/legal/dmca', { country: 'FR' });
    expect(legal.status).not.toBe(451);
    expect(legal.status).toBe(404);
    expect(((await legal.json()) as { error: { code: string } }).error.code).toBe('feature_disabled');

    const t = await post(okBatch, { country: 'FR' });
    expect(t.status).toBe(451);
    const err = (await t.json()) as { error: { code: string; requestId: string } };
    expect(err.error.code).toBe('region_blocked');
    expect(err.error.requestId).toBe(t.headers.get('X-Request-Id'));
  });

  it('health is never gated', async () => {
    expect((await call('/api/v1/health', { country: 'FR' })).status).toBe(200);
  });

  it('country US: /t accepts a valid batch and boot is ok', async () => {
    const ae = aeStub();
    const t = await call('/api/v1/t', {
      method: 'POST',
      country: 'US',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(okBatch),
      env: { AE: ae.dataset },
    });
    expect(t.status).toBe(204);
    expect(ae.points).toHaveLength(1);
    const boot = await call('/api/v1/boot', { country: 'US' });
    expect(((await boot.json()) as { region: string }).region).toBe('ok');
  });

  it('a missing cf.country (local dev) counts as allowed', async () => {
    expect((await post(okBatch)).status).toBe(204);
  });

  it('the test route reports the country and is not gated', async () => {
    const res = await call('/api/v1/_test/echo-country', { country: 'FR' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { country: string }).country).toBe('FR');
  });
});
