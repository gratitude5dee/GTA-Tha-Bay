/**
 * The character pipeline, pure part (spec/domains/05-assets-pipeline.md sections 1 and 11, M10a1; R-NPC-02). Everything here is data in,
 * data out: stage plans and their price from the registry, the `GenJob` of each stage with its `jobKey`, the prompts, the cache paths
 * under `work/character/<slug>/`, the classification of a fal result into files, and the run record that the human gates write into.
 * The executor that moves bytes (`tools/assets/gen/executor.ts`) and the Workflow share these functions, so a stage costs and keys
 * the same everywhere.
 *
 * Tiers: `standard` (sheet, portrait, mouth atlas, two Meshy candidates, Meshy multi-animation rig) and `lean` (nano-banana sheet,
 * two Tripo candidates, Meshy base rig, no portrait or atlas). Prices are the registry's list prices as integer USD micros; the two
 * constants below are the ones the registry has no row for (the 1024 px portrait and the extra reference inputs, spec section 11).
 */
import type { FalPort, FalSubmission } from '../ports.ts';
import { jobKey, sha256Hex, type EndpointEntry, type GenAiRegistry, type GenJob, type GenKind, type InputFile, type LikenessTier } from '@dv/shared';

export const CHARACTER_RECIPE = 'char@1';
export type PipelineTier = 'standard' | 'lean';

/** Stages in order. `tier-check` and `publish` are local; `crops` and `optimize` are local too and cost nothing. */
export const CHARACTER_STAGES = ['tier-check', 'sheet', 'crops', 'portrait', 'mouth_atlas', 'mesh', 'rig', 'optimize', 'publish'] as const;
export type CharacterStage = (typeof CHARACTER_STAGES)[number];
/** The stages that call a vendor. */
export type PaidStage = 'sheet' | 'portrait' | 'mouth_atlas' | 'mesh' | 'rig';
export const PAID_STAGES: readonly PaidStage[] = ['sheet', 'portrait', 'mouth_atlas', 'mesh', 'rig'];

export type HumanGateId = 'H0' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
export const HUMAN_GATES: readonly HumanGateId[] = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5'];

/** `run --until`: where an unattended run stops (it stops at a human gate sooner when no decision is recorded). */
export type UntilStage = 'sheet' | 'mesh' | 'rig';

/** The human gate that closes a stage; the run cannot continue until it has a decision. */
export const GATE_AFTER: Readonly<Partial<Record<CharacterStage, HumanGateId>>> = {
  sheet: 'H1', mouth_atlas: 'H2', mesh: 'H3', rig: 'H4', publish: 'H5',
};

/** Sunburst edit at 1024 x 1024 high, USD micros per image (spec section 11; F-044 table). */
export const PORTRAIT_MICROS = 52_680;
/** Assumed price of each extra reference image of a sheet call (spec section 11 assumption A, U7). */
export const EXTRA_REF_MICROS = 10_000;
/** Reference inputs per Standard sheet call beyond the style-bible crop (spec section 1: at most three first-party references). */
export const SHEET_EXTRA_REFS = 3;
/** One Meshy library clip, USD micros (F-045). */
export const CLIP_MICROS = 120_000;
/** Meshy action ids sent with every Standard rig: 0 Idle, 30 Casual_Walk, 16 RunFast, 466 Regular_Jump, 178 Hit_Reaction. */
export const BASE_CLIP_IDS: readonly number[] = [0, 30, 16, 466, 178];
/** DL-172: a Standard character whose estimate passes this is refused until the owner funds it from the buffer. */
export const STANDARD_ESTIMATE_LIMIT_MICROS = 3_730_000;

export const LEAN_MESH_KEY = 'tripo3d/h3.1/multiview-to-3d';
export const LEAN_RIG_KEY = 'fal-ai/meshy/rigging';

