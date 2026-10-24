/**
 * The Monte-Carlo runner of the Tycoon balance tool (08-tycoon-events.md section 8). Run `i` uses `seed_i = splitmix32(seedBase + i)`
 * and the same `setupFromSeed` as the game, so the harness plays exactly what the player plays. No wall clock decides anything,
 * no LLM, no network: negotiations take the offline midpoint path. Uses only `@dv/shared/tycoon` public exports.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { splitmix32 } from '../../../packages/shared/src/rng.ts';
import {
  applyCommand,
  buildContent,
  hashCompany,
  newRun,
  policyView,
  replay,
  setupFromSeed,
  stepWeek,
  finance,
  type ChoiceRecord,
  type Command,
  type CompanyState,
  type EventDef,
  type RunResult,
  type TycoonContent,
} from '../../../packages/shared/src/tycoon/index.ts';
import { toolsRoot } from '../lib/common.ts';
import { CtrRng, shippedPolicies, type Policy } from './policies.ts';

export const MAX_WEEKS = 400;
export const LETHAL_WINDOW_WEEKS = 10;
/** A root event only counts as lethal if the company was healthy when it fired. */
export const HEALTHY_RUNWAY_WEEKS = 12;
export const HEALTHY_FOUNDER_MORALE = 40;

// ---------------------------------------------------------------------------------------------------------------- content

export interface LoadOptions {
  root?: string;
  /** Directory of `sectors.json`, `theses.json`, `archetypes.json` and `events/*.json`. */
  contentDir?: string;
  balanceFile?: string;
  /** Extra event files (`{events, locale?}`), merged into the catalog. */
  extraEventFiles?: string[];
  /** Dotted paths into the content (`balance.end.unicornPostMoneyCents`, `sectors.b2b-saas.cac0Cents`) and their new values. */
  patch?: Record<string, unknown>;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** A balance file is either a full `tycoon.balance.v1` document or a fixture `{patch, perPolicy?}`. */
export interface BalanceFixture {
  patch?: Record<string, unknown>;
  perPolicy?: Record<string, Record<string, unknown>>;
}

export function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i] as string];
    if (typeof next !== 'object' || next === null) throw new Error(`tycoon-sim: patch path ${dotted} does not exist (at ${parts[i]})`);
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
}

/** Reads and validates the content from disk. The versions are computed from the unpatched files. */
export function loadContent(opts: LoadOptions = {}): TycoonContent {
  const root = opts.root ?? toolsRoot;
  const dir = path.join(root, opts.contentDir ?? 'content/tycoon');
  const events = readdirSync(path.join(dir, 'events')).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(path.join(dir, 'events', f)) as Record<string, unknown>);
  const locale = { ...(readJson(path.join(root, 'content/ui/i18n/en.json')) as Record<string, string>) };
  for (const f of opts.extraEventFiles ?? []) {
    const x = readJson(path.isAbsolute(f) ? f : path.join(root, f)) as { events: EventDef[]; locale?: Record<string, string> };
    events.push({ schema: 'tycoon.events.v1', events: x.events });
    Object.assign(locale, x.locale ?? {});
  }
  let balance = readJson(path.join(root, opts.balanceFile ?? 'config/tycoon.balance.json')) as Record<string, unknown>;
  let patch = opts.patch;
  if (balance['schema'] !== 'tycoon.balance.v1') {
    // a fixture: the patch applies over the shipped balance
    const fx = balance as BalanceFixture;
    patch = { ...(fx.patch ?? {}), ...(patch ?? {}) };
    balance = readJson(path.join(root, 'config/tycoon.balance.json')) as Record<string, unknown>;
  }
  const base = buildContent({
    sectors: readJson(path.join(dir, 'sectors.json')),
    theses: readJson(path.join(dir, 'theses.json')),
    archetypes: readJson(path.join(dir, 'archetypes.json')),
    balance,
    events,
    locale,
  });
  if (!patch || Object.keys(patch).length === 0) return base;
  return patchContent(base, patch);
}

/** A copy of `content` with dotted-path values replaced (keeps the version strings of the unpatched content). */
export function patchContent(content: TycoonContent, patch: Record<string, unknown>): TycoonContent {
  const copy = structuredClone(content) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) setPath(copy, k, v);
  return copy as unknown as TycoonContent;
}

