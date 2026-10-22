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
    if (job.skipped === 'no_database') {
      // Secret absent: stub, say so, pass. The Worker has no SUPABASE_SECRET_KEY, so no database exists to keep awake (M05d, Blocked on).
      console.log('SKIP keepalive: SUPABASE_SECRET_KEY not set on the staging Worker');
      return;
    }
    expect(job, `keepalive did not run (${job.skipped ?? 'no reason'})`).toMatchObject({ ran: true });
  });
});
