/**
 * Secret scanner.
 *
 *   tsx tools/ci/check-secrets.ts            scans the git-tracked tree
 *   tsx tools/ci/check-secrets.ts <dir>      scans a directory (for example apps/web/dist)
 *
 * Reports file, line and pattern name; never prints the matched value. Exit 1 on any finding.
 * Patterns are value shapes (a prefix plus a long token body), so prose that merely names a prefix is not flagged.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

export interface Pattern {
  name: string;
  re: RegExp;
}

export const PATTERNS: readonly Pattern[] = [
  { name: 'cloudflare-api-token (cfat_)', re: /\bcfat_[A-Za-z0-9]{24,}/ },
  { name: 'cloudflare-user-token (cfut_)', re: /\bcfut_[A-Za-z0-9]{24,}/ },
  { name: 'cloudflare-global-key (cfk_)', re: /\bcfk_[A-Za-z0-9]{24,}/ },
  { name: 'supabase-access-token (sbp_)', re: /\bsbp_[A-Za-z0-9]{24,}/ },
  { name: 'supabase-secret-key (sb_secret_)', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'anthropic-key (sk-ant-)', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'fal-key', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/ },
  { name: 'pem-private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
];

export interface Finding {
  file: string;
  line: number;
  pattern: string;
}

export function scanText(text: string, file = '<text>'): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const p of PATTERNS) if (p.re.test(line)) findings.push({ file, line: i + 1, pattern: p.name });
  });
  return findings;
}

const MAX_BYTES = 8 * 1024 * 1024;

function scanFile(abs: string, label: string): Finding[] {
  let size: number;
  try {
    size = statSync(abs).size;
  } catch {
    return [];
  }
  if (size === 0 || size > MAX_BYTES) return [];
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return [];
  return scanText(buf.toString('utf8'), label);
}

export function trackedFiles(cwd: string): string[] {
  const res = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return res.stdout.split('\0').filter(Boolean);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export function scanTracked(cwd: string): Finding[] {
  return trackedFiles(cwd).flatMap((f) => scanFile(path.join(cwd, f), f));
}

export function scanDir(dir: string): Finding[] {
  return walk(dir).flatMap((f) => scanFile(f, path.relative(dir, f)));
}

export function main(argv: string[]): number {
  const [dir] = argv;
  const findings = dir ? scanDir(path.resolve(dir)) : scanTracked(repoRoot);
  const target = dir ?? 'the git-tracked tree';
  if (findings.length === 0) {
    console.log(`check:secrets ok: no secret patterns in ${target}`);
    return 0;
  }
  for (const f of findings) console.error(`check:secrets FAIL ${f.file}:${f.line} matches ${f.pattern}`);
  console.error(`check:secrets: ${findings.length} finding(s) in ${target}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
