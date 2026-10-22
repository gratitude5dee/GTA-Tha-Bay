/**
 * Proves test routes and mock modes never reach production (R-ENG-03).
 *
 *   tsx tools/ci/check-prod-routes.ts
 *
 * Builds the production bundle (top-level environment, where __DV_TEST_ROUTES__ is false) with
 * `wrangler deploy --dry-run --outdir`, then fails on any `/_test/` string in the output or a prod FAL_MODE of `mock`.
 * Needs apps/web/dist (the dry run reads the assets directory); builds it first when it is missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripJsonc } from './deploy.ts';
import { args, repoRoot } from './run.ts';

const WRANGLER_CONFIG = path.join(repoRoot, 'services/edge/wrangler.jsonc');

/** Lines of bundle text that contain a test-route path. */
export function findTestRouteStrings(bundleText: string): string[] {
  return bundleText.split('\n').filter((line) => line.includes('/_test/') || line.includes('__DV_TEST_ROUTES__'));
}

/** Problems in the top-level (production) config. */
export function prodConfigProblems(configText: string): string[] {
  const cfg = JSON.parse(stripJsonc(configText)) as { vars?: Record<string, string>; define?: Record<string, string> };
  const problems: string[] = [];
  if (cfg.vars?.['FAL_MODE'] === 'mock') problems.push('production FAL_MODE is "mock"');
  // M06a3: anything but "live" replays recorded streams, so a production Worker with another value would answer players from fixtures.
  if (cfg.vars?.['ANTHROPIC_MODE'] !== 'live') problems.push(`production ANTHROPIC_MODE is "${cfg.vars?.['ANTHROPIC_MODE'] ?? 'unset'}", expected "live" (fixture mode replays recorded streams)`);
  if (cfg.vars?.['ENVIRONMENT'] !== 'prod') problems.push(`production ENVIRONMENT is "${cfg.vars?.['ENVIRONMENT'] ?? 'unset'}", expected "prod"`);
  if (cfg.define?.['__DV_TEST_ROUTES__'] !== 'false') problems.push('production define __DV_TEST_ROUTES__ is not "false"');
  return problems;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function main(): number {
  const problems = prodConfigProblems(readFileSync(WRANGLER_CONFIG, 'utf8'));

  if (!existsSync(path.join(repoRoot, 'apps/web/dist/index.html'))) {
    console.log('apps/web/dist is missing; running pnpm build first');
    if (spawnSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
      console.error('check:prod-routes: pnpm build failed');
      return 1;
    }
  }

  const outdir = mkdtempSync(path.join(os.tmpdir(), 'dv-prod-bundle-'));
  try {
    const res = spawnSync(
      'pnpm',
      ['--filter', '@dv/edge', 'exec', 'wrangler', 'deploy', '--dry-run', '--env=', '--outdir', outdir],
      { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 64 * 1024 * 1024 },
    );
    if (res.status !== 0) {
      process.stderr.write(`${res.stdout}${res.stderr}`);
      console.error('check:prod-routes: wrangler deploy --dry-run failed');
      return 1;
    }
    const files = walk(outdir).filter((f) => /\.(m?js|json|map)$/.test(f) && !f.endsWith('.map'));
    if (files.length === 0) problems.push('the dry run produced no bundle files');
    for (const file of files) {
      const hits = findTestRouteStrings(readFileSync(file, 'utf8'));
      for (const hit of hits) problems.push(`${path.relative(outdir, file)} contains a test-route string: ${hit.trim().slice(0, 120)}`);
    }
    if (problems.length === 0) console.log(`check:prod-routes ok: ${files.length} bundle file(s), no /_test/ handler, FAL_MODE is not mock, ANTHROPIC_MODE is live`);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
  for (const p of problems) console.error(`check:prod-routes FAIL ${p}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void args();
  process.exit(main());
}