/**
 * The two Lean-tier endpoints that spec section 1 (Lean column) and section 11 name and that `config/genai-endpoints.json` does not hold yet
 * (BD-M10a1-02). They are `pending`, so the gate refuses them in production. The registry file takes them once `genai:liveness` has recorded a
 * fixture for each id (the liveness unit test requires one per fal endpoint, and a fixture is a recorded public-registry answer, which this
 * milestone did not fetch); until then every caller reads the registry through `withLeanEndpoints`.
 */
export const LEAN_PENDING_ENDPOINTS: Readonly<Record<string, EndpointEntry>> = {
  [LEAN_MESH_KEY]: {
    id: LEAN_MESH_KEY, vendor: 'fal', role: 'mesh_alt', status: 'pending', pinnedUpdatedAt: null, licenseType: 'commercial', acceptsFaceRefs: false,
    tiers: ['original', 'fictionalized', 'parody', 'consented'], termsSnapshot: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md',
    price: { usd: 0.3, per: 'gen', checkedAt: '2026-10-18', note: 'Lean tier mesh, standard textures; 2 to 4 views in the order front, left, back, right [research/genai-pipeline-fal.md section 3.1]' },
  },
  [LEAN_RIG_KEY]: {
    id: LEAN_RIG_KEY, vendor: 'fal', role: 'rig', status: 'pending', pinnedUpdatedAt: null, licenseType: 'commercial', acceptsFaceRefs: false,
    tiers: ['original', 'fictionalized', 'parody', 'consented'], termsSnapshot: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md',
    price: { usd: 0.2, per: 'gen', checkedAt: '2026-10-18', note: 'Lean tier rig; walking and running clips included, $0.12 more with enable_animation [F-045]' },
  },
};

/** The registry with the Lean endpoints added when it does not hold them. */
export function withLeanEndpoints<R extends Pick<GenAiRegistry, 'endpoints'>>(reg: R): R {
  const missing = Object.entries(LEAN_PENDING_ENDPOINTS).filter(([k]) => reg.endpoints[k] === undefined);
  return missing.length === 0 ? reg : { ...reg, endpoints: { ...reg.endpoints, ...Object.fromEntries(missing) } };
}

/** Target triangles sent to the mesher: hero and fighter 30,000, named NPC 12,000 (spec section 1, stage 4). */
export const targetTris = (hero: boolean): number => (hero ? 30_000 : 12_000);

export interface CharacterSubject {
  slug: string;
  /** C10 `assetTier(soul)`: the tier the gate and the job key see. */
  tier: LikenessTier;
  soulVersion: number;
  visualBrief: string;
  heightM: number;
  /** Signature clip ids of the soul (Meshy action ids). Billed only when `withMoves` is set. */
  moves: readonly number[];
  standIn: string | null;
  pipeline: PipelineTier;
  /** Fighter or hero: 30,000 target triangles and the `character-hero` budget row. */
  hero: boolean;
  /** Kill scopes in force (C12). */
  killed: readonly string[];
  minor?: boolean;
}

export interface StagePlan {
  stage: PaidStage;
  endpointKey: string;
  endpointId: string;
  /** Calls (images, candidates or clips). */
  units: number;
  /** USD micros per call. */
  unitMicros: number;
  totalMicros: number;
  note: string;
}

const micros = (usd: number): number => Math.round(usd * 1_000_000);

function endpointByRole(reg: Pick<GenAiRegistry, 'endpoints'>, role: EndpointEntry['role'], preferActive = true): EndpointEntry {
  const all = Object.values(reg.endpoints).filter((e) => e.role === role);
  const pick = (preferActive ? all.find((e) => e.status === 'active') : undefined) ?? all[0];
  if (pick === undefined) throw new Error(`the registry has no endpoint with role ${role}`);
  return pick;
}

function endpointByKey(reg: Pick<GenAiRegistry, 'endpoints'>, key: string): EndpointEntry {
  const e = reg.endpoints[key];
  if (e === undefined) throw new Error(`the registry has no endpoint ${key}`);
  return e;
}

