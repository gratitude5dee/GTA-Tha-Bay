/**
 * The character executor (M10a1): walks one roster slug through the stages of spec/domains/05-assets-pipeline.md section 1 over the
 * `GenJobWorkflow` ports, with `assertStageAllowed` at the entry of every stage, a cache check and a ledger reservation before every
 * paid call, the automated gates A1 to A8, and the human gates H0 to H5 recorded in `run.json`.
 *
 *   tier-check -> sheet -> [H1] -> crops -> portrait -> mouth_atlas -> [H2] -> mesh x2 -> [H3] -> rig -> [H4] -> optimize -> publish -> [H5]
 *
 * Work files live under `work/character/<slug>/<stage>/<jobKey>/` in the BlobPort (`.genai/` on disk, memory in tests). A stage whose
 * `result.json` exists for its job key is a cache hit and calls nothing, so a second run makes zero FalPort calls. The executor never
 * crosses a human gate without a recorded decision. Stage bodies live in `stages/`; this file is the sequence.
 */
import { createHash } from 'node:crypto';
import type { RigFamily, FidelityLimits } from '../../../packages/shared/src/assets/gates/index.ts';
import type { ConsentIndex } from '../../../packages/shared/src/assets/gates/likeness.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { assertStageAllowed, type GateConfig, type GateStage } from '../../../services/pipeline/src/gate.ts';
import type { BlobPort, BudgetPort, ClockPort, FlagsPort, NamePort, RosterPort } from '../../../services/pipeline/src/ports.ts';
import {
  approvedDecision, decisionOf, estimateMicros, newRun, runKey, stagePlans,
  type CharacterFalPort, type CharacterStage, type CharacterSubject, type HumanGateId, type PaidStage, type ReviewEntry, type RunRecord, type StagePlan, type UntilStage,
} from '../../../services/pipeline/src/steps/character.ts';
import { gateReport, type VisionPort } from '../../../services/pipeline/src/steps/gates.ts';
import type { KtxPort } from '../src/optimize.ts';
import { isoNow } from './ledger.ts';
import { StageContext, type StageDeps } from './stages/context.ts';
import { runSheet } from './stages/sheet.ts';
import { runCrops } from './stages/crops.ts';
import { runPortrait, runMouthAtlas, type PaidOk } from './stages/portrait.ts';
import { runMesh } from './stages/mesh.ts';
import { runRig } from './stages/rig.ts';
import { runOptimize } from './stages/optimize.ts';
import { runPublish, type PublishPort } from './stages/publish.ts';

export interface ExecutorPorts {
  fal: CharacterFalPort;
  blob: BlobPort;
  roster: RosterPort;
  flags: FlagsPort;
  budget: BudgetPort & { tag?(jobId: string, slug: string, stage: string): void };
  clock: ClockPort;
  names?: NamePort;
  vision: VisionPort;
  log: (line: string) => void;
}

export interface ExecutorConfig {
  registry: GenAiRegistry;
  gate: GateConfig;
  mode: 'mock' | 'live';
  requestedBy: string;
  /** The approved style-bible image (H0) and its id, e.g. `bay-cel@1`. */
  styleBible: { id: string; bytes: Uint8Array } | null;
  /** First-party reference images (at most three are sent). */
  refs: readonly Uint8Array[];
  rig: RigFamily;
  limits: Readonly<Record<'hi' | 'mid' | 'lo', FidelityLimits>>;
  withMoves?: boolean;
  /** A retake of a stage is a new seed and so a new job key (`run --retake mesh --attempt 1`); costs again. */
  attempts?: Partial<Record<PaidStage, number>>;
  /** Names lint over text read out of an image (true when the text passes). */
  textLint: (text: string) => boolean;
  ktx?: KtxPort | null;
  consent: ConsentIndex;
  recordLicenses: readonly string[];
  termsSnapshot: { path: string; sha256: string; checked_at: string };
  /** Where `publish` writes the asset specs, files and provenance records; null: the stage reports what it would write and stops. */
  publisher: PublishPort | null;
  concurrency?: number;
}

export interface RunOutcome {
  status: 'complete' | 'awaiting' | 'failed' | 'refused';
  stage: CharacterStage;
  gate?: HumanGateId;
  detail: string;
  /** `FalPort.submit` calls this run made. */
  falCalls: number;
  spentMicros: number;
  reports: string[];
  run: RunRecord;
}

export type RunUntil = UntilStage | 'publish';

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export async function loadRun(blob: BlobPort, subject: CharacterSubject, at: string): Promise<RunRecord> {
  const bytes = await blob.get('PRIVATE', runKey(subject.slug));
  if (bytes === null) return newRun(subject, at);
  return JSON.parse(new TextDecoder().decode(bytes)) as RunRecord;
}

