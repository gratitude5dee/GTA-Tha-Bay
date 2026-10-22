/**
 * pnpm db:push -- --env <staging|prod> [--dry-run] (M05d): `supabase link` -> `supabase db push --dry-run` (to the job summary) ->
 * `supabase db push`.
 *
 *   tsx tools/ci/db-push.ts --env staging|prod [--dry-run]
 *
 * --dry-run prints the three commands in order and runs none of them (no network). Without it, a missing SUPABASE_ACCESS_TOKEN,
 * SUPABASE_PROJECT_ID (or the ref in config/supabase.projects.json) or SUPABASE_DB_PASSWORD prints one `SKIP db:push: <VAR> not set`
 * line and exits 0, so deploy.yml carries on without a migrate step for an environment whose project does not exist yet.
 * The dry-run listing of the real run is appended to $GITHUB_STEP_SUMMARY when that variable is set. The database password and the
 * access token are read from the environment by the Supabase CLI and are never printed.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';

export type PushEnv = 'staging' | 'prod';

export interface PushStep {
  title: string;
  argv: string[];
  /** The step's output goes to the job summary. */
  summary?: boolean;
}

export interface PushPlan {
  env: PushEnv;
  /** Why nothing runs; the line to print. Absent when the plan can run. */
  skip?: string;
  steps: PushStep[];
}

interface ProjectsFile {
  staging?: { ref: string | null };
  prod?: { ref: string | null };
}

export function configuredRef(env: PushEnv, root: string = repoRoot): string | null {
  try {
    const cfg = JSON.parse(readFileSync(path.join(root, 'config/supabase.projects.json'), 'utf8')) as ProjectsFile;
    return cfg[env]?.ref ?? null;
  } catch {
    return null;
  }
}

/** The ref placeholder printed by a dry run that has no ref to show. */
const REF_PLACEHOLDER = '<SUPABASE_PROJECT_ID>';

/** Pure: the commands for one environment and the reason they cannot run, if any. */
export function planPush(env: PushEnv, e: NodeJS.ProcessEnv, root: string = repoRoot): PushPlan {
  const ref = e['SUPABASE_PROJECT_ID'] || configuredRef(env, root);
  const steps: PushStep[] = [
    { title: 'link', argv: ['link', '--project-ref', ref ?? REF_PLACEHOLDER] },
    { title: 'db push --dry-run', argv: ['db', 'push', '--dry-run'], summary: true },
    { title: 'db push', argv: ['db', 'push'] },
  ];
  if (!e['SUPABASE_ACCESS_TOKEN']) return { env, skip: 'SKIP db:push: SUPABASE_ACCESS_TOKEN not set', steps };
  if (!ref) return { env, skip: 'SKIP db:push: SUPABASE_PROJECT_ID not set', steps };
  if (!e['SUPABASE_DB_PASSWORD']) return { env, skip: 'SKIP db:push: SUPABASE_DB_PASSWORD not set', steps };
  return { env, steps };
}

export const formatStep = (s: PushStep): string => `supabase ${s.argv.join(' ')}`;

export interface PushDeps {
  run?: (argv: string[]) => { status: number | null; stdout: string };
  log?: (line: string) => void;
  summary?: (text: string) => void;
}

export function execute(plan: PushPlan, deps: PushDeps = {}): number {
  const log = deps.log ?? ((l: string) => void console.log(l));
  const run =
    deps.run ??
    ((argv: string[]) => {
      const r = spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'supabase'), argv, { cwd: repoRoot, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
      process.stdout.write(r.stdout ?? '');
      process.stderr.write(r.stderr ?? '');
      return { status: r.status, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    });
  const summary =
    deps.summary ??
    ((text: string) => {
      const file = process.env['GITHUB_STEP_SUMMARY'];
      if (file) appendFileSync(file, text);
    });
  for (const step of plan.steps) {
    log(`db:push (${plan.env}): ${formatStep(step)}`);
    const r = run(step.argv);
    if (step.summary) summary(`### db push --dry-run (${plan.env})\n\n\`\`\`\n${r.stdout.trim()}\n\`\`\`\n`);
    if (r.status !== 0) {
      log(`db:push FAIL: \`${formatStep(step)}\` exited ${r.status ?? 'without a status'}`);
      return 1;
    }
  }
  return 0;
}

export function main(argv: string[], e: NodeJS.ProcessEnv = process.env, deps: PushDeps = {}): number {
  const log = deps.log ?? ((l: string) => void console.log(l));
  const { values } = parseArgs({ args: argv, options: { env: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } });
  if (values.env !== 'staging' && values.env !== 'prod') {
    log('db:push: usage: db:push -- --env <staging|prod> [--dry-run]');
    return 1;
  }
  const plan = planPush(values.env, e);
  if (values['dry-run']) {
    log(`db:push plan (${plan.env}, nothing is run):`);
    for (const [i, s] of plan.steps.entries()) log(`  ${i + 1}. ${formatStep(s)}`);
    if (plan.skip) log(`  (a real run would stop here: ${plan.skip})`);
    return 0;
  }
  if (plan.skip) {
    log(plan.skip);
    return 0;
  }
  return execute(plan, deps);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
