/**
 * GenJobWorkflow: one Workflow class for generation jobs (spec/domains/05-assets.md section 5.1). Today it runs the
 * `cutscene_shot` kind; the character pipeline kinds join in M10a1 over the same ports. The stage logic is in
 * steps/cutscene.ts so that `pnpm check:pipeline` can run it without the Workflows runtime.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { GenJob } from '@dv/shared';
import { cutsceneSink, gateConfig, isMock, makePorts, modePairingError, transcodeModeOf, type PipelineEnv } from './env.ts';
import { cutsceneKeyOf, runCutsceneJob, type JobOutcome, type StepLike } from './steps/cutscene.ts';

export class GenJobWorkflow extends WorkflowEntrypoint<PipelineEnv, GenJob> {
  override async run(event: WorkflowEvent<GenJob>, step: WorkflowStep): Promise<JobOutcome> {
    const job = event.payload;
    if (job.kind !== 'cutscene_shot') throw new Error(`GenJobWorkflow does not run kind ${job.kind} yet (M10a1)`);
    // M05c4: a pairing that cannot work (TRANSCODE_MODE=mock with FAL_MODE=live) ends the job before ports, budget or fal are touched.
    const pairing = modePairingError(this.env);
    if (pairing !== null) {
      await step.do('fail', () => cutsceneSink(this.env, cutsceneKeyOf(job)).fail(pairing, 'POLICY_REFUSED'));
      return { status: 'refused', code: 'POLICY_REFUSED', detail: pairing, writes: [] };
    }
    const ports = makePorts(this.env, job);
    return runCutsceneJob(
      step as unknown as StepLike,
      { ports, gate: gateConfig(this.env), instanceId: event.instanceId, hostApi: this.env.HOST_API, mock: isMock(this.env), transcodeMode: transcodeModeOf(this.env) ?? 'mock' },
      job,
    );
  }
}
