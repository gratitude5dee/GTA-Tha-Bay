import type { NpcDraftRow } from '@dv/shared/data-port';
import type { DraftState } from '@dv/shared/npc';
import { playerQuota } from '../budget/quota.ts';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { jobFailedState } from './states.ts';
import { stepEvent, setJobState, type JobCtx } from './jobs.ts';
import { builderPort } from './port.ts';
import { runProbes } from './probes.ts';
import { runSoul } from './soul-gen.ts';
import { runValidate } from './validate.ts';

/**
 * The jobs of the NPC builder (Queue `npc-builder`, 04-npc-builder.md section C3; M06b1): text validation, soul generation (which ends in the probes), and
 * a probe re-run. Workers Previews run no queue consumers (F-061) and a Worker with no queue bound has none to send to, so there the job runs inline in
 * `waitUntil`; the staging and production Workers send it to the queue, whose consumer is `handleBuilderBatch`. Tests can replace the sink to read
 * what was sent, and `drainBuilder` waits for inline jobs.
 */
export type BuilderJob =
  | { type: 'validate'; draftId: string; jobId: string }
  | { type: 'soul'; draftId: string; jobId: string; reservationId: string }
  | { type: 'probe'; draftId: string; jobId: string };

let sink: ((job: BuilderJob) => void) | null = null;
const inflight = new Set<Promise<void>>();

/** Test seam: a function that receives every job instead of the queue or the inline run. Null restores the default. */
export function setBuilderSinkForTests(fn: ((job: BuilderJob) => void) | null): void {
  sink = fn;
}

/** Waits for every inline job started in this isolate (tests and the staging `drain` route). Returns how many there were. */
export async function drainBuilder(): Promise<number> {
  let n = 0;
  while (inflight.size > 0) {
    n += inflight.size;
    await Promise.allSettled([...inflight]);
  }
  return n;
}

function jobCtx(env: Env, deps: AppDeps, requestId: string): JobCtx | null {
  const p = builderPort(env, deps);
  return p === null ? null : { env, deps, port: p.port, requestId };
}

/** Runs one job. A throw leaves the draft where the job found it; `failJob` is the caller's way out of a job that cannot finish. */
export async function runBuilderJob(env: Env, deps: AppDeps, job: BuilderJob, requestId: string): Promise<void> {
  const jc = jobCtx(env, deps, requestId);
  if (jc === null) return;
  if (job.type === 'validate') await runValidate(jc, job.draftId, job.jobId);
  else if (job.type === 'soul') await runSoul(jc, job.draftId, job.jobId, job.reservationId);
  else await runProbes(jc, job.draftId);
}

/** Puts a draft whose job crashed back in a state the author can act on, and marks the job failed. */
export async function failJob(env: Env, deps: AppDeps, job: BuilderJob, requestId: string): Promise<void> {
  const jc = jobCtx(env, deps, requestId);
  if (jc === null) return;
  const draft = await jc.port.builder.getDraft(job.draftId);
  if (draft === null) return;
  const to = jobFailedState(draft.state as DraftState);
  if (to !== null) await jc.port.builder.updateDraft(draft.id, { state: to }, { fromStates: [draft.state] });
  const after: NpcDraftRow | null = await jc.port.builder.getDraft(draft.id);
  if (after !== null) await setJobState(jc.port, after, { id: job.jobId, kind: job.type === 'validate' ? 'validate' : 'soul', state: 'failed' });
  stepEvent(env, job.type === 'validate' ? 'validate' : job.type === 'soul' ? 'soul' : 'probes', false);
  if (job.type === 'soul') {
    try {
      await playerQuota(env, draft.owner_profile_id).release(job.reservationId);
    } catch {
      // the day's count stays spent; the next quota day starts clean
    }
  }
}

/** Sends the job to the queue, or runs it inline where no consumer exists. */
export async function enqueueBuilderJob(env: Env, deps: AppDeps, exec: ExecutionContext | undefined, job: BuilderJob, requestId: string): Promise<void> {
  if (sink !== null) {
    sink(job);
    return;
  }
  if (env.BUILDER !== undefined && env.ENVIRONMENT !== 'preview') {
    await env.BUILDER.send(job);
    return;
  }
  const work = runBuilderJob(env, deps, job, requestId).catch(() => failJob(env, deps, job, requestId)).catch(() => undefined);
  inflight.add(work);
  void work.finally(() => inflight.delete(work));
  exec?.waitUntil(work);
}

/** The consumer of `tha-bay-npc-builder[-staging]`: a throw retries the message twice, then the draft is put back and the message acknowledged. */
export async function handleBuilderBatch(batch: MessageBatch<unknown>, env: Env, deps: AppDeps): Promise<void> {
  for (const m of batch.messages) {
    const job = m.body as BuilderJob;
    try {
      await runBuilderJob(env, deps, job, `queue-${m.id}`);
      m.ack();
    } catch {
      if (m.attempts >= 3) {
        await failJob(env, deps, job, `queue-${m.id}`).catch(() => undefined);
        m.ack();
      } else {
        m.retry({ delaySeconds: 30 });
      }
    }
  }
}
