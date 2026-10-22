import type { SpendEvent } from '@dv/shared';
import type { Env } from '../env.ts';

/**
 * Producers for the two queues of the web Worker (M06a1): `JOBS` (summarize, forget, export) and `SPEND` (settled turn costs).
 * Queue consumers do not run in Previews (F-061), so a binding that is absent makes the sender report `false` and the caller runs the
 * work inline; tests replace the sinks to read what was sent. Sinks are module state and are never set by production code.
 */
export type JobMessage =
  | { type: 'summarize'; encounterId: string; profileId: string; npcId: string; soulVersion: number; r2Key: string }
  | { type: 'forget'; profileId: string }
  | { type: 'export'; profileId: string; exportId: string };

let jobSink: ((m: JobMessage) => void) | null = null;
let spendSink: ((e: SpendEvent) => void) | null = null;

export function setQueueSinksForTests(sinks: { jobs?: ((m: JobMessage) => void) | null; spend?: ((e: SpendEvent) => void) | null }): void {
  if (sinks.jobs !== undefined) jobSink = sinks.jobs;
  if (sinks.spend !== undefined) spendSink = sinks.spend;
}

/** Sends a job. Returns false when no queue is bound (the caller then runs the job inline). */
export async function sendJob(env: Pick<Env, 'JOBS'>, message: JobMessage): Promise<boolean> {
  if (jobSink !== null) {
    jobSink(message);
    return true;
  }
  if (!env.JOBS) return false;
  await env.JOBS.send(message);
  return true;
}

/** Sends a spend event. Returns false when no queue is bound. */
export async function sendSpend(env: Pick<Env, 'SPEND'>, event: SpendEvent): Promise<boolean> {
  if (spendSink !== null) {
    spendSink(event);
    return true;
  }
  if (!env.SPEND) return false;
  await env.SPEND.send(event);
  return true;
}
