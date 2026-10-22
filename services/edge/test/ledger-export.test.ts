import { env } from 'cloudflare:test';
import type { SpendEvent } from '@dv/shared';
import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';

interface GovRpc {
  ingest(batch: SpendEvent[]): Promise<void>;
  markExported(jobIds: string[]): Promise<number>;
  exportBatch(limit?: number): Promise<SpendEvent[]>;
}

const bindings = (): Env => env as unknown as Env;
const gov = (): GovRpc => bindings().GOVERNOR.get(bindings().GOVERNOR.idFromName(`gov:${bindings().ENVIRONMENT}`)) as unknown as GovRpc;

const event = (i: number, over: Partial<SpendEvent> = {}): SpendEvent => ({
  ts: 1_790_000_000_000 + i,
  vendor: 'elevenlabs',
  model: 'eleven_flash_v2_5',
  kind: 'tts',
  usdMicros: 1000 + i,
  settled: true,
  jobId: `export-job-${i}`,
  requestId: `req-${i}`,
  env: '',
  ...over,
});

interface Ran {
  ran: { job: string; ran: boolean; read?: number; appended?: number }[];
}

describe('ledger-export (AC-7)', () => {
  it('exports the 3 unexported of 5 settled rows once, with equal amounts and env = ENVIRONMENT', async () => {
    await gov().ingest([0, 1, 2, 3, 4].map((i) => event(i)));
    // Two of the five were exported by an earlier run.
    expect(await gov().markExported(['export-job-0', 'export-job-1'])).toBe(2);

    const port = new InMemoryDataPort();
    const app = createApp({ data: () => port });
    const run = async (): Promise<Ran['ran'][number]> =>
      ((await (await call('/api/v1/_test/run-scheduled?job=ledger-export', { method: 'POST', app })).json()) as Ran).ran[0]!;

    expect(await run()).toEqual({ job: 'ledger-export', ran: true, read: 3, appended: 3 });
    const rows = port.ledgerRows();
    expect(rows.map((r) => r.jobId).sort()).toEqual(['export-job-2', 'export-job-3', 'export-job-4']);
    expect(rows.map((r) => r.usdMicros).sort((a, b) => a - b)).toEqual([1002, 1003, 1004]);
    expect(new Set(rows.map((r) => r.env))).toEqual(new Set([bindings().ENVIRONMENT]));
    expect(rows.every((r) => r.settled && r.model === 'eleven_flash_v2_5' && r.kind === 'tts')).toBe(true);

    expect(await run()).toEqual({ job: 'ledger-export', ran: true, read: 0, appended: 0 });
    expect(port.ledgerRows()).toHaveLength(3);
  });

  it('a crash between the append and the mark costs nothing: the repeat appends 0 rows', async () => {
    await gov().ingest([event(10), event(11)]);
    const port = new InMemoryDataPort();
    const batch = (await gov().exportBatch()).filter((r) => r.jobId === 'export-job-10' || r.jobId === 'export-job-11');
    // The first run appended and died before marking.
    expect(await port.ledger.append(batch.map((r) => ({ ...r, env: bindings().ENVIRONMENT })))).toBe(2);
    const app = createApp({ data: () => port });
    const ran = ((await (await call('/api/v1/_test/run-scheduled?job=ledger-export', { method: 'POST', app })).json()) as Ran).ran[0]!;
    expect(ran.appended).toBe(0);
    expect(port.ledgerRows().filter((r) => r.jobId === 'export-job-10')).toHaveLength(1);
    expect(await gov().exportBatch()).toEqual([]);
  });

  it('a reservation that has not settled is not exported', async () => {
    await gov().ingest([event(20, { settled: false })]);
    const exported = await gov().exportBatch();
    expect(exported.some((r) => r.jobId === 'export-job-20')).toBe(false);
  });
});
