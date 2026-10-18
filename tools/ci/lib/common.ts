/**
 * Shared IO helpers for the M00b gates: file listing, hashing, config loading, schema validation, reporting.
 * The gate logic itself lives in packages/shared/src/assets/gates (pure); everything with IO lives here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { formatFinding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import type { IpDenylistConfig } from '../../../packages/shared/src/assets/gates/ip.ts';
import type { ConsentIndex } from '../../../packages/shared/src/assets/gates/likeness.ts';
import type { NamesFile } from '../../../packages/shared/src/assets/gates/names.ts';
import type { DependencyLicenseException } from '../../../packages/shared/src/assets/gates/license.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';

export const toolsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const schemasDir = path.join(toolsRoot, 'packages', 'shared', 'schemas');
export const MIB = 1024 * 1024;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function isMain(metaUrl: string): boolean {
  return !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
}

/** Directories never walked when no git index is available. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.wrangler', 'test-results', 'playwright-report']);

export function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(path.join(dir, r));
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(dir, r));
    } else if (st.isFile()) out.push(r);
  }
  return out;
}

/**
 * Tracked tree: git-tracked plus untracked-but-not-ignored files when `root` is a git work tree, else a directory
 * walk. Paths are POSIX-style and relative to `root`.
 */
export function listTree(root: string): string[] {
  if (existsSync(path.join(root, '.git'))) {
    const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * MIB,
    });
    if (res.status === 0) {
      return [...new Set(res.stdout.split('\0').filter(Boolean))]
        .filter((f) => existsSync(path.join(root, f)) && statSync(path.join(root, f)).isFile())
        .sort();
    }
  }
  return walk(root);
}

/** Every file under `dir` (a dist directory), relative POSIX paths; empty when it does not exist. */
export function listDist(dir: string): string[] {
  return existsSync(dir) ? walk(dir) : [];
}

export interface Configs {
  denylist: IpDenylistConfig;
  consent: ConsentIndex;
  names: NamesFile;
  licenses: {
    schema: 'license-allowlist/1';
    record: string[];
    dependency: { prod: string[]; devOnly: string[] };
    exceptions: DependencyLicenseException[];
  };
  registry: GenAiRegistry;
}

export function loadConfigs(root: string): Configs {
  const c = (n: string): string => path.join(root, 'config', n);
  return {
    denylist: readJson(c('ip-denylist.json')),
    consent: readJson(c('consent-index.json')),
    names: readJson(c('names.json')),
    licenses: readJson(c('license-allowlist.json')),
    registry: readJson(c('genai-endpoints.json')),
  };
}

type Validate = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
const validators = new Map<string, Validate>();

/** Ajv validator for packages/shared/schemas/<name>.schema.json. */
export function schemaValidator(name: string): (data: unknown) => string[] {
  let v = validators.get(name);
  if (!v) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    v = ajv.compile(readJson(path.join(schemasDir, `${name}.schema.json`))) as Validate;
    validators.set(name, v);
  }
  const fn = v;
  return (data) => {
    if (fn(data)) return [];
    return (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
  };
}

/** Provenance records: assets/provenance/<sha[0:2]>/<sha>.json. Unreadable JSON is returned with `record` undefined. */
export function loadRecords(root: string): { file: string; raw: unknown; parseError?: string }[] {
  const dir = path.join(root, 'assets', 'provenance');
  if (!existsSync(dir)) return [];
  return walk(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = `assets/provenance/${f}`;
      try {
        return { file, raw: readJson<unknown>(path.join(dir, f)) };
      } catch (e) {
        return { file, raw: null, parseError: (e as Error).message };
      }
    });
}

export function isTextFile(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  return true;
}

/** Prints findings one per line and a one-line summary last; returns the exit code. */
export function report(gate: string, findings: readonly GateFinding[], scanned: number): number {
  for (const f of findings) console.log(formatFinding(f));
  console.log(findings.length === 0 ? `${gate}: ok (${scanned} files checked)` : `${gate}: FAIL (${findings.length} findings, ${scanned} files checked)`);
  return findings.length === 0 ? 0 : 1;
}

/** Default dist directory for the web app. */
export function defaultDist(root: string): string {
  return path.join(root, 'apps', 'web', 'dist');
}
