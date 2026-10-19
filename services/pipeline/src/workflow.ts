/**
 * GenJobWorkflow: one Workflow class for generation jobs (spec/domains/05-assets.md section 5.1). Today it runs the
 * `cutscene_shot` kind; the character pipeline kinds join in M10a1 over the same ports. The stage logic is in
 * steps/cutscene.ts so that `pnpm check:pipeline` can run it without the Workflows runtime.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { GenJob } from '@dv/shared';
import { gateConfig, isMock, makePorts, type PipelineEnv } from './env.ts';
import { runCutsceneJob, type JobOutcome, type StepLike } from './steps/cutscene.ts';

export class GenJobWorkflow extends WorkflowEntrypoint<PipelineEnv, GenJob> {
  override async run(event: WorkflowEvent<GenJob>, step: WorkflowStep): Promise<JobOutcome> {
    const job = event.payload;
    if (job.kind !== 'cutscene_shot') throw new Error(`GenJobWorkflow does not run kind ${job.kind} yet (M10a1)`);
    const ports = makePorts(this.env, job);
    return runCutsceneJob(
      step as unknown as StepLike,
      { ports, gate: gateConfig(this.env), instanceId: event.instanceId, hostApi: this.env.HOST_API, mock: isMock(this.env) },
      job,
    );
  }
}
