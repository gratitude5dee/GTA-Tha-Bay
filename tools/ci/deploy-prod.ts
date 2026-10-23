/**
 * Production-style deploy of the web Worker (spec/domains/09-backend-ops.md section 2, step 3).
 *
 *   build -> versions upload (tagged) -> find the current version -> versions deploy NEW@0% OLD@100%
 *   -> smoke with the version override header -> versions deploy NEW@100% -> on any failure wrangler rollback OLD
 *
 * A pull request labelled do-lifecycle (a Durable Object class change) takes `wrangler deploy` instead and records
 * a rollback floor, because rollback cannot cross a DO lifecycle change.
 *
 * The wrangler calls go through an injected `Exec` so the control flow is tested without a network.
 */
import { readFileSync } from 'node:fs';

export interface ProdOptions {
  /** wrangler --env value; undefined targets the top-level (production) Worker. */
  env?: string | undefined;
  /** Name of the Worker being deployed (used in the version-override header). */
  workerName: string;
  /** 12-character commit id used as version tag and BUILD_ID. */
  sha12: string;
  /** Version message (commit title). */
  title: string;
  secretsFile: string;
  /** Base URL for the smoke test; when absent it is taken from wrangler output or the config. */
  url?: string | undefined;
  doLifecycle: boolean;
  /** Where wrangler writes ND-JSON events (WRANGLER_OUTPUT_FILE_PATH). */
  outputFile: string;
}

export interface ExecResult {
  status: number;
  out: string;
}
export type Exec = (cmd: readonly string[], extraEnv?: Record<string, string>) => ExecResult;

const PLACEHOLDER_NEW = '<NEW>';
const PLACEHOLDER_OLD = '<OLD>';

function envArgs(o: ProdOptions): string[] {
  return o.env ? ['--env', o.env] : [];
}

function wr(args: readonly string[]): string[] {
  return ['pnpm', '--filter', '@dv/edge', 'exec', 'wrangler', ...args];
}

export function uploadCmd(o: ProdOptions): string[] {
  return wr([
    'versions', 'upload', ...envArgs(o),
    '--tag', o.sha12,
    '--message', o.title,
    '--secrets-file', o.secretsFile,
    '--var', `BUILD_ID:${o.sha12}`,
  ]);
}
export const statusCmd = (o: ProdOptions): string[] => wr(['deployments', 'status', '--json', ...envArgs(o)]);
export const listCmd = (o: ProdOptions): string[] => wr(['versions', 'list', '--json', ...envArgs(o)]);
export const splitCmd = (o: ProdOptions, next: string, old: string): string[] =>
  wr(['versions', 'deploy', `${next}@0%`, `${old}@100%`, '-y', '--message', `${o.sha12} smoke`, ...envArgs(o)]);
export const fullCmd = (o: ProdOptions, next: string): string[] =>
  wr(['versions', 'deploy', `${next}@100%`, '-y', '--message', `${o.sha12} promote`, ...envArgs(o)]);
export const rollbackCmd = (o: ProdOptions, old: string): string[] =>
  wr(['rollback', old, '--message', 'auto', '-y', ...envArgs(o)]);
export const plainDeployCmd = (o: ProdOptions): string[] =>
  wr(['deploy', '--var', `BUILD_ID:${o.sha12}`, '--message', o.title, ...envArgs(o)]);
export function smokeCmd(o: ProdOptions, url: string, version?: string): string[] {
  return ['pnpm', 'check:smoke', '--', url, ...(version ? ['--version', version] : []), '--worker', o.workerName];
}

