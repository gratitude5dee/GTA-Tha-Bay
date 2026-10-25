import type { ServerDataPort, NpcDraftRow } from '@dv/shared/data-port';
import { now } from '../clock.ts';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { writeServerEvent } from '../telemetry/server.ts';
import type { StoredJob } from './view.ts';

/** What a builder job runs with: the Worker env, the app deps, the database and the id the job's log lines and spend events carry. */
export interface JobCtx {
  env: Env;
  deps: AppDeps;
  port: ServerDataPort;
  requestId: string;
}

export type BuilderStep = 'create' | 'validate' | 'soul' | 'probes' | 'preview' | 'private_talk';

/** C16 `npc.builder.step {step, ok}`: an enum and a boolean, never a draft id or text. */
export function stepEvent(env: Env, step: BuilderStep, ok: boolean): void {
  writeServerEvent(env, 'npc.builder.step', { step, ok }, now());
}

/** The job list with `job` added or updated (the newest 10 are kept). */
export function withJob(jobs: unknown, job: StoredJob): StoredJob[] {
  const list = (Array.isArray(jobs) ? (jobs as StoredJob[]) : []).filter((j) => j.id !== job.id);
  list.push(job);
  return list.slice(-10);
}

/** Records the state of one job on the draft row. Never changes the draft's own state. */
export async function setJobState(port: ServerDataPort, draft: NpcDraftRow, job: StoredJob): Promise<NpcDraftRow> {
  const fresh = (await port.builder.getDraft(draft.id)) ?? draft;
  const next = await port.builder.updateDraft(draft.id, { jobs: withJob(fresh.jobs, job) as unknown as NpcDraftRow['jobs'] });
  return typeof next === 'object' && next !== null ? next : fresh;
}
