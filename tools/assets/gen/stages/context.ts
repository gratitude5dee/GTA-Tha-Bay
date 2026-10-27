/**
 * Shared machinery of the character stages (M10a1): the work-file layout, the cache check, the gate and the ledger reservation in front
 * of every paid call, the call itself (submit, status, outputs, copy at once), and the report files. A stage body is a function of a
 * `StageContext`; `executor.ts` is the sequence.
 */
import { createHash } from 'node:crypto';
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';
import { assertStageAllowed, type GateStage } from '../../../../services/pipeline/src/gate.ts';
import {
  buildStageJob, isRefusal, outputFileName, reportKey, resultKey, stageDir,
  type CharacterSubject, type PaidStage, type RunRecord, type StageFile, type StagePlan, type StageResult, type StageInput,
} from '../../../../services/pipeline/src/steps/character.ts';
import type { GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { isoNow } from '../ledger.ts';
import type { ExecutorConfig, ExecutorPorts } from '../executor.ts';

export interface StageDeps {
  ports: ExecutorPorts;
  cfg: ExecutorConfig;
  subject: CharacterSubject;
  plans: ReadonlyMap<PaidStage, StagePlan>;
}

/** An input file of a call: bytes the vendor receives (as a data URI) and what the gate must know about their origin. */
export interface CallFile {
  role: string;
  bytes: Uint8Array;
  contentType: string;
  origin: StageInput['origin'];
}

export interface Loaded {
  name: string;
  file: string;
  sha256: string;
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
}

export type PaidCall =
  | { kind: 'ok'; job: GenJob; result: StageResult; files: Loaded[]; cached: boolean }
  | { kind: 'refused'; job: GenJob | null; detail: string }
  | { kind: 'failed'; job: GenJob | null; detail: string }
  /** The vendor refused this input (HTTP 422): the result is cached and costs nothing more. */
  | { kind: 'vendor-refused'; job: GenJob; error: { type: string; message: string } };

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export const dataUri = (f: Pick<CallFile, 'bytes' | 'contentType'>): string => `data:${f.contentType};base64,${Buffer.from(f.bytes).toString('base64')}`;

const GATE_OF: Readonly<Record<PaidStage, GateStage>> = { sheet: 'sheet', portrait: 'portrait', mouth_atlas: 'mouth_atlas', mesh: 'mesh', rig: 'rig' };

export class StageContext {
  falCalls = 0;
  spentMicros = 0;
  readonly reportNames: string[] = [];

  constructor(readonly deps: StageDeps, readonly run: RunRecord) {}

  get subject(): CharacterSubject {
    return this.deps.subject;
  }

  now(): string {
    return isoNow(this.deps.ports.clock.now());
  }

  log(line: string): void {
    this.deps.ports.log(line);
  }

  /** The job every stage is gated with: the sheet job of the character with no inputs (the roster and prompt rules do not depend on inputs). */
  probeJob(): GenJob {
    const plan = this.deps.plans.get('sheet');
    if (plan === undefined) throw new Error('no sheet plan');
    return buildStageJob({ subject: this.subject, stage: 'sheet', plan, inputs: [], registry: this.deps.cfg.registry, requestedBy: this.deps.cfg.requestedBy, runId: this.run.runId, env: this.deps.cfg.mode === 'live' ? 'production' : 'test' });
  }

  async putFile(rel: string, bytes: Uint8Array): Promise<void> {
    await this.deps.ports.blob.put('PRIVATE', rel, bytes);
  }

  async getFile(rel: string): Promise<Uint8Array | null> {
    return this.deps.ports.blob.get('PRIVATE', rel);
  }

  async putJson(rel: string, value: unknown): Promise<void> {
    await this.putFile(rel, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
  }

  async getJson<T>(rel: string): Promise<T | null> {
    const b = await this.getFile(rel);
    return b === null ? null : (JSON.parse(new TextDecoder().decode(b)) as T);
  }

  async writeReport(rep: GateReport, name: string): Promise<void> {
    await this.putJson(reportKey(this.subject.slug, name), rep);
    this.reportNames.push(name);
  }

  /** The job of a paid stage with its plan and the hashes of the files it feeds. */
  jobFor(stage: PaidStage, files: readonly CallFile[], candidate = 0, params?: Record<string, unknown>): GenJob {
    const plan = this.deps.plans.get(stage);
    if (plan === undefined) throw new Error(`the ${this.subject.pipeline} pipeline has no ${stage} stage`);
    return buildStageJob({
      subject: this.subject, stage, plan, candidate, attempt: this.deps.cfg.attempts?.[stage] ?? 0,
      inputs: files.map((f) => ({ role: f.role, sha256: sha256(f.bytes), origin: f.origin })),
      registry: this.deps.cfg.registry, requestedBy: this.deps.cfg.requestedBy, runId: this.run.runId,
      env: this.deps.cfg.mode === 'live' ? 'production' : 'test',
      ...(params !== undefined ? { params } : {}),
    });
  }

  /**
   * One paid call, in the order of the milestone's rule: cache check (a `result.json` under the job key skips the call), the gate
   * (`assertStageAllowed`), the ledger reservation, the call, every output copied to the work directory at once (CDN copies
   * expire), the settle. A vendor refusal such as the rig's HTTP 422 is cached too and does not charge again.
   */
  async callPaid(stage: PaidStage, files: readonly CallFile[], opts: { candidate?: number; extra?: Record<string, unknown>; params?: Record<string, unknown> } = {}): Promise<PaidCall> {
    const { ports, cfg } = this.deps;
    const job = this.jobFor(stage, files, opts.candidate ?? 0, opts.params);
    const list = (this.run.jobs[stage] ??= []);
    if (!list.includes(job.jobKey)) list.push(job.jobKey);
    const dir = stageDir(this.subject.slug, stage, job.jobKey);
    const cachedResult = await this.getJson<StageResult>(resultKey(this.subject.slug, stage, job.jobKey));
    if (cachedResult !== null) {
      if (cachedResult.error !== undefined) return { kind: 'vendor-refused', job, error: cachedResult.error };
      const loaded = await this.loadFiles(dir, cachedResult.files);
      if (loaded !== null) return { kind: 'ok', job, result: cachedResult, files: loaded, cached: true };
    }

    const verdict = await assertStageAllowed(job, GATE_OF[stage], ports, { ...cfg.gate, log: ports.log });
    if (!verdict.ok) return { kind: 'refused', job, detail: `${verdict.code}: ${verdict.detail}` };
    const plan = this.deps.plans.get(stage) as StagePlan;
    const est = job.budgetUsdMicros;
    ports.budget.tag?.(job.jobKey, this.subject.slug, stage);
    const res = await ports.budget.reserve('fal', est, job.jobKey);
    if (!res.ok) return { kind: 'refused', job, detail: `BUDGET: the ledger refuses a reservation of ${est} micros (governor level ${res.level})` };

    this.falCalls += 1;
    let sub;
    try {
      sub = await ports.fal.submit(plan.endpointId, this.materialize(job, files, opts.extra), { webhookUrl: '', jobKey: job.jobKey });
    } catch (e) {
      await ports.budget.settle(job.jobKey, 0);
      return { kind: 'failed', job, detail: `${stage}: submit failed: ${(e as Error).message}` };
    }
    let status = await ports.fal.status(sub);
    for (let i = 0; i < 3 && status.status !== 'COMPLETED'; i++) status = await ports.fal.status(sub);
    if (status.status !== 'COMPLETED') {
      await ports.budget.settle(job.jobKey, 0);
      return { kind: 'failed', job, detail: `${stage}: the request ${sub.requestId} has not completed (${status.status})` };
    }
    const base = { schema: 'char-stage-result/1' as const, stage, jobKey: job.jobKey, endpointId: plan.endpointId, requestId: sub.requestId, generatedAt: this.now() };
    if (status.errorType !== undefined) {
      const error = { type: status.errorType, message: status.error ?? '' };
      // A refusal of this input costs nothing and will not change; anything else may be transient and is not cached.
      await ports.budget.settle(job.jobKey, 0, sub.requestId);
      if (isRefusal(error.type) || /422/.test(error.message)) {
        await this.putJson(resultKey(this.subject.slug, stage, job.jobKey), { ...base, costUsdMicros: 0, files: [], error });
        return { kind: 'vendor-refused', job, error };
      }
      return { kind: 'failed', job, detail: `${stage}: ${error.type} ${error.message}` };
    }
    const outs = await ports.fal.outputs(sub);
    const stored: StageFile[] = [];
    const loaded: Loaded[] = [];
    for (const [i, o] of outs.entries()) {
      const bytes = await ports.fal.fetchFile(o.url);
      const file = outputFileName(stage, i, o.contentType);
      await this.putFile(`${dir}/${file}`, bytes);
      const sf: StageFile = { name: o.name, file, sha256: sha256(bytes), bytes: bytes.length, contentType: o.contentType, sourceUrl: o.url };
      stored.push(sf);
      loaded.push({ ...sf, bytes });
    }
    const result: StageResult = { ...base, costUsdMicros: est, files: stored };
    await this.putJson(resultKey(this.subject.slug, stage, job.jobKey), result);
    await ports.budget.settle(job.jobKey, est, sub.requestId);
    this.spentMicros += est;
    return { kind: 'ok', job, result, files: loaded, cached: false };
  }

  private async loadFiles(dir: string, files: readonly StageFile[]): Promise<Loaded[] | null> {
    const out: Loaded[] = [];
    for (const f of files) {
      const bytes = await this.getFile(`${dir}/${f.file}`);
      if (bytes === null) return null;
      out.push({ ...f, bytes });
    }
    return out;
  }

  /**
   * The vendor input of a job: the parameters, the filled prompt, and the files as data URIs (UNVERIFIED shape for every endpoint but
   * the Sunburst edit and Meshy ones named in research/genai-pipeline-fal.md; BD-M10a1-05). `extra` carries values that are not files
   * (the rig's `model_url`).
   */
  materialize(job: GenJob, files: readonly CallFile[], extra?: Record<string, unknown>): Record<string, unknown> {
    const { characters: _characters, ...vendor } = job.params as Record<string, unknown> & { characters?: unknown };
    void _characters;
    const input: Record<string, unknown> = { ...vendor, ...(extra ?? {}) };
    const images = files.filter((f) => f.contentType.startsWith('image/'));
    if (job.endpointKey === 'tripo3d/h3.1/multiview-to-3d') {
      const [front, left, back, right] = images;
      if (front) input['front_image_url'] = dataUri(front);
      if (left) input['left_image_url'] = dataUri(left);
      if (back) input['back_image_url'] = dataUri(back);
      if (right) input['right_image_url'] = dataUri(right);
    } else if (images.length > 0) input['image_urls'] = images.map(dataUri);
    return input;
  }
}
