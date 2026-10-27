/**
 * assets:gen gate --run <runId> --gate H0..H5 --choose <n> --by <profile> (M10a1): records a human decision in the run's `review[]` and
 * lets the next `run` resume. The decision is the only thing this command writes; it never calls a vendor.
 *
 *   H1 for a `parody` or `fictionalized` character also needs `--checklist` (the legal L1 list is printed first).
 *   H2 takes `--choose <portrait> [--atlas <mouth atlas>]`.
 *   H4 takes `--anchor x,y,z`, `--jaw`, `--fingers`: the mouth anchor and the bones the spot-check found.
 *   `--reject` records a rejection (a later decision overrides it); `--note <text>` is kept in the review entry and the provenance record.
 */
import { parseArgs } from 'node:util';
import { HUMAN_GATES, runIdOf, type HumanGateId, type ReviewEntry } from '../../../services/pipeline/src/steps/character.ts';
import { h1Checklist } from '../../../services/pipeline/src/steps/gates.ts';
import { recordDecision } from './executor.ts';
import { isoNow } from './ledger.ts';
import { loadWorld } from './plan.ts';
import { WORK_DIR } from './run.ts';
import { fsBlob } from './ports.ts';
import path from 'node:path';

export interface GateDeps {
  root: string;
  log: (line: string) => void;
  now: () => number;
}

export async function gateCommand(argv: readonly string[], d: GateDeps): Promise<number> {
  let values;
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        run: { type: 'string' }, gate: { type: 'string' }, choose: { type: 'string' }, atlas: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' },
        checklist: { type: 'boolean', default: false }, reject: { type: 'boolean', default: false }, anchor: { type: 'string' }, jaw: { type: 'boolean', default: false }, fingers: { type: 'boolean', default: false },
        roster: { type: 'string' }, registry: { type: 'string' }, ledger: { type: 'string' }, kill: { type: 'string' },
      },
    }).values;
  } catch (e) {
    d.log(`assets:gen gate: ${(e as Error).message}`);
    return 2;
  }
  const gate = values.gate as HumanGateId | undefined;
  if (!values.run || gate === undefined || !HUMAN_GATES.includes(gate) || !values.by) {
    d.log('usage: assets:gen gate --run <runId> --gate H0..H5 --choose <n> --by <profile> [--atlas n] [--note text] [--checklist] [--reject] [--anchor x,y,z] [--jaw] [--fingers]');
    return 2;
  }
  const slug = values.run.replace(/-[0-9a-f]{8}$/, '');
  const w = loadWorld(d.root, { roster: values.roster, registry: values.registry, ledger: values.ledger, kill: values.kill });
  const e = w.entries.find((x) => x.entry.id === slug);
  if (e === undefined || e.subject === null) {
    d.log(`assets:gen gate: run ${values.run} names no runnable roster entry`);
    return 1;
  }
  if (runIdOf(e.subject) !== values.run) {
    d.log(`assets:gen gate: run ${values.run} is not the current run of ${slug} (${runIdOf(e.subject)}); the soul or the tier changed`);
    return 1;
  }
  if (!values.reject && values.choose === undefined) {
    d.log('assets:gen gate: --choose <n> is required (use --choose 1 to approve a gate that has one subject)');
    return 2;
  }
  if (gate === 'H1' && !values.reject) {
    const items = h1Checklist(e.subject.tier);
    if (items.length > 0 && !values.checklist) {
      d.log(`H1 checklist for a ${e.subject.tier} character (spec section 2): confirm each, then repeat the command with --checklist`);
      for (const i of items) d.log(`  [ ] ${i}`);
      return 1;
    }
  }
  const choose = values.choose === undefined ? undefined : Number(values.choose);
  if (choose !== undefined && (!Number.isInteger(choose) || choose < 1)) {
    d.log('assets:gen gate: --choose must be a positive integer');
    return 2;
  }
  const entry: Omit<ReviewEntry, 'at'> = {
    gate, by: values.by, decision: values.reject ? 'reject' : 'approve',
    ...(values.note !== undefined ? { note: values.note } : values.checklist && gate === 'H1' ? { note: 'H1 checklist confirmed' } : {}),
    ...(choose !== undefined ? { choose } : {}),
    ...(values.atlas !== undefined ? { atlas: Number(values.atlas) } : {}),
  };
  if (gate === 'H4') {
    const anchor = values.anchor?.split(',').map(Number);
    if (anchor !== undefined && (anchor.length !== 3 || anchor.some((n) => !Number.isFinite(n)))) {
      d.log('assets:gen gate: --anchor must be x,y,z in metres');
      return 2;
    }
    entry.data = { jaw: values.jaw, fingers: values.fingers, ...(anchor !== undefined ? { mouthAnchor: anchor } : {}) };
  }
  const blob = fsBlob(path.resolve(d.root, WORK_DIR));
  const run = await recordDecision(blob, e.subject, entry, isoNow(d.now()));
  d.log(`recorded ${gate} ${entry.decision}${choose !== undefined ? ` (choice ${choose})` : ''} by ${values.by} for run ${run.runId}; resume with: pnpm assets:gen -- run --slug ${slug} --until <sheet|mesh|rig|publish> --live`);
  return 0;
}
