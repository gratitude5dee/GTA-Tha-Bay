/**
 * Does this CI run need its e2e shards and perf groups? (BD-FIX-CI-PLAN-03, the Architect's decision of 2026-11-12.)
 *
 * `ci.yml` runs in full on a push to a merge candidate `claude/integ-*` and again, on the same commit, when `claude/build` is moved to
 * it. The second run repeats every e2e shard and perf group on a commit that is already green. So on a push to `refs/heads/claude/build`
 * the `scope` job asks GitHub for this workflow's runs of the head commit and passes the answer to `decideScope`:
 *
 *   gh api "repos/<owner>/<repo>/actions/workflows/ci.yml/runs?head_sha=<sha>&event=push&per_page=100" > runs.json
 *   tsx tools/ci/ci-scope.ts --runs runs.json        (reads GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_SHA; writes to $GITHUB_OUTPUT)
 *
 * The run is light (`heavy=false`: the `e2e-shard` and `perf-group` jobs are skipped, and the `e2e (<project>)` and `perf` checks pass
 * with one line naming the run they rely on) only when all of this holds: the event is a push to `refs/heads/claude/build`, and the
 * list holds a run of `ci.yml` for exactly this commit, from a push to a branch `claude/integ-*` or to `main`, that is completed with
 * conclusion `success`. A pull_request run never counts: it tested the merge ref, not this commit. Any doubt is the full run: another
 * event or ref, no list (an API error, a missing or unreadable file), a run that failed, was cancelled or is still going, another commit.
 *
 * `decideScope` is pure; the lookup is the workflow's `gh api` step (spec/03 section 6: the endpoint, the `actions: read` permission and
 * what a job does when a job it needs was skipped).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { args } from './run.ts';
import { isMain } from './lib/common.ts';

/** The only ref whose push may skip the heavy jobs. */
export const BUILD_REF = 'refs/heads/claude/build';
/** The workflow whose green run stands for the commit, as the run object's `path` names it. */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

/** A branch whose green push run stands for a commit: a merge candidate (`on.push.branches: 'claude/integ-**'`) or `main`. */
export const isGreenSource = (branch: string): boolean => branch === 'main' || /^claude\/integ-./.test(branch);

export interface ScopeInput {
  /** `github.event_name`. */
  eventName: string;
  /** `github.ref`, fully formed (`refs/heads/...`). */
  ref: string;
  /** `github.sha`: the head commit of the push. */
  sha: string;
  /** The body of "List workflow runs for a workflow" (`{ workflow_runs: [...] }`); anything else (null, an error body) is a failed lookup. */
  runs: unknown;
}

export interface Scope {
  /** true: run the e2e shards and the perf groups. */
  heavy: boolean;
  /** The run this one relies on when `heavy` is false; '' otherwise. */
  runUrl: string;
  reason: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A run page URL, and nothing that could break out of a line of `$GITHUB_OUTPUT` or of a log. */
const RUN_URL = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._/-]+\/actions\/runs\/\d+$/;

export function decideScope(input: ScopeInput): Scope {
  const full = (reason: string): Scope => ({ heavy: true, runUrl: '', reason });
  if (input.eventName !== 'push') return full(`event ${input.eventName || '(none)'}: only a push to ${BUILD_REF} can rely on an earlier run`);
  if (input.ref !== BUILD_REF) return full(`push to ${input.ref || '(no ref)'}: only ${BUILD_REF} can rely on an earlier run`);
  if (!/^[0-9a-f]{40}$/.test(input.sha)) return full('no head commit');
  const list = isRecord(input.runs) ? input.runs['workflow_runs'] : undefined;
  if (!Array.isArray(list)) return full('the lookup of this commit\'s runs failed or returned no list');
  const seen: string[] = [];
  for (const r of list as unknown[]) {
    if (!isRecord(r)) continue;
    const branch = typeof r['head_branch'] === 'string' ? r['head_branch'] : '';
    seen.push(`${String(r['event'])} on ${branch || '(no branch)'}: ${String(r['status'])}/${String(r['conclusion'])}`);
    if (r['head_sha'] !== input.sha) continue; // another commit
    if (r['event'] !== 'push') continue; // a pull_request run tested the merge ref
    if (!isGreenSource(branch)) continue; // not a merge candidate, not main
    if (r['status'] !== 'completed' || r['conclusion'] !== 'success') continue; // failed, cancelled, still going
    if (typeof r['path'] === 'string' && !r['path'].startsWith(CI_WORKFLOW_PATH)) continue; // another workflow
    const url = r['html_url'];
    if (typeof url !== 'string' || !RUN_URL.test(url)) continue; // nothing to name
    return { heavy: false, runUrl: url, reason: `${input.sha} already passed ci on a push to ${branch}: ${url}` };
  }
  return full(`no completed, successful push run of ci on claude/integ-* or main for ${input.sha} (${seen.length} runs: ${seen.slice(0, 8).join('; ') || 'none'})`);
}

/** The lines the `scope` job appends to `$GITHUB_OUTPUT`. */
export const outputLines = (s: Scope): string => `heavy=${s.heavy ? 'true' : 'false'}\nrun-url=${s.heavy ? '' : s.runUrl}\n`;

function main(): number {
  const { values } = parseArgs({ args: args(), options: { runs: { type: 'string' } } });
  let runs: unknown = null;
  let lookup = 'no --runs file';
  if (values.runs) {
    try {
      runs = JSON.parse(readFileSync(values.runs, 'utf8'));
      lookup = values.runs;
    } catch (e) {
      lookup = `unreadable ${values.runs}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const scope = decideScope({
    eventName: process.env['GITHUB_EVENT_NAME'] ?? '',
    ref: process.env['GITHUB_REF'] ?? '',
    sha: process.env['GITHUB_SHA'] ?? '',
    runs,
  });
  console.log(`ci-scope: heavy=${String(scope.heavy)}: ${scope.reason} (lookup: ${lookup})`);
  const out = process.env['GITHUB_OUTPUT'];
  if (out) appendFileSync(out, outputLines(scope));
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