export const vcInfoOf = (c: TycoonContent) => (id: string): { min: number; max: number; bias: number } | undefined => {
  const d = c.archetypes.vcs.find((v) => v.id === id);
  return d ? { min: d.checkMin, max: d.checkMax, bias: d.valuationBias } : undefined;
};

// ---------------------------------------------------------------------------------------------------------------- one run

export interface FiredRecord {
  defId: string;
  week: number;
  origin: string;
  healthy: boolean;
  choice: boolean;
}
export interface RunRecord {
  index: number;
  seed: number;
  weeks: number;
  kind: string;
  win: boolean;
  score: number;
  timedOut: boolean;
  /** SAFE and priced rounds that closed. */
  reached: string[];
  dilutionsPct: number[];
  fired: FiredRecord[];
  suppressed: number;
  lethal: string[];
  offersOutOfBand: number;
  captableInvariant: number;
  payoutMismatch: number;
  stuck: number;
  refused: number;
  setup: ReturnType<typeof setupFromSeed>;
  choices: ChoiceRecord[];
  hash: string;
  result: RunResult | null;
}

const LOSS_KINDS = new Set(['insolvent', 'ousted', 'burnout']);

function envelopeViolation(cmd: Command, view: ReturnType<typeof policyView>): boolean {
  if (cmd.t !== 'counter') return false;
  const env = view.meeting?.envelope;
  if (!env) return true;
  const t = cmd.terms;
  return t.amount < env.amount[0] || t.amount > env.amount[1] || t.preMoney < env.preMoney[0] || t.preMoney > env.preMoney[1] || t.poolTargetBp < env.poolTargetBp[0] || t.poolTargetBp > env.poolTargetBp[1];
}

