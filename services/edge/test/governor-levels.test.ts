import { env } from 'cloudflare:test';
import { GENAI_GUARDRAILS, type GovLevel, type SpendEvent, type Vendor } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { assertMicros } from '../src/budget/BudgetGovernorDO.ts';

interface GovRpc {
  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number> }>;
  reserve(v: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }>;
  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void>;
  ingest(batch: SpendEvent[]): Promise<void>;
  forceLevel(l: GovLevel, by: string, reason: string): Promise<void>;
  alarmLog(): Promise<{ threshold: string; spent: number }[]>;
  spentMicros(v: Vendor): Promise<number>;
}

// Each test names its own governor instance so the ledgers stay apart.
const gov = (name: string): GovRpc => env.GOVERNOR.get(env.GOVERNOR.idFromName(`test:${name}`)) as unknown as GovRpc;
const CAP = GENAI_GUARDRAILS.programCapUsdMicros;

describe('BudgetGovernorDO (AC-7)', () => {
  it('holds the 100,000,000-micro program cap from config/guardrails.yaml', () => {
    expect(CAP).toBe(100_000_000);
    expect(GENAI_GUARDRAILS.alarms).toEqual([0.5, 0.8, 1]);
  });

  it('records the 50, 80 and 100 % alarms once each, reaches level 3 at 100 %, refuses the next reservation', async () => {
    const g = gov('levels');
    expect(await g.reserve('fal', 50_000_000, 'job-a')).toEqual({ ok: true, level: 0 });
    expect((await g.alarmLog()).map((a) => a.threshold)).toEqual(['0.5']);
    expect(await g.reserve('fal', 30_000_000, 'job-b')).toEqual({ ok: true, level: 1 }); // 80 %: past the 70 % line
    expect((await g.alarmLog()).map((a) => a.threshold)).toEqual(['0.5', '0.8']);
    expect(await g.reserve('fal', 20_000_000, 'job-c')).toEqual({ ok: true, level: 3 });
    expect((await g.alarmLog()).map((a) => a.threshold)).toEqual(['0.5', '0.8', '1']);
    expect((await g.level()).level).toBe(3);
    expect((await g.level()).byVendor.fal).toBe(100);

    expect(await g.reserve('fal', 1, 'job-d')).toEqual({ ok: false, level: 3 });
    expect(await g.spentMicros('fal')).toBe(CAP); // the refused reservation was not recorded

    // the transition reached KV for the readers that cache it
    // (the singleton of this environment publishes; named test instances share the same namespace)
    const published = JSON.parse((await env.FLAGS.get('gov:level')) ?? 'null') as { level: number } | null;
    expect(published?.level).toBe(3);
  });

  it('crosses level 1 at 70 % and level 2 at 85 %', async () => {
    const g = gov('thresholds');
    expect((await g.reserve('fal', 69_999_999, 'a')).level).toBe(0);
    expect((await g.reserve('fal', 1, 'b')).level).toBe(1);
    expect((await g.reserve('fal', 14_999_999, 'c')).level).toBe(1);
    expect((await g.reserve('fal', 1, 'd')).level).toBe(2);
  });

  it('a repeated settle with the same jobId changes nothing; a repeated reserve does not double count', async () => {
    const g = gov('settle');
    expect(await g.reserve('fal', 10_000_000, 'job-1')).toEqual({ ok: true, level: 0 });
    expect(await g.reserve('fal', 10_000_000, 'job-1')).toEqual({ ok: true, level: 0 });
    expect(await g.spentMicros('fal')).toBe(10_000_000);
    await g.settle('job-1', 4_000_000, 'req-1');
    expect(await g.spentMicros('fal')).toBe(4_000_000);
    await g.settle('job-1', 9_000_000, 'req-2');
    await g.settle('job-1', 0);
    expect(await g.spentMicros('fal')).toBe(4_000_000);
  });

  it('refuses a reservation that would pass the cap and keeps the ledger unchanged', async () => {
    const g = gov('cap');
    expect((await g.reserve('fal', 90_000_000, 'big')).ok).toBe(true);
    expect(await g.reserve('fal', 10_000_001, 'too-much')).toEqual({ ok: false, level: 2 });
    expect(await g.spentMicros('fal')).toBe(90_000_000);
  });

  it('forceLevel raises the level and keeps it until lowered', async () => {
    const g = gov('force');
    await g.forceLevel(3, 'ops:test', 'drill');
    expect(await g.reserve('fal', 1, 'x')).toEqual({ ok: false, level: 3 });
    await g.forceLevel(0, 'ops:test', 'end of drill');
    expect((await g.reserve('fal', 1, 'x')).ok).toBe(true);
  });

  it('ingest takes batches, settles by jobId or requestId, and is idempotent', async () => {
    const g = gov('ingest');
    const batch: SpendEvent[] = [
      { ts: 1, vendor: 'fal', model: 'm', kind: 'cutscene', usdMicros: 5_000_000, settled: true, requestId: 'r1', env: 'test' },
      { ts: 2, vendor: 'anthropic', model: 'haiku', kind: 'turn', usdMicros: 700, settled: true, requestId: 'r2', env: 'test' },
    ];
    await g.ingest(batch);
    await g.ingest(batch);
    expect(await g.spentMicros('fal')).toBe(5_000_000);
    expect(await g.spentMicros('anthropic')).toBe(700);
    // an unsettled estimate is later settled by the same id
    await g.ingest([{ ts: 3, vendor: 'fal', model: 'm', kind: 'cutscene', usdMicros: 2_000_000, settled: false, jobId: 'j9', env: 'test' }]);
    expect(await g.spentMicros('fal')).toBe(7_000_000);
    await g.ingest([{ ts: 4, vendor: 'fal', model: 'm', kind: 'cutscene', usdMicros: 1_000_000, settled: true, jobId: 'j9', env: 'test' }]);
    expect(await g.spentMicros('fal')).toBe(6_000_000);
  });

  it('rejects non-integer money', async () => {
    // (checked on the function the DO calls: a throw inside a DO RPC is reported as an unhandled error by the test pool)
    expect(() => assertMicros(1.5, 'estMicros')).toThrow(/integer/);
    expect(() => assertMicros(-1, 'actualMicros')).toThrow(/non-negative/);
    expect(() => assertMicros(0, 'x')).not.toThrow();
  });
});
