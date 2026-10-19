/**
 * reuse:clones. Token-level clone check between vendored kind 'code' files under third_party/ and every tracked
 * source file outside third_party/, fixtures, spec/, research/, prompt-pack/ and docs/ (ADR-REUSE-01, DL-616).
 * A match in a file whose header does not resolve to the matched allowedPaths item fails. Reports file and line
 * pairs only, never matched text. Needs no network; a no-op without third_party/.
 *
 *   tsx tools/ci/reuse-clones.ts [--root <dir>] [--window <n>]
 *
 * Tokens: comments and whitespace are dropped, string and template literals become one token (quote style does not
 * matter), identifiers and numbers keep their text (BD-M00f-04).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import { args } from './run.ts';
import { isMain, listTree, report, toolsRoot } from './lib/common.ts';
import { findItem, hasThirdParty, loadRegister, parsePortionsHeaders, readText, reuseEntries, sourceFiles } from './lib/third-party.ts';

const GATE = 'reuse:clones';
export const DEFAULT_WINDOW = 50;

export interface Token { text: string; line: number }

const TOKEN_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|\d[\w.]*|\n|\S/g;

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  for (const m of src.matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t === '\n') {
      line++;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('/*')) {
      line += t.split('\n').length - 1;
      continue;
    }
    const first = t[0] as string;
    if (first === '"' || first === "'" || first === '`') {
      out.push({ text: 'STR', line });
      line += t.split('\n').length - 1;
    } else out.push({ text: t, line });
  }
  return out;
}

function hashWindow(tokens: readonly Token[], start: number, size: number): string {
  let s = '';
  for (let i = start; i < start + size; i++) s += `${tokens[i]?.text}\u0001`;
  return s;
}

export interface CloneScanOptions { window?: number | undefined; tree?: readonly string[] | undefined }

export function scanClones(root: string, opts: CloneScanOptions = {}): { findings: GateFinding[]; scanned: number } {
  const findings: GateFinding[] = [];
  if (!hasThirdParty(root)) return { findings, scanned: 0 };
  const size = opts.window ?? DEFAULT_WINDOW;
  const tree = opts.tree ?? listTree(root);
  const reg = loadRegister(root);
  // window text -> [(vendored ref, line)]
  const index = new Map<string, Array<{ ref: string; line: number }>>();
  for (const entry of reuseEntries(reg)) {
    for (const item of entry.allowedPaths ?? []) {
      if (item.kind !== 'code') continue;
      const rel = `third_party/${entry.name}/${item.path}`;
      const text = readText(root, rel);
      if (text === null) continue;
      const toks = tokenize(text);
      for (let i = 0; i + size <= toks.length; i++) {
        const key = hashWindow(toks, i, size);
        const list = index.get(key) ?? [];
        list.push({ ref: `${entry.name}/${item.path}`, line: (toks[i] as Token).line });
        index.set(key, list);
      }
    }
  }
  const files = sourceFiles(root, tree);
  for (const file of files) {
    const text = readText(root, file);
    if (text === null) continue;
    const headers = parsePortionsHeaders(text);
    const toks = tokenize(text);
    // matched upstream ref -> line pairs
    const hits = new Map<string, Array<[number, number]>>();
    for (let i = 0; i + size <= toks.length; i++) {
      const found = index.get(hashWindow(toks, i, size));
      if (!found) continue;
      for (const f of found) {
        const list = hits.get(f.ref) ?? [];
        list.push([(toks[i] as Token).line, f.line]);
        hits.set(f.ref, list);
      }
    }
    for (const [ref, pairs] of hits) {
      const covered = headers.some((h) => `${h.name}/${h.path}` === ref && findItem(reg, h) !== null);
      if (covered) continue;
      const lines = [...new Set(pairs.map(([a, b]) => `${a}~${b}`))].slice(0, 8).join(', ');
      findings.push(finding(GATE, file, 'clone-without-header', `${pairs.length} matching ${size}-token windows with third_party/${ref} (file line~upstream line: ${lines}); add the header or remove the copy`));
    }
  }
  return { findings, scanned: files.length };
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, window: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  if (!hasThirdParty(root)) {
    console.log('reuse:clones: no third_party/, nothing to check');
    return;
  }
  const res = scanClones(root, { window: values.window ? Number(values.window) : undefined });
  process.exit(report(GATE, res.findings, res.scanned));
}

if (isMain(import.meta.url)) main();