export interface PlanOptions {
  /** Bill the soul's signature clips too (buffer-funded, DL-OWN-01). */
  withMoves?: boolean;
}

/** The paid stages of one character with their price. Zero vendor calls. */
export function stagePlans(subject: Pick<CharacterSubject, 'pipeline' | 'moves'>, registry: Pick<GenAiRegistry, 'endpoints'>, opts: PlanOptions = {}): StagePlan[] {
  const reg = withLeanEndpoints(registry);
  const plans: StagePlan[] = [];
  const add = (stage: PaidStage, e: EndpointEntry, units: number, unitMicros: number, note: string): void => {
    plans.push({ stage, endpointKey: e.id, endpointId: e.id, units, unitMicros, totalMicros: units * unitMicros, note });
  };
  if (subject.pipeline === 'standard') {
    const sheet = endpointByRole(reg, 'sheet');
    add('sheet', sheet, 3, micros(sheet.price.usd) + SHEET_EXTRA_REFS * EXTRA_REF_MICROS, '3 sheets at 2560x1440 high, 3 extra references each');
    add('portrait', sheet, 2, PORTRAIT_MICROS, '2 portraits at 1024x1024');
    add('mouth_atlas', sheet, 2, PORTRAIT_MICROS, '2 mouth atlases at 1024x1024');
    const mesh = endpointByRole(reg, 'mesh');
    add('mesh', mesh, 2, micros(mesh.price.usd), '2 candidates');
    const rig = endpointByRole(reg, 'rig');
    const clips = BASE_CLIP_IDS.length + (opts.withMoves === true ? subject.moves.length : 0);
    add('rig', rig, 1, micros(rig.price.usd) + clips * CLIP_MICROS, `rig plus ${clips} clips`);
  } else {
    const sheet = endpointByRole(reg, 'sheet_lean');
    add('sheet', sheet, 4, micros(sheet.price.usd), '4 attempts at 2K');
    const mesh = endpointByKey(reg, LEAN_MESH_KEY);
    add('mesh', mesh, 2, micros(mesh.price.usd), '2 candidates, standard textures');
    const rig = endpointByKey(reg, LEAN_RIG_KEY);
    add('rig', rig, 1, micros(rig.price.usd), 'base rig, walk and run included');
  }
  return plans;
}

export const estimateMicros = (plans: readonly StagePlan[]): number => plans.reduce((n, p) => n + p.totalMicros, 0);

// ---------------------------------------------------------------------------------------------------------------------------------
// Prompts. Every template carries the "no text, no logos" clause (lint rule 5) and fills one closed slot: the soul's visual brief.

export const PROMPT_TEMPLATES = {
  'character-sheet': {
    version: 1,
    body: 'Character turnaround sheet, a 2 by 2 grid of four equal cells: front and left in the top row, back and right in the bottom row. One full-body figure per cell, standing in a T-pose with both arms held horizontal, feet apart, flat neutral light, plain mid-grey background, stylized cel look of the style bible, original design. Character: {subject_brief}. No text, no logos, no labels, no watermark.',
  },
  'character-sheet-lean': {
    version: 1,
    body: 'Character turnaround sheet, a 2 by 2 grid of four equal cells: front and left in the top row, back and right in the bottom row. One full-body figure per cell, T-pose with both arms horizontal, flat neutral light, plain mid-grey background, stylized cel look, original design. Character: {subject_brief}. No text, no logos, no labels, no watermark.',
  },
  'character-portrait': {
    version: 1,
    body: 'Head and shoulders portrait of the same character as the input, facing the camera, neutral expression, flat neutral light, plain mid-grey background, same stylized cel look. Character: {subject_brief}. No text, no logos, no watermark.',
  },
  'character-mouth-atlas': {
    version: 1,
    body: 'A 3 by 3 grid of nine mouth shapes of the same character as the input, cropped to the lower face, one shape per cell, in order: closed, slightly open, wide open, rounded, teeth on lip, tongue up, wide smile, small oo, rest. Same stylized cel look, flat background. Character: {subject_brief}. No text, no logos, no labels.',
  },
  'character-mesh': {
    version: 1,
    body: 'Stylized game character in a T-pose, matching all four views exactly, clean hands and feet, no accessories floating away from the body. Character: {subject_brief}. No text, no logos.',
  },
} as const;
export type TemplateId = keyof typeof PROMPT_TEMPLATES;