const q = (parts: readonly string[]): string => parts.map((p) => (/[\s"]/.test(p) ? JSON.stringify(p) : p)).join(' ');

/** The command plan `--dry-run` prints. No network, no credentials. */
export function planProd(o: ProdOptions): string[] {
  const url = o.url ?? '<url>';
  if (o.doLifecycle) {
    return [
      '1. build:      pnpm build',
      `2. current:    ${q(statusCmd(o))}   (rollback floor)`,
      `3. deploy:     ${q(plainDeployCmd(o))}   (do-lifecycle: plain deploy, no gradual split)`,
      `4. smoke:      ${q(smokeCmd(o, url))}`,
      '5. print:      rollback floor: <OLD>',
    ];
  }
  return [
    '1. build:      pnpm build',
    `2. secrets:    write ${o.secretsFile} ({})`,
    `3. upload:     ${q(uploadCmd(o))}   (WRANGLER_OUTPUT_FILE_PATH=${o.outputFile}; version_id -> ${PLACEHOLDER_NEW})`,
    `4. current:    ${q(statusCmd(o))}   (fallback: ${q(listCmd(o))}; version -> ${PLACEHOLDER_OLD})`,
    `5. 0% deploy:  ${q(splitCmd(o, PLACEHOLDER_NEW, PLACEHOLDER_OLD))}`,
    `6. smoke:      ${q(smokeCmd(o, url, PLACEHOLDER_NEW))}   (sends Cloudflare-Workers-Version-Overrides: ${o.workerName}="${PLACEHOLDER_NEW}")`,
    `7. 100% deploy: ${q(fullCmd(o, PLACEHOLDER_NEW))}`,
    `8. on failure after step 3: ${q(rollbackCmd(o, PLACEHOLDER_OLD))}`,
  ];
}

// ---------------------------------------------------------------------------------------------
// Parsing (defensive: the shapes below are not in the ledger, U-BE-20)

function eachJsonDoc(text: string): unknown[] {
  const docs: unknown[] = [];
  const whole = text.trim();
  try {
    docs.push(JSON.parse(whole));
    return docs;
  } catch {
    /* banner-prefixed or multi-doc output */
  }
  // Wrangler banners and config warnings ride on stderr, which the exec plumbing merges into the captured output: a JSON
  // document is the suffix starting at a line that opens with '{' or '[' (pretty-printed docs don't parse line-by-line).
  const lines = whole.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      docs.push(JSON.parse(lines.slice(i).join('\n')));
      return docs;
    } catch {
      try {
        docs.push(JSON.parse(t));
      } catch {
        /* not JSON */
      }
    }
  }
  return docs;
}

function findKey(value: unknown, keys: readonly string[]): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const f = findKey(v, keys);
      if (f) return f;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (keys.includes(k) && typeof v === 'string' && v) return v;
    for (const v of Object.values(value)) {
      const f = findKey(v, keys);
      if (f) return f;
    }
  }
  return null;
}

/** version_id from the ND-JSON that `wrangler versions upload` writes to WRANGLER_OUTPUT_FILE_PATH. */
export function parseVersionId(ndjson: string): string | null {
  for (const doc of eachJsonDoc(ndjson)) {
    const id = findKey(doc, ['version_id', 'versionId']);
    if (id) return id;
  }
  return null;
}

interface VersionEntry {
  id: string;
  percentage: number | null;
  created: string;
}

function collectVersions(value: unknown, out: VersionEntry[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectVersions(v, out);
  } else if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const id = [o['version_id'], o['versionId'], o['id']].find((x): x is string => typeof x === 'string' && x.length > 0);
    if (id) {
      const pct = typeof o['percentage'] === 'number' ? o['percentage'] : null;
      const meta = (o['metadata'] ?? {}) as Record<string, unknown>;
      const created = [o['created_on'], o['createdOn'], meta['created_on']].find((x): x is string => typeof x === 'string') ?? '';
      out.push({ id, percentage: pct, created });
    }
    for (const v of Object.values(o)) if (typeof v === 'object') collectVersions(v, out);
  }
}

/**
 * The version currently taking 100 % of traffic, from `deployments status --json` (or, as a fallback,
 * `versions list --json`). Returns null when nothing parses: the caller must then stop before `versions deploy`.
 */
