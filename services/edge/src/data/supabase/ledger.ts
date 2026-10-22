import type { SpendEvent } from '@dv/shared';
import type { LedgerStore } from '@dv/shared/data-port';
import { must, toIso, type Db } from './client.ts';

const CHUNK = 500;

/**
 * `genai_ledger` access. A row with a job id is written with ON CONFLICT (env, job_id) DO NOTHING, so the nightly export can be
 * repeated after a crash between the append and the "exported" mark and adds nothing the second time.
 */
export function ledger(db: Db, defaultEnv: string): LedgerStore {
  const toRow = (r: SpendEvent) => ({
    ts: toIso(r.ts),
    vendor: r.vendor,
    model: r.model,
    kind: r.kind,
    usd_micros: r.usdMicros,
    settled: r.settled,
    request_id: r.requestId ?? null,
    job_id: r.jobId ?? null,
    env: r.env === '' ? defaultEnv : r.env,
  });
  return {
    async append(rows) {
      const withJob = rows.filter((r) => r.jobId !== undefined).map(toRow);
      const withoutJob = rows.filter((r) => r.jobId === undefined).map(toRow);
      let added = 0;
      for (let i = 0; i < withJob.length; i += CHUNK) {
        const res = await db.from('genai_ledger').upsert(withJob.slice(i, i + CHUNK), { onConflict: 'env,job_id', ignoreDuplicates: true }).select('id');
        added += must('genai_ledger', res).length;
      }
      for (let i = 0; i < withoutJob.length; i += CHUNK) {
        const res = await db.from('genai_ledger').insert(withoutJob.slice(i, i + CHUNK)).select('id');
        added += must('genai_ledger', res).length;
      }
      return added;
    },
    async sumUsdMicros(vendor, sinceMs) {
      let sum = 0;
      for (let from = 0; ; from += 1000) {
        const page = must(
          'genai_ledger',
          await db.from('genai_ledger').select('usd_micros').eq('vendor', vendor).gte('ts', toIso(sinceMs)).order('id').range(from, from + 999),
        );
        for (const r of page) sum += r.usd_micros;
        if (page.length < 1000) return sum;
      }
    },
  };
}
