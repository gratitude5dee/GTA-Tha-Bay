import { env, introspectWorkflow } from 'cloudflare:test';
import type { BootConfig } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';
import { keyOf, mockCalls, OPS, seedManifest } from './cutscene-helpers.ts';
import { downPort } from './data-helpers.ts';

// 09-backend.md section 5.3, "Supabase down": the single-player paths do not need the database.
const app = createApp({ data: () => downPort() });
const LIVE: Partial<Env> = { OPS_TOKEN: OPS };

describe('Supabase down (AC-8)', () => {
  it('/boot is 200', async () => {
    const res = await call('/api/v1/boot', { country: 'US', app });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BootConfig).region).toBe('ok');
  });

  it('route 27 answers ready for a key whose manifest exists, absent for an unknown key, and starts nothing', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const stored = keyOf('down-stored');
    const unknown = keyOf('down-unknown');
    await seedManifest(stored);

    const ready = (await (await call(`/api/v1/cutscenes/${stored}`, { app, env: LIVE })).json()) as { key: string; state: string; manifestUrl?: string };
    expect(ready.state).toBe('ready');
    expect(ready.manifestUrl).toMatch(new RegExp(`/cutscenes/${stored}/manifest\\.json$`));

    const absent = await call(`/api/v1/cutscenes/${unknown}`, { app, env: LIVE });
    expect(absent.status).toBe(200);
    expect(await absent.json()).toEqual({ key: unknown, state: 'absent' });

    // Zero ensure() calls: no workflow instance, no mock executor call.
    expect(await introspector.get()).toHaveLength(0);
    expect(await mockCalls('submit', unknown)).toBe(0);
    expect(await mockCalls('submit', stored)).toBe(0);
  });

  it('the staff prewarm does not generate while the catalog cannot be read', async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('down-prewarm');
    const res = await call('/api/v1/admin/cutscenes/prewarm', {
      method: 'POST',
      app,
      env: LIVE,
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [key] }),
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { keys: { state: string }[] }).keys[0]?.state).toBe('absent');
    expect(await introspector.get()).toHaveLength(0);
    expect(await mockCalls('submit', key)).toBe(0);
  });

  it('a scheduled job that hits the dead database is reported, not thrown', async () => {
    const res = await call('/api/v1/_test/run-scheduled', { method: 'POST', app });
    expect(res.status).toBe(200);
    const ran = ((await res.json()) as { ran: { job: string; ran: boolean; skipped?: string }[] }).ran;
    expect(ran.map((r) => r.job)).toEqual(['catalog-sync', 'ledger-export']);
    // catalog-sync writes, so it fails; ledger-export finds nothing to export in a fresh governor, so it never touches the database.
    expect(ran[0]).toMatchObject({ job: 'catalog-sync', ran: false });
    expect(ran[0]?.skipped).toMatch(/^failed:/);
  });

  it('the keep-alive job fails visibly (so the nightly run goes red) when the database is down', async () => {
    const res = await call('/api/v1/_test/run-scheduled?job=keepalive', { method: 'POST', app });
    const ran = ((await res.json()) as { ran: { ran: boolean; skipped?: string }[] }).ran;
    expect(ran[0]?.ran).toBe(false);
    expect(ran[0]?.skipped).toMatch(/^failed:/);
  });
});
