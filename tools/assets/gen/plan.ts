/**
 * assets:gen plan (M10a1; spec/domains/05-assets-pipeline.md section 12): the jobs, the estimate and the gate verdict of every matching
 * roster entry, with zero vendor calls and zero network requests.
 *
 *   --roster <file> --tier standard|lean|all [--slugs a,b] [--with-moves]
 *
 * Rules (the milestone's Scope in): only `active` entries; a Standard estimate above 3,730,000 micros is refused (DL-172); an entry with
 * `research: pending`, a verdict that is not `ok`, a missing soul or the `premium` preset is listed `blocked:<reason>` with its estimate
 * still reserved; a batch whose ledger plus estimate passes the characters line (42,000,000 micros) or the program (100,000,000) is refused.
 * The job keys printed are plan keys (identity of the stage without input hashes); the run adds the hashes of the files it feeds.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { assetTier, type NpcRosterEntry, type NpcRosterManifest, type SoulFrontmatter } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { parseSoul } from '../../../packages/shared/src/npc/parse.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { assertStageAllowed, type GateConfig } from '../../../services/pipeline/src/gate.ts';
import type { RosterEntry } from '../../../services/pipeline/src/ports.ts';
import {
  STANDARD_ESTIMATE_LIMIT_MICROS, buildStageJob, estimateMicros, stagePlans, type CharacterSubject, type PaidStage, type PipelineTier, type StagePlan,
} from '../../../services/pipeline/src/steps/character.ts';
import { DEFAULT_CAPS, capRefusal, totals, usd, type LedgerRow, type LineCaps } from './ledger.ts';
import { mapRoster } from './ports.ts';

export interface LoadedEntry {
  entry: NpcRosterEntry;
  subject: CharacterSubject | null;
  /** Why no subject could be built: a missing or invalid soul. */
  problem: string | null;
}

/** Kill flags beside the roster: `{ "<slug>": ["all"] }`. A `retired` entry counts as killed everywhere. */
export type KillFlags = Readonly<Record<string, readonly string[]>>;

export function loadEntries(root: string, roster: NpcRosterManifest, kill: KillFlags = {}): LoadedEntry[] {
  return roster.entries.map((entry) => {
    const pipeline: PipelineTier | null = entry.pipeline === 'standard' || entry.pipeline === 'lean' ? entry.pipeline : null;
    const file = path.resolve(root, entry.soul);
    if (!existsSync(file)) return { entry, subject: null, problem: `soul file ${entry.soul} is missing` };
    let front: SoulFrontmatter;
    try {
      front = parseSoul(readFileSync(file, 'utf8')).front;
    } catch (e) {
      return { entry, subject: null, problem: `soul file ${entry.soul}: ${(e as Error).message}` };
    }
    const killed = [...(kill[entry.id] ?? []), ...(entry.status === 'retired' ? ['all'] : [])];
    if (pipeline === null) return { entry, subject: null, problem: null };
    return {
      entry,
      problem: null,
      subject: {
        slug: entry.id,
        tier: assetTier({ basis: front.likeness.basis, tier: front.tier }),
        soulVersion: front.soulVersion,
        visualBrief: front.visual_brief,
        heightM: front.heightM,
        moves: front.moves,
        standIn: front.standIn,
        pipeline,
        hero: entry.hero || entry.modes.includes('fighter'),
        killed,
        minor: front.minor !== false,
      },
    };
  });
}

export interface PlanRow {
  slug: string;
  pipeline: string;
  status: 'ok' | 'blocked' | 'refused';
  /** `blocked:<reason>` or `refused: <message>`; empty for ok. */
  reason: string;
  verdict: string;
  stages: (StagePlan & { planKey: string })[];
  estimateMicros: number;
}

export interface PlanResult {
  header: string[];
  rows: PlanRow[];
  /** Estimate of the ok rows plus the blocked rows (reserved). Refused rows are not in the batch. */
  batchMicros: number;
  ledgerMicros: number;
  /** The reason the whole batch is refused, or null. */
  refused: string | null;
}

export interface PlanInput {
  entries: readonly LoadedEntry[];
  tier: 'standard' | 'lean' | 'all';
  slugs?: readonly string[];
  registry: GenAiRegistry;
  ledgerRows: readonly LedgerRow[];
  caps?: LineCaps;
  gate: GateConfig;
  realNames?: readonly string[] | null;
  withMoves?: boolean;
  /** ADR-GENAI-01 state noted in the header. */
  adrState?: string;
}

