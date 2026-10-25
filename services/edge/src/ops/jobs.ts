import type { SpendEvent } from '@dv/shared';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { runExport } from './export.ts';
import { runForget } from './forget.ts';
import { runSummarize } from '../npc/summarize.ts';
import { handleBuilderBatch } from '../npc-builder/queue.ts';
import type { JobMessage } from './queue.ts';

/**
 * Queue consumers (M06a1). `tha-bay-jobs` carries `forget`, `export` and `summarize`; `tha-bay-spend` carries SpendEvents for
 * BudgetGovernorDO.ingest. A throw retries the message (Queues redelivers); every handler is idempotent. Previews run no consumers
 * (F-061), so `/_test/drain-queue` and the inline paths of the routes stand in there.
 * `summarize` (M06a4) folds a closed encounter into the relationship summary (npc/summarize.ts); a model failure throws, so it is redelivered.
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
      await runSummarize(env, deps, message);
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
  if (batch.queue.startsWith('tha-bay-npc-builder')) {
    await handleBuilderBatch(batch, env, deps);
    return;
  }
  deps.log(JSON.stringify({ event: 'queue.unknown' }));
  batch.ackAll();
}
