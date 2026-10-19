/**
 * license:scan. Two checks.
 *  1. Production dependency licences of @dv/web (`pnpm licenses list --json --prod`), judged against
 *     config/license-allowlist.json. Workspace packages are skipped.
 *  2. First-party licence coverage: every tracked file is covered by a REUSE.toml annotation glob or carries an
 *     SPDX-License-Identifier line.
 *  3. (M00f) third_party/ through the register checks of ADR-REUSE-01, GPL-family exceptions, the production
 *     dependencies of services/* and distributable packages, and the Mapbox scan.
 * ScanCode Toolkit and `reuse lint` are not blocking here (their versions are not in the ledger); the nightly job
 * runs them when installed.
 *
 *   tsx tools/ci/license-scan.ts [--root <dir>] [--no-deps]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { judgeDependency, type DependencyPolicy } from '../../packages/shared/src/assets/gates/license.ts';
import { looksBinary } from '../../packages/shared/src/assets/gates/ip.ts';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import type { NamesFile } from '../../packages/shared/src/assets/gates/names.ts';
import { args } from './run.ts';
import { isMain, listDist, listTree, loadConfigs, MIB, report, toolsRoot } from './lib/common.ts';
import { loadRealSide } from './names-lint.ts';
import { scanThirdParty } from './lib/third-party.ts';

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

export function productionDependencies(root: string, filter = '@dv/web'): DependencyInfo[] {
  const res = spawnSync('pnpm', ['licenses', 'list', '--json', '--prod', '--filter', filter], {
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

// ---------------------------------------------------------------------------------------------
// M00f rules

/** Package directories whose production dependencies are judged beside @dv/web: services/* and distributable packages. */
export function distributablePackages(root: string): Array<{ dir: string; name: string }> {
  const dirs = new Set<string>();
  const sd = path.join(root, 'services');
  if (existsSync(sd)) for (const n of readdirSync(sd)) dirs.add(`services/${n}`);
  dirs.add('tools/cli');
  dirs.add('packages/mod-sdk');
  const out: Array<{ dir: string; name: string }> = [];
  for (const dir of [...dirs].sort()) {
    const file = path.join(root, dir, 'package.json');
    if (!existsSync(file)) continue;
    const name = (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name;
    if (name) out.push({ dir, name });
  }
  return out;
}

const GPL_FAMILY = /(^|[^A-Z])(A?GPL|LGPL)-/i;

/** An exceptions entry for a GPL-family licence fails whatever ADR id it carries (DL-634). */
export function checkGplExceptions(exceptions: readonly { package: string; license: string }[]): GateFinding[] {
  return exceptions
    .filter((e) => GPL_FAMILY.test(e.license) || /^(A?GPL|LGPL)$/i.test(e.license))
    .map((e) => finding(GATE, 'config/license-allowlist.json', 'gpl-exception', `${e.package}: an exception for ${e.license} is never allowed`));
}

// Built from fragments so this file never matches its own scan.
const MB = ['map', 'box'].join('');
const MAPBOX_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'mapbox-host', re: new RegExp(`api\\.${MB}\\.com`, 'i') },
  { rule: 'mapbox-host', re: new RegExp(`[a-z0-9-]+\\.tiles\\.${MB}\\.com`, 'i') },
  { rule: 'mapbox-scheme', re: new RegExp(`${MB}://`, 'i') },
  { rule: 'mapbox-token', re: new RegExp(`\\b(?:p|s|t)k\\.${['ey', 'J'].join('')}`) },
];
const MAPBOX_DIRS = ['apps/', 'packages/', 'services/', 'tools/', 'content/', 'config/', 'assets/provenance/'];

export function scanMapbox(root: string, tree: readonly string[], dist: string | null): GateFinding[] {
  const out: GateFinding[] = [];
  const scan = (label: string, bytes: Buffer): void => {
    if (looksBinary(bytes)) return;
    const text = bytes.toString('utf8');
    for (const p of MAPBOX_PATTERNS) {
      const m = p.re.exec(text);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        out.push(finding(GATE, label, p.rule, `a ${MB} reference at line ${line} is never allowed (DL-506)`));
      }
    }
  };
  for (const f of tree) {
    if (f.startsWith('tools/ci/fixtures/') || !MAPBOX_DIRS.some((d) => f.startsWith(d)) || f.startsWith('apps/web/dist/')) continue;
    scan(f, readFileSync(path.join(root, f)));
  }
  if (dist) for (const rel of listDist(dist)) scan(`dist/${rel}`, readFileSync(path.join(dist, rel)));
  return out;
}

export interface LicenseScanOptions {
  root: string;
  /** Dependency list; read through pnpm when omitted. */
  deps?: DependencyInfo[] | undefined;
  /** Production dependencies per services/* and distributable package name; read through pnpm when omitted. */
  packageDeps?: Record<string, DependencyInfo[]> | undefined;
  /** Real-side NameRegistry for the subset value rule. */
  real?: NamesFile | null | undefined;
  packFiles?: ((pkgDir: string) => string[]) | undefined;
  /** Receives SKIP notes. */
  notes?: string[] | undefined;
}

export function runLicenseScan(opts: LicenseScanOptions): { findings: GateFinding[]; scanned: number } {
  const cfg = loadConfigs(opts.root).licenses;
  const policy: DependencyPolicy = { prod: cfg.dependency.prod, devOnly: cfg.dependency.devOnly, exceptions: cfg.exceptions };
  const deps = opts.deps ?? productionDependencies(opts.root);
  const files = listTree(opts.root);
  const findings = [...judgeDependencies(deps, policy), ...checkFirstPartyCoverage(opts.root, files)];
  findings.push(...checkGplExceptions(cfg.exceptions));
  for (const pkg of distributablePackages(opts.root)) {
    const list = opts.packageDeps ? (opts.packageDeps[pkg.name] ?? []) : opts.deps !== undefined ? [] : productionDependencies(opts.root, pkg.name);
    findings.push(...judgeDependencies(list, policy).map((f) => ({ ...f, file: `${pkg.dir}: ${f.file}` })));
  }
  const tp = scanThirdParty(opts.root, { tree: files, real: opts.real, packFiles: opts.packFiles });
  findings.push(...tp.findings);
  opts.notes?.push(...tp.notes);
  const distDir = path.join(opts.root, 'apps/web/dist');
  findings.push(...scanMapbox(opts.root, files, existsSync(distDir) ? distDir : null));
  return { findings, scanned: deps.length + files.length };
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, 'no-deps': { type: 'boolean', default: false } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const notes: string[] = [];
  const real = loadRealSide(process.env.DV_NAMES_REAL_JSON);
  const { findings, scanned } = runLicenseScan({ root, deps: values['no-deps'] ? [] : undefined, real, notes });
  for (const n of notes) console.log(n);
  process.exit(report(GATE, findings, scanned));
}

if (isMain(import.meta.url)) main();
