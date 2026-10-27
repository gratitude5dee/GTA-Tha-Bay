import { describe, expect, it } from 'vitest';
import { DISPATCH_CRON, DISPATCH_INTERVAL_MS, JOBS, SCHEDULE, dueJobs, slotOf, type JobName } from '../src/ops/scheduled.ts';
import { call } from './helpers.ts';

// BD-FIX-CRON-01: one dispatcher Cron Trigger per Worker (Workers Free: 5 per account) runs the SCHEDULE row of its tick's UTC minute.
const MIN = 60_000;
const DAY = 86_400_000;
const DAY0 = Date.UTC(2026, 9, 27); // a UTC midnight
const TIMES: Readonly<Record<string, number>> = { '03:10': 190, '03:20': 200, '03:30': 210, '03:40': 220 }; // minutes after midnight

/** Every tick of `*\/5 * * * *` over `days` days from DAY0, with the jobs each one runs. */
function ticks(days: number, step = DISPATCH_INTERVAL_MS): { t: number; jobs: readonly JobName[] }[] {
  const out: { t: number; jobs: readonly JobName[] }[] = [];
  for (let t = DAY0; t < DAY0 + days * DAY; t += step) out.push({ t, jobs: dueJobs(t) });
  return out;
}

describe('the cron dispatcher', () => {
  it('is one five-minute expression, and every table time is a real job on its grid', () => {
    expect(DISPATCH_CRON).toBe('*/5 * * * *');
    expect(DISPATCH_INTERVAL_MS).toBe(5 * MIN);
    expect(Object.keys(SCHEDULE).sort()).toEqual(Object.keys(TIMES).sort());
    for (const [hhmm, jobs] of Object.entries(SCHEDULE)) {
      expect(hhmm).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
      expect(((TIMES[hhmm] ?? -1) * MIN) % DISPATCH_INTERVAL_MS).toBe(0);
      for (const j of jobs) expect(Object.hasOwn(JOBS, j)).toBe(true);
    }
  });

  it('runs each job exactly at its UTC time, once a day, over a week of ticks', () => {
    const all = ticks(7);
    expect(all).toHaveLength(7 * 288);
    const runs = new Map<JobName, number[]>();
    for (const { t, jobs } of all) for (const j of jobs) runs.set(j, [...(runs.get(j) ?? []), t]);
    const expected: Record<string, string> = {
      'catalog-sync': '03:10',
      'ledger-export': '03:10',
      transcripts: '03:10',
      memory: '03:20',
      'stub-profiles': '03:30',
      'builder-drafts': '03:40',
    };
    expect([...runs.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [job, hhmm] of Object.entries(expected)) {
      const at = runs.get(job as JobName) ?? [];
      expect(at).toEqual(Array.from({ length: 7 }, (_, d) => DAY0 + d * DAY + (TIMES[hhmm] ?? 0) * MIN));
    }
    // keepalive is run by the nightly CI call only, never by the cron.
    expect(runs.has('keepalive')).toBe(false);
  });

  it('runs the 03:10 jobs in their order: catalog-sync, ledger-export, transcripts', () => {
    expect(dueJobs(DAY0 + 190 * MIN)).toEqual(['catalog-sync', 'ledger-export', 'transcripts']);
  });

  it('never runs a job twice in a day, even if a denser expression ticked every minute', () => {
    const perDay = new Map<string, number>();
    for (const { jobs } of ticks(2, MIN)) for (const j of jobs) perDay.set(j, (perDay.get(j) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBe(2);
  });

  it('runs nothing at other times: the neighbouring minutes, other hours, a start a few seconds late stays in its minute', () => {
    for (const m of [0, 5, 9, 11, 15, 25, 35, 45, 50, 55]) expect(dueJobs(DAY0 + (180 + m) * MIN)).toEqual([]);
    for (const h of [0, 2, 4, 15, 23]) expect(dueJobs(DAY0 + (h * 60 + 10) * MIN)).toEqual([]);
    expect(dueJobs(DAY0 + 190 * MIN + 59_999)).toEqual(SCHEDULE['03:10']);
    expect(dueJobs(DAY0 + 191 * MIN)).toEqual([]);
  });

  it('reads the UTC minute of the scheduled time, and nothing from a missing time', () => {
    expect(slotOf(DAY0 + 190 * MIN)).toBe('03:10');
    expect(slotOf(DAY0 - MIN)).toBe('23:59');
    expect(slotOf(Date.UTC(2031, 0, 1, 3, 40, 0))).toBe('03:40');
    expect(slotOf(Number.NaN)).toBeNull();
    expect(dueJobs(undefined as unknown as number)).toEqual([]);
  });
});

describe('POST /api/v1/_test/run-scheduled?at=HH:MM (Previews have no Cron Triggers)', () => {
  type Ran = { slot?: string; ran: { job: string; ran: boolean; skipped?: string }[] };

  it('runs the jobs of that tick, in order', async () => {
    const res = await call('/api/v1/_test/run-scheduled?at=03:10', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Ran;
    expect(body.slot).toBe('03:10');
    expect(body.ran.map((r) => r.job)).toEqual(['catalog-sync', 'ledger-export', 'transcripts']);
    expect(((await (await call('/api/v1/_test/run-scheduled?at=03:40', { method: 'POST' })).json()) as Ran).ran.map((r) => r.job)).toEqual(['builder-drafts']);
  });

  it('runs nothing for a time with no row', async () => {
    const body = (await (await call('/api/v1/_test/run-scheduled?at=03:15', { method: 'POST' })).json()) as Ran;
    expect(body).toEqual({ slot: '03:15', ran: [] });
  });

  it('refuses a malformed time, or a job and a time together', async () => {
    for (const q of ['at=3:10', 'at=24:00', 'at=03:60', 'at=0310', 'at=03:10&job=memory']) {
      expect((await call(`/api/v1/_test/run-scheduled?${q}`, { method: 'POST' })).status).toBe(400);
    }
  });

  it('still takes a job name, and runs catalog-sync and ledger-export with neither', async () => {
    expect(((await (await call('/api/v1/_test/run-scheduled?job=memory', { method: 'POST' })).json()) as Ran).ran.map((r) => r.job)).toEqual(['memory']);
    expect(((await (await call('/api/v1/_test/run-scheduled', { method: 'POST' })).json()) as Ran).ran.map((r) => r.job)).toEqual(['catalog-sync', 'ledger-export']);
  });
});
