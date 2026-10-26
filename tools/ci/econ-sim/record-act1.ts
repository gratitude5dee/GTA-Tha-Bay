/**
 * Rewrites the `act1` section of `config/econ-bands.json` from the harness itself (M05c2: all twelve missions). The band rule is the one
 * the M05c1 numbers follow: the exact probes are pinned to the measured values; a p10 or p90 band of the end balance is the measured
 * value plus or minus 8,000 cents, and the p50 band spans from the p10 band's low edge to the p90 band's high edge (the median can land
 * on either side of the m.a1.05 win); the income bands are exact (p10, p90) or span both (p50).
 *
 *   tsx tools/ci/econ-sim/record-act1.ts          rewrite the section
 *   tsx tools/ci/econ-sim/record-act1.ts --check  fail when the file would change
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, toolsRoot } from '../lib/common.ts';
import { args } from '../run.ts';
import { DEFAULT_MODEL_DEPS } from './model.ts';
import { simulateSection } from './index.ts';
import { ACT1_SECTION } from './sections/act1.ts';

const FILE = path.join(toolsRoot, 'config', 'econ-bands.json');
const MARGIN = 8000;

type Band = [number, number];
interface Bands {
  exact: Record<string, number>;
  policies: Record<string, Record<string, Record<string, Band>>>;
}

export function actOneBands(): Bands {
  const res = simulateSection(ACT1_SECTION, DEFAULT_MODEL_DEPS);
  const out: Bands = { exact: { ...res.exact }, policies: {} };
  for (const [policy, table] of Object.entries(res.policies)) {
    const end = table.endBalance;
    const inc = table.totalIncome;
    const lo = end.p10 - MARGIN;
    const hi = end.p90 + MARGIN;
    out.policies[policy] = {
      endBalance: { p10: [lo, end.p10 + MARGIN], p50: [lo, hi], p90: [end.p90 - MARGIN, hi] },
      totalIncome: { p10: [inc.p10, inc.p10], p50: [inc.p10, inc.p90], p90: [inc.p90, inc.p90] },
    };
  }
  return out;
}

function main(): number {
  const text = readFileSync(FILE, 'utf8');
  const json = JSON.parse(text) as { sections: Record<string, Bands> };
  json.sections['act1'] = actOneBands();
  const next = `${JSON.stringify(json, null, 2)}\n`;
  if (args().includes('--check')) {
    if (next !== text) {
      console.log('record-act1: config/econ-bands.json would change');
      return 1;
    }
    return 0;
  }
  if (next !== text) writeFileSync(FILE, next);
  console.log(`record-act1: ${next === text ? 'unchanged' : 'wrote'} config/econ-bands.json`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