export async function saveRun(blob: BlobPort, run: RunRecord, at: string): Promise<void> {
  run.updatedAt = at;
  await blob.put('PRIVATE', runKey(run.slug), new TextEncoder().encode(`${JSON.stringify(run, null, 2)}\n`), { contentType: 'application/json' });
}

/** `assets:gen gate`: appends a decision to the run record (a later entry overrides an earlier one). */
export async function recordDecision(blob: BlobPort, subject: CharacterSubject, entry: Omit<ReviewEntry, 'at'>, at: string): Promise<RunRecord> {
  const run = await loadRun(blob, subject, at);
  run.review.push({ ...entry, at });
  await saveRun(blob, run, at);
  return run;
}

const GATE_STAGE: Readonly<Record<CharacterStage, GateStage>> = {
  'tier-check': 'tier-check', sheet: 'sheet', crops: 'crops', portrait: 'portrait', mouth_atlas: 'mouth_atlas', mesh: 'mesh', rig: 'rig', optimize: 'optimize', publish: 'publish',
};

/** Runs the character until the stage named by `until` or the first human gate without a decision. */
export async function runCharacter(ports: ExecutorPorts, cfg: ExecutorConfig, subject: CharacterSubject, until: RunUntil): Promise<RunOutcome> {
  const now = (): string => isoNow(ports.clock.now());
  const run = await loadRun(ports.blob, subject, now());
  const plans = new Map<PaidStage, StagePlan>(stagePlans(subject, cfg.registry, { withMoves: cfg.withMoves === true }).map((p) => [p.stage, p]));
  const deps: StageDeps = { ports, cfg, subject, plans };
  const ctx = new StageContext(deps, run);

  const done = async (r: Omit<RunOutcome, 'falCalls' | 'spentMicros' | 'reports' | 'run'>): Promise<RunOutcome> => {
    await saveRun(ports.blob, run, now());
    return { ...r, falCalls: ctx.falCalls, spentMicros: ctx.spentMicros, reports: ctx.reportNames, run };
  };
  const awaiting = (stage: CharacterStage, gate: HumanGateId, detail: string): Promise<RunOutcome> => done({ status: 'awaiting', stage, gate, detail });
  const refused = (stage: CharacterStage, detail: string): Promise<RunOutcome> => done({ status: 'refused', stage, detail });
  const failed = (stage: CharacterStage, detail: string): Promise<RunOutcome> => done({ status: 'failed', stage, detail });

  // Gate every stage before it starts. A refusal (a killed cast, a face reference, a name in a prompt) stops the run there.
  const allowed = async (stage: CharacterStage): Promise<string | null> => {
    const v = await assertStageAllowed(ctx.probeJob(), GATE_STAGE[stage], ports, { ...cfg.gate, log: ports.log });
    if (v.ok) return null;
    await ctx.writeReport(gateReport('G-ALL', stage, subject.slug, [{ gate: 'G-ALL', file: subject.slug, rule: v.code, detail: v.detail }], now()), `${stage}-gate`);
    return `${v.code}: ${v.detail}`;
  };
  const gateOpen = (g: HumanGateId): ReviewEntry | null => approvedDecision(run, g);

  // 0. tier-check
  const tierRefusal = await allowed('tier-check');
  await ctx.writeReport(gateReport('G-ALL', 'tier-check', subject.slug, [], now(), [`tier ${subject.tier}, soul v${subject.soulVersion}, pipeline ${subject.pipeline}`, `estimate ${estimateMicros([...plans.values()])} micros`]), 'tier-check');
  if (tierRefusal !== null) return refused('tier-check', tierRefusal);

  // H0: the style bible
  if (subject.pipeline === 'standard') {
    if (cfg.styleBible === null) return awaiting('sheet', 'H0', 'the style bible is not in place: put the approved image at .genai/style-bible/<id>.png and record H0 (gate --gate H0 --choose 1)');
    if (gateOpen('H0') === null) return awaiting('sheet', 'H0', `H0: the art director approves style bible ${cfg.styleBible.id} (gate --run ${run.runId} --gate H0 --choose 1 --by <profile>)`);
  }

  // 1. sheet
  let r = await allowed('sheet');
  if (r !== null) return refused('sheet', r);
  const sheet = await runSheet(ctx);
  if (sheet.kind !== 'ok') return sheet.kind === 'refused' ? refused('sheet', sheet.detail) : failed('sheet', sheet.detail);
  const h1 = gateOpen('H1');
  if (h1 === null) return awaiting('sheet', 'H1', `H1: pick the best of ${sheet.files} sheets (${sheet.summary}); gate --run ${run.runId} --gate H1 --choose <n> --by <profile>`);
  if (until === 'sheet') return done({ status: 'complete', stage: 'sheet', detail: `sheet stage complete; H1 by ${h1.by} chose sheet ${h1.choose ?? '?'}` });
  const chosenSheet = (h1.choose ?? 0) - 1;
  if (chosenSheet < 0 || chosenSheet >= sheet.files || !sheet.usable[chosenSheet]) return awaiting('sheet', 'H1', `H1: choice ${h1.choose ?? '?'} is not a usable sheet (usable: ${sheet.usable.map((u, i) => (u ? i + 1 : 0)).filter(Boolean).join(', ') || 'none'})`);

  // 2. crops, portrait, mouth atlas
  r = await allowed('crops');
  if (r !== null) return refused('crops', r);
  const crops = await runCrops(ctx, sheet.sheets[chosenSheet] as Uint8Array);
  if (crops.kind !== 'ok') return failed('crops', crops.detail);
  let portrait: PaidOk | null = null;
  let atlas: PaidOk | null = null;
  if (subject.pipeline === 'standard') {
    r = await allowed('portrait');
    if (r !== null) return refused('portrait', r);
    const p = await runPortrait(ctx, crops);
    if (p.kind !== 'ok') return p.kind === 'refused' ? refused('portrait', p.detail) : failed('portrait', p.detail);
    portrait = p;
    r = await allowed('mouth_atlas');
    if (r !== null) return refused('mouth_atlas', r);
    const a = await runMouthAtlas(ctx, crops);
    if (a.kind !== 'ok') return a.kind === 'refused' ? refused('mouth_atlas', a.detail) : failed('mouth_atlas', a.detail);
    atlas = a;
    const h2 = gateOpen('H2');
    if (h2 === null) return awaiting('mouth_atlas', 'H2', `H2: pick the portrait and the mouth atlas (gate --run ${run.runId} --gate H2 --choose <portrait> [--atlas <n>] --by <profile>)`);
  }

  // 3. mesh
  r = await allowed('mesh');
  if (r !== null) return refused('mesh', r);
  const mesh = await runMesh(ctx, crops);
  if (mesh.kind !== 'ok') return mesh.kind === 'refused' ? refused('mesh', mesh.detail) : failed('mesh', mesh.detail);
  const h3 = gateOpen('H3');
  if (h3 === null) return awaiting('mesh', 'H3', `H3: pick the best of 2 meshes (${mesh.summary}); gate --run ${run.runId} --gate H3 --choose <n> --by <profile>`);
  if (until === 'mesh') return done({ status: 'complete', stage: 'mesh', detail: `mesh stage complete; H3 by ${h3.by} chose mesh ${h3.choose ?? '?'}` });
  const pick = (h3.choose ?? 0) - 1;
  if (pick < 0 || pick > 1 || !mesh.usable[pick]) return awaiting('mesh', 'H3', `H3: choice ${h3.choose ?? '?'} is not a mesh that passed A3`);

  // 4. rig
  r = await allowed('rig');
  if (r !== null) return refused('rig', r);
  const rig = await runRig(ctx, mesh, pick);
  if (rig.kind === 'refused') return refused('rig', rig.detail);
  if (rig.kind === 'failed') return failed('rig', rig.detail);
  if (rig.kind === 'needs-human') return awaiting('rig', 'H4', rig.detail);
  const h4 = gateOpen('H4');
  if (h4 === null) return awaiting('rig', 'H4', `H4: spot-check the rig in a viewer (turntable plus four clips), set the mouth anchor, record bones.jaw and bones.fingers; gate --run ${run.runId} --gate H4 --choose 1 --by <profile>`);
  if (until === 'rig') return done({ status: 'complete', stage: 'rig', detail: `rig stage complete; H4 by ${h4.by}` });

  // 5. optimize
  r = await allowed('optimize');
  if (r !== null) return refused('optimize', r);
  const opt = await runOptimize(ctx, rig);
  if (opt.kind !== 'ok') return failed('optimize', opt.detail);

  // 6. publish
  r = await allowed('publish');
  if (r !== null) return refused('publish', r);
  const pub = await runPublish(ctx, { crops, sheet: { bytes: sheet.sheets[chosenSheet] as Uint8Array, result: sheet.result, job: sheet.job }, portrait, atlas, mesh, pick, rig, opt, h4 });
  if (pub.kind !== 'ok') return failed('publish', pub.detail);
  if (gateOpen('H5') === null) return awaiting('publish', 'H5', `H5: review the lock diff, three fidelities side by side (${pub.summary}); gate --run ${run.runId} --gate H5 --choose 1 --by <profile>`);
  const d5 = decisionOf(run, 'H5');
  return done({ status: 'complete', stage: 'publish', detail: `published ${subject.slug}; H5 by ${d5?.by ?? '?'} (${pub.summary})` });
}