export function parseCurrentVersion(output: string, exclude?: string): string | null {
  const entries: VersionEntry[] = [];
  for (const doc of eachJsonDoc(output)) collectVersions(doc, entries);
  const candidates = entries.filter((e) => e.id !== exclude);
  const full = candidates.find((e) => e.percentage === 100);
  if (full) return full.id;
  const byPct = [...candidates].filter((e) => e.percentage !== null).sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
  if (byPct) return byPct.id;
  // versions list: no percentages; newest by creation time.
  const newest = [...candidates].sort((a, b) => b.created.localeCompare(a.created))[0];
  return newest && newest.created ? newest.id : null;
}

export function parseWorkersDevUrl(output: string): string | null {
  const m = /https:\/\/[A-Za-z0-9.-]+\.workers\.dev/.exec(output);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------------------------
// Execution

export interface ProdResult {
  code: number;
  newVersion?: string;
  oldVersion?: string;
  rolledBack?: boolean;
  message: string;
}

export interface Deps {
  exec: Exec;
  build: () => number;
  writeSecrets: (file: string) => void;
  readOutputFile: (file: string) => string;
  configUrl: () => string;
  log: (line: string) => void;
}

function currentVersion(o: ProdOptions, d: Deps, exclude?: string): string | null {
  const status = d.exec(statusCmd(o));
  let id = status.status === 0 ? parseCurrentVersion(status.out, exclude) : null;
  if (!id) {
    d.log('deployments status did not yield a current version; falling back to versions list');
    const list = d.exec(listCmd(o));
    id = list.status === 0 ? parseCurrentVersion(list.out, exclude) : null;
  }
  return id;
}

export function runProd(o: ProdOptions, d: Deps): ProdResult {
  if (d.build() !== 0) return { code: 1, message: 'build failed' };

  if (o.doLifecycle) {
    const old = currentVersion(o, d);
    d.log(`rollback floor: ${old ?? 'unknown'}`);
    const dep = d.exec(plainDeployCmd(o));
    if (dep.status !== 0) return { code: dep.status, ...(old ? { oldVersion: old } : {}), message: 'wrangler deploy failed' };
    const url = o.url ?? parseWorkersDevUrl(dep.out) ?? d.configUrl();
    const smoke = d.exec(smokeCmd(o, url));
    if (smoke.status !== 0) return { code: 1, ...(old ? { oldVersion: old } : {}), message: 'smoke failed after do-lifecycle deploy (rollback cannot cross it)' };
    d.log(`rollback floor: ${old ?? 'unknown'}`);
    return { code: 0, ...(old ? { oldVersion: old } : {}), message: 'do-lifecycle deploy ok' };
  }

  d.writeSecrets(o.secretsFile);
  const up = d.exec(uploadCmd(o), { WRANGLER_OUTPUT_FILE_PATH: o.outputFile });
  if (up.status !== 0) return { code: up.status, message: 'versions upload failed' };
  const next = parseVersionId(d.readOutputFile(o.outputFile)) ?? parseVersionId(up.out);
  if (!next) return { code: 1, message: 'could not read version_id from wrangler output' };

  const old = currentVersion(o, d, next);
  if (!old) return { code: 1, newVersion: next, message: 'no rollback target found: stopping before versions deploy' };

  const url = o.url ?? parseWorkersDevUrl(up.out) ?? d.configUrl();
  const fail = (message: string): ProdResult => {
    d.log(`${message}; rolling back to ${old}`);
    const rb = d.exec(rollbackCmd(o, old));
    return { code: 1, newVersion: next, oldVersion: old, rolledBack: rb.status === 0, message };
  };

  if (d.exec(splitCmd(o, next, old)).status !== 0) return fail('versions deploy at 0% failed');
  if (d.exec(smokeCmd(o, url, next)).status !== 0) return fail('smoke test at 0% failed');
  if (d.exec(fullCmd(o, next)).status !== 0) return fail('versions deploy at 100% failed');
  return { code: 0, newVersion: next, oldVersion: old, message: `version ${next} is at 100%` };
}

export function readTextIfExists(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
