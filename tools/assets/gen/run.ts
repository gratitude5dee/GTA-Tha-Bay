/**
 * assets:gen run --slug <s> --until sheet|mesh|rig [--live] (M10a1; spec/domains/05-assets-pipeline.md section 12).
 *
 * The guards run in this order and none of them calls FalPort:
 *   1. unknown slug, premium preset, or a verdict that is not ok: exit 1 with the reason
 *   2. `--live` while `CI` is set: refuse, exit 1
 *   3. no `--live`: print the dry-run estimate, exit 0
 *   4. `--live` without `FAL_KEY`: print `SKIP … FAL_KEY not set`, exit 0
 * Only after these does `buildLive` construct `QueueFalPort`. A run goes to the next human gate and stops there; a cached `result.json`
 * skips its call; concurrency is `genai.falConcurrency` (2).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { ConsentIndex } from '../../../packages/shared/src/assets/gates/index.ts';
import { compileRealNames } from '../../../packages/shared/src/assets/gates/names.ts';
import { GENAI_GUARDRAILS } from '../../../packages/shared/src/genai/guardrails.generated.ts';
import { PROMPT_LINT_CONFIG } from '../../../services/pipeline/src/registry.ts';
import { stagePlans, estimateMicros, type CharacterSubject, type UntilStage } from '../../../services/pipeline/src/steps/character.ts';
import { heldVision } from '../../../services/pipeline/src/steps/gates.ts';
import type { RosterEntry } from '../../../services/pipeline/src/ports.ts';
import { runCharacter, type ExecutorConfig, type ExecutorPorts, type RunOutcome, type RunUntil } from './executor.ts';
import { LEDGER_FILE, usd } from './ledger.ts';
import { loadWorld, type World } from './plan.ts';
import { LedgerBudget, QueueFalPort, fsBlob, mapRoster } from './ports.ts';
import { fsPublisher } from './stages/publish.ts';
import { BAY_RIG } from './stages/rig.ts';
import { ktxTool } from '../src/optimize.ts';

export const WORK_DIR = '.genai';
export const DEFAULT_STYLE_BIBLE = 'bay-cel@1';
const BUDGETS_FILE = 'config/asset-budgets.json';
const TERMS_FILE = 'docs/legal/vendor-terms/fal-tos-2026-10-18.md';

export interface RunArgs {
  slug: string;
  until: RunUntil;
  live: boolean;
  by: string;
  withMoves: boolean;
  styleBible: string;
  roster: string | undefined;
  registry: string | undefined;
  ledger: string | undefined;
  kill: string | undefined;
}

export function parseRunArgs(argv: readonly string[]): RunArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      slug: { type: 'string' }, until: { type: 'string', default: 'sheet' }, live: { type: 'boolean', default: false }, by: { type: 'string', default: 'art-lead' },
      'with-moves': { type: 'boolean', default: false }, 'style-bible': { type: 'string', default: DEFAULT_STYLE_BIBLE },
      roster: { type: 'string' }, registry: { type: 'string' }, ledger: { type: 'string' }, kill: { type: 'string' },
    },
  });
  if (!values.slug) throw new Error('--slug <slug> is required');
  if (!['sheet', 'mesh', 'rig', 'publish'].includes(values.until as string)) throw new Error('--until must be sheet, mesh, rig or publish');
  return {
    slug: values.slug, until: values.until as RunUntil, live: values.live, by: values.by as string, withMoves: values['with-moves'], styleBible: values['style-bible'] as string,
    roster: values.roster, registry: values.registry, ledger: values.ledger, kill: values.kill,
  };
}

export interface RunDeps {
  root: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  log: (line: string) => void;
  now: () => number;
  /** Test input: replaces the live port construction. */
  buildLive?: (a: RunArgs, w: World, subject: CharacterSubject) => Promise<{ ports: ExecutorPorts; cfg: ExecutorConfig }>;
}

function subjectOf(w: World, slug: string): { subject: CharacterSubject } | { error: string } {
  const e = w.entries.find((x) => x.entry.id === slug);
  if (e === undefined) return { error: `no roster entry ${slug}` };
  if (e.entry.status !== 'active') return { error: `${slug} is ${e.entry.status}, not active` };
  if (e.problem !== null) return { error: `blocked:soul (${e.problem})` };
  if (e.entry.research === 'pending') return { error: 'blocked:research (the research layer is pending, Q-19)' };
  if (e.subject === null) return { error: `${slug} has pipeline ${e.entry.pipeline}: nothing to run` };
  return { subject: e.subject };
}

