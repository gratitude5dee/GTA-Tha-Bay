/**
 * license:scan. Two checks.
 *  1. Production dependency licences of @dv/web (`pnpm licenses list --json --prod`), judged against
 *     config/license-allowlist.json. Workspace packages are skipped.
 *  2. First-party licence coverage: every tracked file is covered by a REUSE.toml annotation glob or carries an
 *     SPDX-License-Identifier line.
 * ScanCode Toolkit and `reuse lint` are not blocking here (their versions are not in the ledger); the nightly job
 * runs them when installed.
 *
 *   tsx tools/ci/license-scan.ts [--root <dir>] [--no-deps]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { judgeDependency, type DependencyPolicy } from '../../packages/shared/src/assets/gates/license.ts';
import { looksBinary } from '../../packages/shared/src/assets/gates/ip.ts';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import { args } from './run.ts';
import { isMain, listTree, loadConfigs, MIB, report, toolsRoot } from './lib/common.ts';

const GATE = 'license:scan';

export interface DependencyInfo { name: string; version: string; license: string }

/** Parses `pnpm licenses list --json` defensively: an object keyed by licence, or a flat array. */
export function parsePnpmLicenses(json: unknown): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  const push = (license: string, item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : null;
    if (!name) return;
    const versions = Array.isArray(o.versions) ? o.versions.map(String) : typeof o.version === 'string' ? [o.version] : ['?'];
    const lic = typeof o.license === 'string' && o.license ? o.license : license;
    for (const version of versions) out.push({ name, version, license: lic });
  };
  if (Array.isArray(json)) {
    for (const item of json) push('UNKNOWN', item);
  } else if (json && typeof json === 'object') {
    for (const [license, list] of Object.entries(json as Record<string, unknown>)) {
      if (Array.isArray(list)) for (const item of list) push(license, item);
    }
  }
  return out;
}

export function productionDependencies(root: string): DependencyInfo[] {
  const res = spawnSync('pnpm', ['licenses', 'list', '--json', '--prod', '--filter', '@dv/web'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * MIB,
  });
  if (res.status !== 0) throw new Error(`pnpm licenses failed: ${res.stderr.trim() || res.error?.message || res.status}`);
  const start = res.stdout.search(/[{[]/);
  if (start < 0) throw new Error('pnpm licenses printed no JSON');
  return parsePnpmLicenses(JSON.parse(res.stdout.slice(start)));
}

export function judgeDependencies(deps: readonly DependencyInfo[], policy: DependencyPolicy): GateFinding[] {
  const out: GateFinding[] = [];
  for (const d of deps) {
    if (d.name.startsWith('@dv/') || d.version.startsWith('workspace:') || d.version.startsWith('link:')) continue;
    const v = judgeDependency(d.name, d.license, 'prod', policy);
    if (!v.ok) out.push(finding(GATE, `${d.name}@${d.version}`, v.rule, v.detail));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// REUSE.toml

/** Glob per the REUSE specification: `*` matches within a directory, `**` across directories. */
export function reuseGlobToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero directories
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Minimal reader for `[[annotations]]` tables with `path = [...]` arrays (the only part used here). */
export function parseReusePaths(toml: string): string[] {
  const globs: string[] = [];
  for (const block of toml.split(/^\[\[annotations\]\]\s*$/m).slice(1)) {
    const m = /^path\s*=\s*(\[[\s\S]*?\]|"[^"]*")/m.exec(block);
    if (!m) continue;
    for (const s of (m[1] as string).matchAll(/"([^"]*)"/g)) globs.push(s[1] as string);
  }
  return globs;
}

const EXEMPT = (f: string): boolean => f.startsWith('LICENSES/') || f === 'REUSE.toml';

export function checkFirstPartyCoverage(root: string, files: readonly string[]): GateFinding[] {
  const out: GateFinding[] = [];
  const tomlPath = path.join(root, 'REUSE.toml');
  const globs = existsSync(tomlPath) ? parseReusePaths(readFileSync(tomlPath, 'utf8')).map(reuseGlobToRegExp) : [];
  if (!existsSync(tomlPath)) out.push(finding(GATE, 'REUSE.toml', 'reuse-missing', 'no REUSE.toml at the repository root'));
  for (const f of files) {
    if (EXEMPT(f) || globs.some((g) => g.test(f))) continue;
    const bytes = readFileSync(path.join(root, f));
    if (!looksBinary(bytes) && /SPDX-License-Identifier:/.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)))) continue;
    out.push(finding(GATE, f, 'no-license-coverage', 'not covered by REUSE.toml and no SPDX-License-Identifier line'));
  }
  const lic = path.join(root, 'LICENSES', 'LicenseRef-DeeVerse-Owned.txt');
  if (existsSync(tomlPath) && !existsSync(lic)) out.push(finding(GATE, 'LICENSES/LicenseRef-DeeVerse-Owned.txt', 'license-text-missing', 'REUSE license text is missing'));
  return out;
}

export interface LicenseScanOptions {
  root: string;
  /** Dependency list; read through pnpm when omitted. */
  deps?: DependencyInfo[] | undefined;
}

export function runLicenseScan(opts: LicenseScanOptions): { findings: GateFinding[]; scanned: number } {
  const cfg = loadConfigs(opts.root).licenses;
  const policy: DependencyPolicy = { prod: cfg.dependency.prod, devOnly: cfg.dependency.devOnly, exceptions: cfg.exceptions };
  const deps = opts.deps ?? productionDependencies(opts.root);
  const files = listTree(opts.root);
  const findings = [...judgeDependencies(deps, policy), ...checkFirstPartyCoverage(opts.root, files)];
  return { findings, scanned: deps.length + files.length };
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, 'no-deps': { type: 'boolean', default: false } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const { findings, scanned } = runLicenseScan({ root, deps: values['no-deps'] ? [] : undefined });
  process.exit(report(GATE, findings, scanned));
}

if (isMain(import.meta.url)) main();
