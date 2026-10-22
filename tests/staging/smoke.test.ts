import { describe, expect, it } from 'vitest';

// Post-deploy and nightly: the two routes every client calls first answer on the staging host. Neither needs the database.
const base = process.env['DV_STAGING_URL'] ?? 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';

describe('staging smoke', () => {
  it('GET /api/v1/health answers 200 with the isolation headers', async () => {
    const res = await fetch(new URL('/api/v1/health', base));
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('GET /api/v1/boot answers 200 with a BootConfig', async () => {
    const res = await fetch(new URL('/api/v1/boot', base));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { build?: unknown; hosts?: Record<string, unknown>; flags?: unknown };
    expect(typeof body.build).toBe('string');
    expect(Object.keys(body.hosts ?? {}).sort()).toEqual(['api', 'id', 'media', 'rt', 'ugc']);
    expect(body.flags).toBeTypeOf('object');
  });
});