export function fillTemplate(id: TemplateId, subjectBrief: string): { template: `${string}@${number}`; text: string; sha256: string } {
  const t = PROMPT_TEMPLATES[id];
  const text = t.body.replace('{subject_brief}', subjectBrief.trim());
  return { template: `${id}@${t.version}`, text, sha256: sha256Hex(text) };
}

/** A deterministic seed in 0..4294967295 for a stage, candidate and attempt (a retake is a new attempt and so a new job key). */
export function stageSeed(slug: string, stage: string, candidate: number, attempt = 0): number {
  return parseInt(sha256Hex(`${slug}|${stage}|${candidate}|${attempt}`).slice(0, 8), 16);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Jobs

export interface StageInput {
  role: string;
  sha256: string;
  origin: InputFile['origin'];
  realHumanVisible?: boolean;
}

export interface BuildJobInput {
  subject: CharacterSubject;
  stage: PaidStage;
  plan: StagePlan;
  /** 0-based candidate index for the stages that produce candidates (mesh: 0 or 1). */
  candidate?: number;
  attempt?: number;
  inputs: readonly StageInput[];
  registry: Pick<GenAiRegistry, 'endpoints'>;
  env?: GenJob['env'];
  requestedBy: string;
  runId?: string;
  /** Extra vendor params merged over the defaults (tests). */
  params?: Record<string, unknown>;
}

const STAGE_KIND: Readonly<Record<PaidStage, GenKind>> = { sheet: 'sheet', portrait: 'portrait', mouth_atlas: 'mouth_atlas', mesh: 'mesh', rig: 'rig' };

function templateFor(stage: PaidStage, tier: PipelineTier): TemplateId {
  if (stage === 'sheet') return tier === 'lean' ? 'character-sheet-lean' : 'character-sheet';
  if (stage === 'portrait') return 'character-portrait';
  if (stage === 'mouth_atlas') return 'character-mouth-atlas';
  return 'character-mesh';
}

/** Vendor parameters of a stage. File inputs are not here: `InputFile.sha256` names them and the executor presents them at submit. */
export function stageParams(subject: CharacterSubject, stage: PaidStage, plan: StagePlan, seed: number, withMoves = false): Record<string, unknown> {
  const base: Record<string, unknown> = { seed, characters: [{ id: subject.slug }] };
  switch (stage) {
    case 'sheet':
      return subject.pipeline === 'lean'
        ? { ...base, num_images: plan.units, resolution: '2K', output_format: 'png' }
        : { ...base, num_images: plan.units, quality: 'high', background: 'opaque', image_size: { width: 2560, height: 1440 }, output_format: 'png' };
    case 'portrait':
    case 'mouth_atlas':
      return { ...base, num_images: plan.units, quality: 'high', background: 'opaque', image_size: { width: 1024, height: 1024 }, output_format: 'png' };
    case 'mesh':
      return subject.pipeline === 'lean'
        ? { ...base, texture: 'standard', face_limit: targetTris(subject.hero) }
        : {
            ...base,
            pose_mode: 't-pose', target_polycount: targetTris(subject.hero), topology: 'triangle', should_remesh: true, enable_pbr: true,
            symmetry_mode: 'auto', enable_rigging: false, enable_animation: false,
          };
    case 'rig':
      return subject.pipeline === 'lean'
        ? { ...base, height_meters: subject.heightM }
        : { ...base, height_meters: subject.heightM, animation_action_ids: [...BASE_CLIP_IDS, ...(withMoves ? subject.moves : [])] };
  }
}

export function buildStageJob(i: BuildJobInput): GenJob {
  const { subject, stage, plan } = i;
  const tpl = fillTemplate(templateFor(stage, subject.pipeline), subject.visualBrief);
  const seed = stageSeed(subject.slug, stage, i.candidate ?? 0, i.attempt ?? 0);
  const params = { ...stageParams(subject, stage, plan, seed), ...(stage === 'mesh' && subject.pipeline === 'standard' ? { texture_prompt: tpl.text.slice(0, 600) } : {}), ...(i.params ?? {}) };
  const endpoint = withLeanEndpoints(i.registry).endpoints[plan.endpointKey];
  if (endpoint === undefined) throw new Error(`the registry has no endpoint ${plan.endpointKey}`);
  const inputs: InputFile[] = i.inputs.map((f) => ({ role: f.role, sha256: f.sha256, origin: f.origin, realHumanVisible: f.realHumanVisible === true }));
  const key = jobKey({
    kind: STAGE_KIND[stage],
    endpointId: endpoint.id,
    pinnedUpdatedAt: endpoint.pinnedUpdatedAt,
    params,
    inputSha256: inputs.map((f) => f.sha256),
    promptTemplate: tpl.template,
    promptSha256: tpl.sha256,
    soulVersion: subject.soulVersion,
    tier: subject.tier,
    recipe: CHARACTER_RECIPE,
  });
  return {
    schema: 'genjob/1',
    jobKey: key,
    kind: STAGE_KIND[stage],
    endpointKey: endpoint.id,
    env: i.env ?? 'production',
    subject: { assetRef: `character/${subject.slug}`, npcId: subject.slug, soulVersion: subject.soulVersion },
    // The filled prompt rides in params so the gate lints exactly what the vendor receives.
    params: { ...params, prompt: tpl.text },
    inputs,
    promptTemplate: tpl.template,
    promptSha256: tpl.sha256,
    // One request: a mesh candidate is one call of its own, every other stage is one call that returns `units` outputs.
    budgetUsdMicros: stage === 'mesh' ? plan.unitMicros : plan.totalMicros,
    ...(i.runId !== undefined ? { runId: i.runId } : {}),
    requestedBy: i.requestedBy,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Work files and run record

export const workDir = (slug: string): string => `work/character/${slug}`;
export const stageDir = (slug: string, stage: string, key: string): string => `${workDir(slug)}/${stage}/${key}`;
export const resultKey = (slug: string, stage: string, key: string): string => `${stageDir(slug, stage, key)}/result.json`;
export const runKey = (slug: string): string => `${workDir(slug)}/run.json`;
export const reportKey = (slug: string, stage: string): string => `${workDir(slug)}/reports/${stage}.json`;

/** Run id: stable for a slug, soul version and tier, so a second run finds the first run's files and decisions. */
export const runIdOf = (s: Pick<CharacterSubject, 'slug' | 'soulVersion' | 'pipeline'>): string => `${s.slug}-${sha256Hex(`${s.slug}|${s.soulVersion}|${s.pipeline}`).slice(0, 8)}`;

export interface StageFile {
  name: string;
  /** File name under the stage directory. */
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
  /** The vendor CDN URL (it expires; the file is already copied). */
  sourceUrl: string;
}

/** What a stage call left behind; its presence under the job key is the cache hit. */
export interface StageResult {
  schema: 'char-stage-result/1';
  stage: PaidStage;
  jobKey: string;
  endpointId: string;
  requestId: string;
  costUsdMicros: number;
  files: StageFile[];
  /** Set when the vendor refused the job (HTTP 422 on a rig, for instance); the stage then holds no files. */
  error?: { type: string; message: string };
  generatedAt: string;
}

export interface ReviewEntry {
  gate: string;
  by: string;
  at: string;
  decision: 'approve' | 'reject';
  note?: string;
  /** The 1-based choice of an H gate (the sheet, mesh or portrait picked). */
  choose?: number;
  /** H2 only: the mouth atlas picked, when different from `choose`. */
  atlas?: number;
  /** H4 only: what the spot-check recorded (`mouthAnchor`, `jaw`, `fingers`). */
  data?: Record<string, unknown>;
}

export interface RunRecord {
  schema: 'char-run/1';
  runId: string;
  slug: string;
  tier: PipelineTier;
  soulVersion: number;
  /** Job keys per stage, in the order the executor used them (mesh has two). */
  jobs: Partial<Record<PaidStage, string[]>>;
  review: ReviewEntry[];
  /** Mesh candidates (0 or 1) that the rig refused with a 422. */
  rigRejected: number[];
  updatedAt: string;
}

export function newRun(s: CharacterSubject, at: string): RunRecord {
  return { schema: 'char-run/1', runId: runIdOf(s), slug: s.slug, tier: s.pipeline, soulVersion: s.soulVersion, jobs: {}, review: [], rigRejected: [], updatedAt: at };
}

/** The latest decision of a gate, or null. A later `reject` overrides an earlier `approve`. */
export function decisionOf(run: Pick<RunRecord, 'review'>, gate: HumanGateId): ReviewEntry | null {
  for (let i = run.review.length - 1; i >= 0; i--) {
    const r = run.review[i];
    if (r !== undefined && r.gate === gate) return r;
  }
  return null;
}

export const approvedDecision = (run: Pick<RunRecord, 'review'>, gate: HumanGateId): ReviewEntry | null => {
  const d = decisionOf(run, gate);
  return d !== null && d.decision === 'approve' ? d : null;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Classifying a fal result

export interface RawOutput {
  name: string;
  url: string;
  contentType: string;
}

/** Output objects of a fal result JSON: every object with an http(s) or mock URL, with its JSON path. */
export function findOutputs(result: unknown): RawOutput[] {
  const out: RawOutput[] = [];
  const walk = (v: unknown, p: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, p === '' ? String(i) : `${p}.${i}`));
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['url'] === 'string' && /^(https?|mock):\/\//.test(o['url'])) {
        out.push({ name: p === '' ? 'output' : p, url: o['url'], contentType: typeof o['content_type'] === 'string' ? o['content_type'] : guessType(o['url']) });
      } else for (const [k, x] of Object.entries(o)) walk(x, p === '' ? k : `${p}.${k}`);
    }
  };
  walk(result, '');
  return out;
}

function guessType(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export const isImage = (f: Pick<RawOutput, 'contentType'>): boolean => f.contentType.startsWith('image/');
export const isGlb = (f: Pick<RawOutput, 'contentType' | 'url'>): boolean => f.contentType === 'model/gltf-binary' || (f.url.split('?')[0]?.toLowerCase().endsWith('.glb') ?? false);

/** File name a stage output is stored under: `<stage>-<n>.<ext>` in output order. */
export function outputFileName(stage: PaidStage, index: number, contentType: string): string {
  const ext = contentType === 'model/gltf-binary' ? 'glb' : contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : contentType.startsWith('image/') ? 'png' : 'bin';
  return `${stage}-${index + 1}.${ext}`;
}

/** An error type that means the vendor refused this input (the rig falls to the second mesh candidate). */
export const isRefusal = (type: string): boolean => /422|unprocessable|validation|invalid/i.test(type);

/** A `FalPort` that can also list the files of a finished call (the character stages return images and GLBs, not one video). */
export interface CharacterFalPort extends FalPort {
  outputs(sub: FalSubmission): Promise<RawOutput[]>;
}
