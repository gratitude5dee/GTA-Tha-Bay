import type { SpendEvent } from '@dv/shared';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { runExport } from './export.ts';
import { runForget } from './forget.ts';
import type { JobMessage } from './queue.ts';

/**
 * Queue consumers (M06a1). `tha-bay-jobs` carries `forget`, `export` and `summarize`; `tha-bay-spend` carries SpendEvents for
 * BudgetGovernorDO.ingest. A throw retries the message (Queues redelivers); every handler is idempotent. Previews run no consumers
 * (F-061), so `/_test/drain-queue` and the inline paths of the routes stand in there.
 * `summarize` has no consumer before M06a4: it is logged and acknowledged, and the transcript stays in PRIVATE for its 30 days.
 */
export async function handleJob(env: Env, deps: AppDeps, message: JobMessage): Promise<void> {
  switch (message.type) {
    case 'forget':
      await runForget(env, deps, message.profileId);
      return;
    case 'export':
      await runExport(env, deps, message.profileId, message.exportId);
      await env.PRIVATE.delete(`exports/${message.profileId}/pending`);
      return;
    case 'summarize':
      deps.log(JSON.stringify({ event: 'job.summarize', note: 'consumer lands in M06a4' }));
      return;
    default:
      deps.log(JSON.stringify({ event: 'job.unknown' }));
  }
}

export async function handleSpendBatch(env: Env, events: readonly SpendEvent[]): Promise<void> {
  if (events.length === 0) return;
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as { ingest(b: SpendEvent[]): Promise<void> };
  await gov.ingest([...events]);
}

/** Dispatches a queue batch by the queue's name (`tha-bay-jobs[-staging]`, `tha-bay-spend[-staging]`). */
export async function handleQueueBatch(batch: MessageBatch<unknown>, env: Env, deps: AppDeps): Promise<void> {
  if (batch.queue.startsWith('tha-bay-spend')) {
    await handleSpendBatch(env, batch.messages.map((m) => m.body as SpendEvent));
    batch.ackAll();
    return;
  }
  if (batch.queue.startsWith('tha-bay-jobs')) {
    for (const m of batch.messages) {
      try {
        await handleJob(env, deps, m.body as JobMessage);
        m.ack();
      } catch {
        m.retry({ delaySeconds: 30 });
      }
    }
    return;
  }
  deps.log(JSON.stringify({ event: 'queue.unknown' }));
  batch.ackAll();
}
