/**
 * check:agents (M00d; spec/domains/13-qa.md section 3.8, DN-S13-01):
 *
 *   tsx tools/ci/check-agents.ts [--root <dir>]
 *
 *  - CLAUDE.md and AGENTS.md each have fewer than 200 lines; root AGENTS.md is at most 16,384 bytes (M13a6 raises the
 *    rule to root + kit at most 32,768 bytes);
 *  - every `pnpm <script>` inside an inline code span or a fenced code block of either file exists in the root
 *    package.json, or is a script of the L5 registry (08 section 6, 06 section 5, any milestone's Deliverables; entries
 *    with `*` match by prefix). After `pnpm`, a token starting with `<` or `-`, and the pnpm built-ins `install`, `exec`,
 *    `add`, `dlx`, are not script names; prose such as "pnpm workspaces" is not scanned;
 *  - every apps/*, packages/*, packages/modes/*, services/* directory holding a package.json has a README.md.
 * Prints one line per rule; exits non-zero on a breach.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/common.ts';
import { allDeclared, buildContext } from './milestone-lint.ts';
import { inRegistry, isPnpmBuiltin } from './md-parse.ts';
import { args, repoRoot } from './run.ts';

export const MAX_INSTRUCTION_LINES = 200; // exclusive: "fewer than 200"
export const MAX_AGENTS_BYTES = 16384;

export interface InstructionInput {
  name: string;
  text: string;
  /** `AGENTS.md` only. */
  maxBytes?: number;
}

export interface AgentsResult {
  ok: boolean;
  /** One line per rule, printed by the CLI. */
  lines: string[];
  failures: string[];
}

/** Script names in `pnpm <script>` commands found in code spans and fenced blocks (prose is not scanned). */
export function pnpmScriptsInCode(text: string): string[] {
  const code: string[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) code.push(line);
    else for (const m of line.matchAll(/`([^`]+)`/g)) code.push(m[1] as string);
  }
  const out: string[] = [];
  for (const c of code) {
    for (const m of c.matchAll(/\bpnpm\s+(\S+)/g)) {
      const tok = (m[1] as string).replace(/[.,;:)]+$/, '').replace(/^["']|["']$/g, '');
      if (!tok || isPnpmBuiltin(tok)) continue;
      out.push(tok);
    }
  }
  return out;
}

/** Failures of one instruction file: line count, byte size, unknown scripts. */
export function lintInstructionFile(input: InstructionInput, known: (script: string) => boolean): { lines: number; bytes: number; failures: string[] } {
  const lines = input.text.split('\n').length - (input.text.endsWith('\n') ? 1 : 0);
  const bytes = Buffer.byteLength(input.text, 'utf8');
  const failures: string[] = [];
  if (lines >= MAX_INSTRUCTION_LINES) failures.push(`${input.name} has ${lines} lines (must be fewer than ${MAX_INSTRUCTION_LINES})`);
  if (input.maxBytes !== undefined && bytes > input.maxBytes) failures.push(`${input.name} is ${bytes} bytes (limit ${input.maxBytes})`);
  for (const s of new Set(pnpmScriptsInCode(input.text))) {
    if (!known(s)) failures.push(`${input.name} names "pnpm ${s}", which is not in package.json or the script registry`);
  }
  return { lines, bytes, failures };
}

/** Workspace directories holding a package.json but no README.md (apps/*, packages/*, packages/modes/*, services/*). */
export function missingReadmes(root: string): string[] {
  const dirs: string[] = [];
  for (const parent of ['apps', 'packages', 'packages/modes', 'services']) {
    const full = path.join(root, parent);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full).sort()) {
      const d = path.join(parent, name);
      if (statSync(path.join(root, d)).isDirectory()) dirs.push(d);
    }
  }
  return dirs.filter((d) => existsSync(path.join(root, d, 'package.json')) && !existsSync(path.join(root, d, 'README.md')));
}

export function checkAgents(root: string = repoRoot): AgentsResult {
  const pkg = existsSync(path.join(root, 'package.json')) ? (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }) : {};
  const rootScripts = new Set(Object.keys(pkg.scripts ?? {}));
  const registry = allDeclared(buildContext(root, path.join(root, 'spec', '07-milestones')));
  const known = (s: string): boolean => rootScripts.has(s) || inRegistry(s, registry);
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [name, maxBytes] of [['CLAUDE.md', undefined], ['AGENTS.md', MAX_AGENTS_BYTES]] as const) {
    const p = path.join(root, name);
    if (!existsSync(p)) {
      failures.push(`${name} is missing`);
      lines.push(`FAIL  ${name}: missing`);
      continue;
    }
    const r = lintInstructionFile({ name, text: readFileSync(p, 'utf8'), ...(maxBytes !== undefined ? { maxBytes } : {}) }, known);
    failures.push(...r.failures);
    lines.push(`${r.failures.length === 0 ? 'PASS' : 'FAIL'}  ${name}: ${r.lines} lines (< ${MAX_INSTRUCTION_LINES}), ${r.bytes} bytes${maxBytes !== undefined ? ` (<= ${maxBytes})` : ''}, scripts ${r.failures.some((f) => f.includes('names "pnpm')) ? 'unknown present' : 'all known'}`);
    for (const f of r.failures) lines.push(`      ${f}`);
  }
  const noReadme = missingReadmes(root);
  for (const d of noReadme) failures.push(`${d} has a package.json but no README.md`);
  lines.push(`${noReadme.length === 0 ? 'PASS' : 'FAIL'}  README.md in every workspace directory${noReadme.length ? `: missing ${noReadme.join(', ')}` : ''}`);
  return { ok: failures.length === 0, lines, failures };
}

function main(): void {
  const argv = args();
  const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1] as string) : repoRoot;
  const res = checkAgents(root);
  for (const l of res.lines) console.log(l);
  console.log(res.ok ? 'check:agents passed' : `check:agents failed (${res.failures.length})`);
  process.exit(res.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
