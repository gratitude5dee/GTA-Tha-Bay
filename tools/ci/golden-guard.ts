/**
 * Golden-update label rule (M00d; 13-qa.md section 2.3 item 3): a change to any path matching `**\/golden/**` or
 * `**\/*.golden.json` fails unless the PR carries the label `golden-update`. The verifier lock itself is M04d.
 *
 *   tsx tools/ci/golden-guard.ts          (CI: GITHUB_BASE_REF set -> git diff against origin/$GITHUB_BASE_REF;
 *                                          labels from DV_PR_LABELS, a comma list)
 */
import { spawnSync } from 'node:child_process';
import { isMain } from './lib/common.ts';
import { repoRoot } from './run.ts';

export const GOLDEN_LABEL = 'golden-update';

/** True for `**\/golden/**` (any directory segment named golden) and `**\/*.golden.json`. */
export function isGoldenPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  return norm.split('/').slice(0, -1).includes('golden') || /(?:^|\/)[^/]*\.golden\.json$/.test(norm);
}

export interface GuardResult {
  ok: boolean;
  goldenPaths: string[];
  message: string;
}

export function guard(changedPaths: readonly string[], labels: readonly string[]): GuardResult {
  const goldenPaths = changedPaths.filter(isGoldenPath);
  if (goldenPaths.length === 0) return { ok: true, goldenPaths, message: 'golden-guard: no golden paths changed' };
  if (labels.map((l) => l.trim()).includes(GOLDEN_LABEL)) {
    return { ok: true, goldenPaths, message: `golden-guard: ${goldenPaths.length} golden path(s) changed, label ${GOLDEN_LABEL} present` };
  }
  return {
    ok: false,
    goldenPaths,
    message: `golden-guard: golden paths changed without the label ${GOLDEN_LABEL}: ${goldenPaths.slice(0, 5).join(', ')}${goldenPaths.length > 5 ? ` (+${goldenPaths.length - 5})` : ''}`,
  };
}

/** Changed paths of the live check, or null when GITHUB_BASE_REF is unset. */
export function changedPathsFromGit(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const base = env['GITHUB_BASE_REF'];
  if (!base) return null;
  const res = spawnSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout.split('\n').filter(Boolean);
}

export const labelsFromEnv = (env: NodeJS.ProcessEnv = process.env): string[] => (env['DV_PR_LABELS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function main(): void {
  const paths = changedPathsFromGit();
  if (!paths) {
    console.log('golden-guard: GITHUB_BASE_REF not set (or git diff failed); nothing to check');
    return;
  }
  const res = guard(paths, labelsFromEnv());
  console.log(res.message);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
