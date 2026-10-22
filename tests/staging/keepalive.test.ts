import { describe, expect, it } from 'vitest';

// Nightly (nightly.yml): one select on the staging database through the Worker, so the Free project never pauses (7 days idle).
// The Worker runs the keep-alive job at POST /api/v1/_test/run-scheduled?job=keepalive, a route that exists in staging and previews only.
const base = process.env['DV_STAGING_URL'] ?? 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';

describe('staging keep-alive', () => {
  it('the Worker reaches the database and the select returns', async () => {
    const res = await fetch(new URL('/api/v1/_test/run-scheduled?job=keepalive', base), { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ran: { job: string; ran: boolean; skipped?: string }[] };
    expect(body.ran).toHaveLength(1);
    const job = body.ran[0]!;
    expect(job.job).toBe('keepalive');
    // ran:false with skipped:no_database means the Worker has no SUPABASE_SECRET_KEY: the keep-alive proves nothing, so it fails.
    expect(job, `keepalive did not run (${job.skipped ?? 'no reason'})`).toMatchObject({ ran: true });
  });
});