export async function planBatch(i: PlanInput): Promise<PlanResult> {
  const caps = i.caps ?? DEFAULT_CAPS;
  const t = totals(i.ledgerRows);
  const rows: PlanRow[] = [];
  const rosterMap = new Map<string, RosterEntry>();
  for (const e of i.entries) {
    if (e.subject !== null) rosterMap.set(e.entry.id, { id: e.entry.id, tier: e.subject.tier, soulVersion: e.subject.soulVersion, killed: e.subject.killed, ...(e.subject.minor === true ? { minor: true } : {}) });
  }
  const ports = {
    roster: mapRoster(rosterMap),
    flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
    budget: { reserve: () => Promise.resolve({ ok: true, level: 0 as const }), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as const) },
    names: { realNames: () => Promise.resolve(i.realNames ?? null) },
  };
  for (const e of i.entries) {
    if (e.entry.status !== 'active') continue;
    if (i.slugs !== undefined && !i.slugs.includes(e.entry.id)) continue;
    if (i.tier !== 'all' && e.entry.pipeline !== i.tier) continue;
    if (e.entry.pipeline === 'none') continue;
    const base = { slug: e.entry.id, pipeline: e.entry.pipeline, stages: [] as PlanRow['stages'], estimateMicros: 0, verdict: '-' };
    if (e.subject === null) {
      const reason = e.problem !== null ? 'soul' : 'premium';
      rows.push({ ...base, status: 'blocked', reason: `blocked:${reason}${e.problem !== null ? ` (${e.problem})` : ' (the premium preset is not part of M10a1)'}` , });
      continue;
    }
    const plans = stagePlans(e.subject, i.registry, { withMoves: i.withMoves === true });
    const est = estimateMicros(plans);
    const sheetPlan = plans[0] as StagePlan;
    const stages = plans.map((p) => ({ ...p, planKey: buildStageJob({ subject: e.subject as CharacterSubject, stage: p.stage as PaidStage, plan: p, inputs: [], registry: i.registry, requestedBy: 'plan' }).jobKey }));
    const sheetJob = buildStageJob({ subject: e.subject, stage: 'sheet', plan: sheetPlan, inputs: [], registry: i.registry, requestedBy: 'plan' });
    const v = await assertStageAllowed(sheetJob, 'tier-check', ports, i.gate);
    const verdict = v.ok ? 'ok' : v.code;
    let status: PlanRow['status'] = 'ok';
    let reason = '';
    if (e.entry.research === 'pending') {
      status = 'blocked';
      reason = 'blocked:research';
    } else if (!v.ok) {
      status = 'blocked';
      reason = `blocked:${v.code}`;
    } else if (e.subject.pipeline === 'standard' && est > STANDARD_ESTIMATE_LIMIT_MICROS) {
      status = 'refused';
      reason = `refused: the Standard estimate ${est.toLocaleString('en-US')} micros passes ${STANDARD_ESTIMATE_LIMIT_MICROS.toLocaleString('en-US')} (DL-172); the buffer funds it only with owner sign-off`;
    }
    rows.push({ slug: e.entry.id, pipeline: e.entry.pipeline, status, reason, verdict, stages, estimateMicros: est });
  }
  const batchMicros = rows.filter((r) => r.status !== 'refused').reduce((n, r) => n + r.estimateMicros, 0);
  const refused = capRefusal(t, 'characters', batchMicros, caps);
  const header = [
    `assets:gen plan: ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} (tier ${i.tier}), registry checked ${i.registry.checkedAt}, FAL_MODE ${i.gate.falMode}`,
    `ADR-GENAI-01: ${i.adrState ?? 'not consulted (character endpoints are fal image and 3D models, not the video providers)'}`,
    `ledger: ${usd(t.characters)} of ${usd(caps.lines.characters)} on the characters line, ${usd(t.total)} of ${usd(caps.program)} programme`,
    'zero vendor calls; zero network requests',
  ];
  return { header, rows, batchMicros, ledgerMicros: t.characters, refused };
}

export function renderPlan(r: PlanResult): string[] {
  const out = [...r.header];
  for (const row of r.rows) {
    out.push(`${row.slug} [${row.pipeline}] ${row.status === 'ok' ? 'ok' : row.reason}  verdict ${row.verdict}  estimate ${usd(row.estimateMicros)} (${row.estimateMicros.toLocaleString('en-US')} micros)`);
    for (const s of row.stages) {
      out.push(`  ${s.stage.padEnd(11)} ${s.endpointId}  ${s.units} x ${usd(s.unitMicros)} = ${usd(s.totalMicros)}  planKey ${s.planKey.slice(0, 16)}  (${s.note}; run key adds the input hashes)`);
    }
  }
  out.push(`batch ${usd(r.batchMicros)} (${r.batchMicros.toLocaleString('en-US')} micros, blocked entries reserved)`);
  out.push(r.refused ?? 'batch within the characters line and the programme cap');
  return out;
}
