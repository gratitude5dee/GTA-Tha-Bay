/**
 * The generation gate (spec/domains/05-assets.md sections 5.1 and 5.4). `assertStageAllowed` runs at the entry of every
 * stage that costs money or publishes. Static rules (tier, kill state, provider status, prompt lint) run at every stage;
 * submit-time rules (kill switches, governor level) run from `budget-reserve` on, because a cache hit is always served
 * (D-28) and the cache check comes before the money stages.
 *
 * Production and FAL_MODE=live need a provider `cleared` by ADR-GENAI-01; while every provider is `pending` the gate
 * refuses with ENDPOINT_NOT_CLEARED before any FalPort call.
 */
import { isBannedEndpoint, type GateCode, type GateVerdict, type GenAiRegistry, type GenJob, type GovLevel } from '@dv/shared';
import type { GenPorts, RosterEntry } from './ports.ts';

export type GateStage =
  | 'gate' | 'cache-check' | 'budget-reserve' | 'acquire' | 'keyframes' | 'plan' | 'submit' | 'copy-orig'
  | 'transcode' | 'resign' | 'publish' | 'record';

/** Stages where money is reserved or spent: kill switches and the governor level apply from here on. */
const SUBMIT_TIME_STAGES: ReadonlySet<GateStage> = new Set<GateStage>(['budget-reserve', 'acquire', 'keyframes', 'submit']);

export interface PromptLintResult {
  ok: boolean;
  code?: GateCode;
  detail?: string;
}

/**
 * Prompt-lint hook. The linter itself (`lintPrompt` in @dv/shared, real names from the private names file, DL-550) lands in
 * M05b2; until then the stub fails on an empty prompt.
 */
export type PromptLinter = (text: string) => PromptLintResult;

export const stubPromptLinter: PromptLinter = (text) =>
  text.trim().length === 0 ? { ok: false, code: 'POLICY_REFUSED', detail: 'empty prompt' } : { ok: true };

export interface GateConfig {
  falMode: 'mock' | 'live';
  /** The Worker's ENVIRONMENT var: prod | staging | preview | dev. */
  environment: string;
  registry: Pick<GenAiRegistry, 'endpoints' | 'videoProviders' | 'banned'>;
  lintPrompt?: PromptLinter;
}

export interface GateInputs extends GateConfig {
  killSwitches: ReadonlySet<string>;
  govLevel: GovLevel;
  /** Roster rows for the characters of the job; a missing id maps to null. */
  roster: ReadonlyMap<string, RosterEntry | null>;
}

const refuse = (code: GateCode, detail: string): GateVerdict => ({ ok: false, code, detail });

function jobCharacters(job: GenJob): string[] {
  const raw = job.params['characters'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => (typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string' ? [(c as { id: string }).id] : []));
}

function jobPrompts(job: GenJob): string[] {
  const out: string[] = [];
  if (typeof job.params['prompt'] === 'string') out.push(job.params['prompt']);
  const shots = job.params['shots'];
  if (Array.isArray(shots)) {
    for (const s of shots) {
      const p = (s as { prompt?: unknown } | null)?.prompt;
      if (typeof p === 'string') out.push(p);
    }
  }
  return out;
}

function providerEndpointIds(job: GenJob, reg: GateConfig['registry']): { ids: string[]; cleared: boolean; pending: boolean } | null {
  if (job.kind === 'cutscene_shot') {
    const p = reg.videoProviders[job.endpointKey];
    if (!p) return null;
    return { ids: Object.values(p.endpoints).filter((v): v is string => typeof v === 'string'), cleared: p.licence.status === 'cleared', pending: p.licence.status !== 'cleared' };
  }
  const e = reg.endpoints[job.endpointKey];
  if (!e) return null;
  return { ids: [e.id], cleared: e.status === 'active', pending: e.status === 'pending' };
}

/** Pure evaluation over prefetched inputs. */
export function evaluateGate(job: GenJob, stage: GateStage, g: GateInputs): GateVerdict {
  // 1. roster: unknown tier, minors, killed scopes
  for (const id of jobCharacters(job)) {
    const row = g.roster.get(id) ?? null;
    if (row === null) return refuse('TIER_UNKNOWN', `no roster entry for ${id}`);
    if (row.minor === true) return refuse('TIER_UNKNOWN', `${id} is flagged minor`);
    if (row.killed.includes('all') || row.killed.includes('cutscene')) return refuse('KILLED', `${id} is killed for cutscenes`);
    if (row.tier !== 'consented') {
      if (job.inputs.some((f) => f.origin === 'consented_photo' || f.origin === 'user_upload' || f.realHumanVisible)) {
        return refuse('FACE_REF_FORBIDDEN', `${id}: only first-party files may feed a non-consented cast`);
      }
      if (job.params['preset'] !== 'toon-pbr') return refuse('PHOTOREAL_FORBIDDEN', `${id}: non-consented casts use the toon-pbr preset`);
    }
  }

  // 2. provider
  const provider = providerEndpointIds(job, g.registry);
  if (provider === null) return refuse('ENDPOINT_NOT_CLEARED', `unknown endpoint ${job.endpointKey}`);
  for (const id of provider.ids) {
    if (isBannedEndpoint(g.registry, id)) return refuse('ENDPOINT_BANNED', `${id} is banned`);
  }
  const needsCleared = g.falMode === 'live' || g.environment === 'prod' || job.env === 'production';
  if (needsCleared && !provider.cleared) {
    return refuse('ENDPOINT_NOT_CLEARED', `${job.endpointKey} is not cleared (ADR-GENAI-01); ${g.falMode === 'live' ? 'live' : g.environment} calls are refused`);
  }

  // 3. prompt lint
  const lint = g.lintPrompt ?? stubPromptLinter;
  const prompts = jobPrompts(job);
  if (prompts.length === 0) {
    const r = lint('');
    if (!r.ok) return refuse(r.code ?? 'POLICY_REFUSED', r.detail ?? 'prompt refused');
  }
  for (const p of prompts) {
    const r = lint(p);
    if (!r.ok) return refuse(r.code ?? 'NAME_IN_PROMPT', r.detail ?? 'prompt refused');
  }

  // 4. submit-time rules
  if (SUBMIT_TIME_STAGES.has(stage)) {
    const ks = g.killSwitches;
    if (ks.has('ks:genai:all') || ks.has('ks:fal') || ks.has('ks:cutscene_gen') || provider.ids.some((id) => ks.has(`ks:fal:${id}`))) {
      return refuse('KILL_SWITCH', 'a kill switch stops new generation');
    }
    if (g.govLevel >= 3) return refuse('BUDGET', 'the budget governor is at level 3');
  }
  return { ok: true };
}

/** Spec signature: reads flags, level and roster through the ports, then evaluates. */
export async function assertStageAllowed(job: GenJob, stage: GateStage, ports: Pick<GenPorts, 'roster' | 'flags' | 'budget'>, cfg: GateConfig): Promise<GateVerdict> {
  const ids = jobCharacters(job);
  const roster = new Map<string, RosterEntry | null>();
  for (const id of ids) roster.set(id, await ports.roster.lookup(id));
  const [killSwitches, govLevel] = SUBMIT_TIME_STAGES.has(stage) ? await Promise.all([ports.flags.killSwitches(), ports.budget.level()]) : [new Set<string>(), 0 as GovLevel];
  return evaluateGate(job, stage, { ...cfg, killSwitches, govLevel, roster });
}
