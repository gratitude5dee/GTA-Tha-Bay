/**
 * check:rollout (M00d, R-ROLL-01 order gate; _PLAN.md section 0 rule 4):
 *
 *   tsx tools/ci/check-rollout.ts [--branch <name>] [--root <dir>]
 *
 * The branch comes from --branch, else GITHUB_HEAD_REF, else `git rev-parse --abbrev-ref HEAD`. A branch matching
 * ^m12[b-e] is a rooms-milestone branch (M12b1, M12b2, M12c1, M12c2, M12d, M12e); any other branch prints
 * "rollout: not a rooms branch" and exits 0. On a rooms branch the check fails unless
 *  1. the README status table shows M05c2 as DONE, and
 *  2. docs/staging-runs/M05c2/report.json exists ({milestone, stagingUrl, versionId, date, acs: [{id, result}]}) and lists
 *     every AC id of M05c2-act1-vertical-slice.md with result "pass".
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/common.ts';
import { parseMilestone, parseStatusTable } from './md-parse.ts';
import { args, repoRoot } from './run.ts';

export const ROOMS_BRANCH_RE = /^m12[b-e]/;
export const GATE_MILESTONE = 'M05c2';

export interface RolloutResult {
  ok: boolean;
  roomsBranch: boolean;
  messages: string[];
}

export interface RolloutOptions {
  branch: string;
  root?: string;
}

export function checkRollout(opts: RolloutOptions): RolloutResult {
  const root = opts.root ?? repoRoot;
  if (!ROOMS_BRANCH_RE.test(opts.branch)) return { ok: true, roomsBranch: false, messages: ['rollout: not a rooms branch'] };
  const messages: string[] = [];
  const dir = path.join(root, 'spec', '07-milestones');
  const readme = existsSync(path.join(dir, 'README.md')) ? readFileSync(path.join(dir, 'README.md'), 'utf8') : '';
  const status = parseStatusTable(readme).get(GATE_MILESTONE);
  if (!status || status.status !== 'DONE') {
    messages.push(`rollout: ${GATE_MILESTONE} is ${status?.status ?? 'absent from the README status table'}, not DONE; a rooms branch (${opts.branch}) may start only after the story slice is proven (R-ROLL-01)`);
  }
  const reportPath = path.join(root, 'docs', 'staging-runs', GATE_MILESTONE, 'report.json');
  if (!existsSync(reportPath)) {
    messages.push(`rollout: docs/staging-runs/${GATE_MILESTONE}/report.json is missing; commit the staging run of the ${GATE_MILESTONE} acceptance criteria`);
  } else {
    let report: { acs?: { id?: string; result?: string }[] } | undefined;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8')) as typeof report;
    } catch {
      messages.push(`rollout: docs/staging-runs/${GATE_MILESTONE}/report.json is not valid JSON`);
    }
    const file = existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith(`${GATE_MILESTONE}-`) && f.endsWith('.md')) : undefined;
    if (report) {
      if (!file) messages.push(`rollout: the ${GATE_MILESTONE} milestone file is missing, so its AC ids cannot be checked`);
      else {
        const ids = parseMilestone(readFileSync(path.join(dir, file), 'utf8')).acs.map((a) => `AC-${a.n}`);
        const byId = new Map((report.acs ?? []).map((a) => [a.id ?? '', a.result ?? '']));
        for (const id of ids) {
          if (!byId.has(id)) messages.push(`rollout: staging report lists no result for ${id}`);
          else if (byId.get(id) !== 'pass') messages.push(`rollout: staging report has ${id} = ${byId.get(id)}, not pass`);
        }
      }
    }
  }
  return { ok: messages.length === 0, roomsBranch: true, messages: messages.length ? messages : [`rollout: ${GATE_MILESTONE} is DONE and every AC passed on staging`] };
}

export function currentBranch(env: NodeJS.ProcessEnv = process.env): string {
  if (env['GITHUB_HEAD_REF']) return env['GITHUB_HEAD_REF'];
  return spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
}

function main(): void {
  const argv = args();
  const branch = argv.includes('--branch') ? (argv[argv.indexOf('--branch') + 1] as string) : currentBranch();
  const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1] as string) : repoRoot;
  const res = checkRollout({ branch, root });
  for (const m of res.messages) console.log(m);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