export async function runCommand(argv: readonly string[], d: RunDeps): Promise<number> {
  let a: RunArgs;
  try {
    a = parseRunArgs(argv);
  } catch (e) {
    d.log(`assets:gen run: ${(e as Error).message}`);
    return 2;
  }
  const w = loadWorld(d.root, { roster: a.roster, registry: a.registry, ledger: a.ledger, kill: a.kill });
  const found = subjectOf(w, a.slug);
  if ('error' in found) {
    d.log(`assets:gen run: ${found.error}`);
    return 1;
  }
  const subject = found.subject;
  const plans = stagePlans(subject, w.registry, { withMoves: a.withMoves });
  const est = estimateMicros(plans);

  // 2. --live is never allowed in CI
  if (a.live && d.env['CI'] !== undefined && d.env['CI'] !== '') {
    d.log('assets:gen run: refused: --live does not run while CI is set (DL-OWN-01: CI never runs live fal)');
    return 1;
  }
  // 3. the dry run
  if (!a.live) {
    d.log(`assets:gen run ${a.slug} [${subject.pipeline}] until ${a.until}: dry run, no vendor call`);
    for (const p of plans) d.log(`  ${p.stage.padEnd(11)} ${p.endpointId}  ${p.units} x ${usd(p.unitMicros)} = ${usd(p.totalMicros)}  (${p.note})`);
    d.log(`  estimate ${usd(est)} (${est.toLocaleString('en-US')} micros); add --live to run it; paid stages reserve in the ledger first`);
    return 0;
  }
  // 4. --live without a key
  if (!d.env['FAL_KEY']) {
    d.log('SKIP assets:gen run --live: FAL_KEY not set (the operator or the art lead holds it, Q-17; never CI)');
    return 0;
  }
  const { ports, cfg } = await (d.buildLive ?? buildLive(d))(a, w, subject);
  d.log(`assets:gen run ${a.slug} [${subject.pipeline}] until ${a.until}: LIVE, estimate ${usd(est)}`);
  const out = await runCharacter(ports, cfg, subject, a.until);
  printOutcome(d.log, out);
  return out.status === 'failed' || out.status === 'refused' ? 1 : 0;
}

export function printOutcome(log: (l: string) => void, out: RunOutcome): void {
  log(`${out.status.toUpperCase()} at ${out.stage}${out.gate !== undefined ? ` (human gate ${out.gate})` : ''}: ${out.detail}`);
  log(`  FalPort calls ${out.falCalls}, spent ${usd(out.spentMicros)}, reports ${out.reports.length}, run ${out.run.runId}`);
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The live ports: fal over the queue, files under `.genai/`, the ledger file, held vision. Built only after the guards. */
function buildLive(d: RunDeps) {
  return async (a: RunArgs, w: World, subject: CharacterSubject): Promise<{ ports: ExecutorPorts; cfg: ExecutorConfig }> => {
    const abs = (p: string): string => path.resolve(d.root, p);
    const clock = { now: d.now };
    const entries = new Map<string, RosterEntry>();
    for (const e of w.entries) if (e.subject !== null) entries.set(e.entry.id, { id: e.entry.id, tier: e.subject.tier, soulVersion: e.subject.soulVersion, killed: e.subject.killed });
    const budget = new LedgerBudget({ file: abs(a.ledger ?? LEDGER_FILE), line: 'characters', clock });
    const lifecycle = (JSON.parse(readFileSync(abs('tools/assets/spike/plan.json'), 'utf8')) as { lifecycleHeader: string }).lifecycleHeader;
    const fal = new QueueFalPort({ key: d.env['FAL_KEY'] as string, fetch: d.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: d.now, lifecycleHeader: lifecycle });
    const matchers = compileRealNames([...PROMPT_LINT_CONFIG.displayNames, ...(w.realNames ?? [])].map((s, i) => ({ id: `n${i}`, real: s })));
    // Vision QA: the Haiku check reaches Anthropic only through the Worker and AI Gateway (CLAUDE.md), and no CLI route exists yet, so the
    // verdict is held for the human gate and the review record says so (Risks: "No ANTHROPIC_API_KEY").
    const vision = heldVision(d.env['ANTHROPIC_API_KEY'] ? 'the CLI has no route to the vision model (Worker and AI Gateway only); the human gate decides' : 'ANTHROPIC_API_KEY not set');
    const budgets = JSON.parse(readFileSync(abs(BUDGETS_FILE), 'utf8')) as { rows: { id: string; fidelity: unknown }[] };
    const row = budgets.rows.find((r) => r.id === (subject.hero ? 'character-hero' : 'character-npc'));
    if (row === undefined) throw new Error(`${BUDGETS_FILE} has no row for ${subject.hero ? 'character-hero' : 'character-npc'}`);
    const sb = abs(`${WORK_DIR}/style-bible/${a.styleBible}.png`);
    const refsDir = abs(`content/npcs/${subject.slug}/refs`);
    const refs = existsSync(refsDir) ? readdirSync(refsDir).filter((f) => f.endsWith('.png')).sort().map((f) => new Uint8Array(readFileSync(path.join(refsDir, f)))) : [];
    const license = JSON.parse(readFileSync(abs('config/license-allowlist.json'), 'utf8')) as { record: string[] };
    const consent = JSON.parse(readFileSync(abs('config/consent-index.json'), 'utf8')) as ConsentIndex;
    const terms = readFileSync(abs(TERMS_FILE));
    const cfg: ExecutorConfig = {
      registry: w.registry, gate: { falMode: 'live', environment: 'dev', registry: w.registry }, mode: 'live', requestedBy: a.by,
      styleBible: existsSync(sb) ? { id: a.styleBible, bytes: new Uint8Array(readFileSync(sb)) } : null, refs,
      rig: BAY_RIG, limits: row.fidelity as ExecutorConfig['limits'], withMoves: a.withMoves, textLint: (t) => !matchers.some((m) => m.re.test(t)), ktx: ktxTool(),
      consent, recordLicenses: license.record, termsSnapshot: { path: TERMS_FILE, sha256: sha(new Uint8Array(terms)), checked_at: '2026-10-18' },
      publisher: fsPublisher(d.root), concurrency: GENAI_GUARDRAILS.falConcurrency,
    };
    const ports: ExecutorPorts = { fal, blob: fsBlob(abs(WORK_DIR)), roster: mapRoster(entries), flags: { killSwitches: () => Promise.resolve(new Set<string>()) }, budget, clock, vision, log: d.log, names: { realNames: () => Promise.resolve(w.realNames) } };
    return { ports, cfg };
  };
}

export type { UntilStage };
