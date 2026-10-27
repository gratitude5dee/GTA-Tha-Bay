/**
 * `pnpm --filter @dv/mode-fighter fighter:lint [-- <kit.json>... | --quiet]`
 * Lints config/fighter.tuning.json and the kits (default: every content/fighter/kits/*.json), prints the derived
 * frame-data table of each kit and exits 1 on any issue.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args } from '../../../../tools/ci/run.ts';
import type { FighterDef, FightTuning } from '@dv/shared/fight';
import { kitTable, lintKit, lintTuning } from '../src/lint/index.ts';
import type { LintIssue, LintOptions } from '../src/lint/index.ts';
import { loadFameOptions } from '../src/lint/options.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const argv = args();
const quiet = argv.includes('--quiet');
const files = argv.filter((a) => !a.startsWith('--'));
const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8')) as unknown;

function pad(v: string | number | null, n: number): string { return String(v === null ? '-' : v).padStart(n); }
const sign = (v: number | null): string => (v === null ? '-' : v > 0 ? `+${v}` : String(v));

let bad = 0;
const report = (name: string, issues: LintIssue[]): void => {
  if (issues.length === 0) { if (!quiet) console.log(`ok   ${name}`); return; }
  bad += issues.length;
  for (const i of issues) console.error(`FAIL ${name} [${i.rule}] ${i.where}: ${i.message}`);
};

const tuningPath = path.join(root, 'config', 'fighter.tuning.json');
const tuningJson = read(tuningPath);
const tuningIssues = lintTuning(tuningJson);
report('config/fighter.tuning.json', tuningIssues);
const tuning = tuningJson as FightTuning;

const kitDir = path.join(root, 'content', 'fighter', 'kits');
const fameOptions = loadFameOptions(root);
const optionsFor = (kit: unknown): LintOptions => fameOptions((kit as { slot?: string }).slot ?? '');
const list = files.length > 0 ? files.map((f) => path.resolve(f)) : readdirSync(kitDir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(kitDir, f));
for (const file of list) {
  const json = read(file);
  const issues = tuningIssues.length > 0 ? [] : lintKit(json, tuning, optionsFor(json));
  report(path.relative(root, file), issues);
  if (issues.length === 0 && !quiet) {
    const rows = kitTable(json as FighterDef);
    console.log(`${'move'.padEnd(12)}${'S/A/R'.padEnd(10)}${pad('hitstun', 8)}${pad('blkstun', 8)}${pad('advHit', 8)}${pad('advBlk', 8)}${pad('damage', 8)}  guard   hitstop`);
    for (const r of rows) {
      console.log(`${r.id.padEnd(12)}${`${r.startup}/${r.active}/${r.recovery}`.padEnd(10)}${pad(r.hitstun, 8)}${pad(r.blockstun, 8)}${pad(sign(r.advHit), 8)}${pad(sign(r.advBlock), 8)}${pad(r.damage, 8)}  ${r.guard.padEnd(7)} ${r.hitstop}`);
    }
  }
}
if (bad > 0) { console.error(`fighter:lint: ${bad} issue(s)`); process.exit(1); }
if (!quiet) console.log('fighter:lint: clean');