export function runSeed(content: TycoonContent, policy: Policy, seed: number, index: number, maxWeeks = MAX_WEEKS): RunRecord {
  const setup = setupFromSeed(seed, undefined, content);
  const s: CompanyState = newRun(setup, content);
  const rng = new CtrRng(seed, `bot:${policy.id}`);
  const choices: ChoiceRecord[] = [];
  const fired: FiredRecord[] = [];
  const hasChoices = new Set(content.events.filter((d) => d.choices && d.choices.length > 0).map((d) => d.id));
  let seq = 0;
  let seqWeek = -1;
  let offersOutOfBand = 0;
  let stuck = 0;
  let refused = 0;
  let timedOut = false;
  const issue = (cmd: Command): boolean => {
    if (envelopeViolation(cmd, policyView(s, content))) offersOutOfBand++;
    const r = applyCommand(s, cmd, content);
    if (!r.ok) {
      refused++;
      return false;
    }
    if (s.week !== seqWeek) {
      seqWeek = s.week;
      seq = 0;
    }
    choices.push({ week: s.week, seq: seq++, cmd });
    return true;
  };

  const ended = (): boolean => s.phase === 'ended';
  while (!ended()) {
    if (s.week >= maxWeeks) {
      timedOut = true;
      issue({ t: 'endRun', reason: 'quit' });
      break;
    }
    for (let pass = 0; pass < 8 && !ended(); pass++) {
      const cmds = policy.decide(policyView(s, content), rng);
      if (cmds.length === 0) break;
      let ok = false;
      for (const cmd of cmds) {
        if (issue(cmd)) ok = true;
        if (ended()) break;
      }
      if (!ok) break;
    }
    if (ended()) break;
    if (s.awaiting !== null) {
      // the policy did not answer: take the safe answer and count it
      stuck++;
      const v = policyView(s, content);
      if (s.awaiting === 'event') for (const i of v.inbox) issue({ t: 'resolveEvent', iid: i.iid, choiceId: i.defaultChoiceId });
      else if (s.awaiting === 'board') issue({ t: 'boardVote', motion: 'approveBudget' });
      else if (s.awaiting === 'bridge') issue({ t: 'bridge', accept: true });
      else if (v.meeting) issue({ t: 'walk', meetingId: v.meeting.id });
      if (s.awaiting !== null) {
        issue({ t: 'endRun', reason: 'quit' });
        break;
      }
    }
    const runwayBefore = policyView(s, content).runwayWeeks;
    const healthy = runwayBefore >= HEALTHY_RUNWAY_WEEKS && s.founderMorale >= HEALTHY_FOUNDER_MORALE;
    const res = stepWeek(s, content);
    for (const e of res.events) fired.push({ defId: e.defId, week: e.firedWeek, origin: e.origin, healthy, choice: hasChoices.has(e.defId) });
  }

  const result = s.result;
  const kind = result?.kind ?? 'none';
  const lethal: string[] = [];
  if (result && LOSS_KINDS.has(kind)) {
    for (const f of fired) {
      if (f.origin === 'roll' && f.healthy && result.week - f.week <= LETHAL_WINDOW_WEEKS && !lethal.includes(f.defId)) lethal.push(f.defId);
    }
  }
  // a deal that collapses at the close (a SAFE stack over its limit after a re-trade) is play; a broken cap table is a bug
  const captableInvariant = s.events.counts['closeFail.CAPTABLE_INVARIANT'] ?? 0;
  let payoutMismatch = 0;
  if (result) {
    const E = Math.max(0, Math.floor(result.exitValueCents));
    const p = finance.waterfall(E, finance.settleSafes(s.capTable, E));
    let sum = 0;
    for (const id of Object.keys(p.byHolder)) sum += p.byHolder[id] as number;
    if (p.total !== E || sum !== E) payoutMismatch = 1;
  }
  const reached: string[] = [];
  if (s.capTable.safes.length > 0) reached.push('safe');
  const dilutionsPct: number[] = [];
  for (const r of s.capTable.rounds) {
    if (r.closedWeek === null) continue;
    reached.push(r.kind);
    if (r.kind === 'seed' || r.kind === 'a') dilutionsPct.push(Math.round((10_000 * r.amount) / (r.preMoney + r.amount)) / 100);
  }
  return {
    index,
    seed,
    weeks: s.week,
    kind,
    win: result?.win ?? false,
    score: result?.score ?? 0,
    timedOut,
    reached,
    dilutionsPct,
    fired,
    suppressed: s.events.counts['suppressed'] ?? 0,
    lethal,
    offersOutOfBand,
    captableInvariant,
    payoutMismatch,
    stuck,
    refused,
    setup,
    choices,
    hash: hashCompany(s),
    result,
  };
}

export const seedOf = (seedBase: number, i: number): number => splitmix32((seedBase + i) | 0);

/** Replays a run from `(setup, choices)`; true when the result and the final state hash equal the live run. */
export function replayMatches(content: TycoonContent, r: RunRecord): boolean {
  try {
    const out = replay(r.setup, r.choices, content);
    return out.hash === r.hash && JSON.stringify(out.result) === JSON.stringify(r.result);
  } catch {
    return false;
  }
}

export interface PolicySet {
  /** Policy id to the content it plays on (a fixture patches the content of one policy). */
  policies: Record<string, { policy: Policy; content: TycoonContent }>;
}

/** The shipped policies on `content`; `perPolicy` patches give single policies their own content. */
export function buildPolicies(content: TycoonContent, perPolicy: Record<string, Record<string, unknown>> = {}, extra: Policy[] = []): PolicySet {
  const out: PolicySet['policies'] = {};
  for (const [id, p] of Object.entries(shippedPolicies(vcInfoOf(content)))) {
    const c = perPolicy[id] ? patchContent(content, perPolicy[id] as Record<string, unknown>) : content;
    out[id] = { policy: p, content: c };
  }
  for (const p of extra) out[p.id] = { policy: p, content: perPolicy[p.id] ? patchContent(content, perPolicy[p.id] as Record<string, unknown>) : content };
  return { policies: out };
}

export function playPolicyRuns(content: TycoonContent, policy: Policy, runs: number, seedBase: number, maxWeeks = MAX_WEEKS): RunRecord[] {
  const out: RunRecord[] = [];
  for (let i = 0; i < runs; i++) out.push(runSeed(content, policy, seedOf(seedBase, i), i, maxWeeks));
  return out;
}
