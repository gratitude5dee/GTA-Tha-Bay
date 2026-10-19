/**
 * Field-subset extraction for vendored data files (ADR-REUSE-01 step 3, DL-502). For the operator at vendoring.
 *
 *   tsx tools/ci/third-party-subset.ts [--root <dir>] <entry> <allowedPath> <upstreamFile>
 *
 * Reads an upstream JSON (array of objects) or CSV file given by path, keeps only the `fields` names of the named
 * allowedPaths item, and writes third_party/<entry>/<allowedPath> as canonical JSON, rows in upstream order. It
 * refuses a `fields` list that license:scan would fail (name pattern or value rule). It never fetches anything.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { NamesFile } from '../../packages/shared/src/assets/gates/names.ts';
import { canonicalize } from '../../packages/shared/src/json.ts';
import { args } from './run.ts';
import { isMain, toolsRoot } from './lib/common.ts';
import { excludedFieldProblems, loadRegister, reuseEntries, valueProblems } from './lib/third-party.ts';
import { loadRealSide } from './names-lint.ts';

export interface SubsetOptions {
  root: string;
  entry: string;
  allowedPath: string;
  upstreamFile: string;
  real?: NamesFile | null | undefined;
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function extractSubset(opts: SubsetOptions): { file: string; rows: number } {
  const reg = loadRegister(opts.root);
  if (!reg) throw new Error('docs/legal/third-party-reuse.json not found under the root');
  const entry = reuseEntries(reg).find((e) => e.name === opts.entry);
  if (!entry) throw new Error(`no REUSE-WITH-ATTRIBUTION entry named "${opts.entry}"`);
  const item = entry.allowedPaths?.find((i) => i.path === opts.allowedPath);
  if (!item) throw new Error(`entry ${opts.entry} has no allowedPaths item "${opts.allowedPath}"`);
  if (item.kind !== 'data' || !item.path.endsWith('.subset.json') || item.modified !== true) {
    throw new Error('the item must be kind data, end in .subset.json and have modified: true');
  }
  const names = (item.fields ?? []).map((f) => f.name);
  if (names.length === 0) throw new Error('the item has no fields');
  const problems = excludedFieldProblems(reg, names);
  if (problems.length > 0) throw new Error(`refused: ${problems.join('; ')}`);
  const text = readFileSync(opts.upstreamFile, 'utf8');
  let rows: Array<Record<string, unknown>>;
  if (opts.upstreamFile.toLowerCase().endsWith('.csv')) rows = parseCsv(text);
  else {
    const doc: unknown = JSON.parse(text);
    if (!Array.isArray(doc)) throw new Error('upstream JSON must be an array of objects');
    rows = doc as Array<Record<string, unknown>>;
  }
  for (const n of names) {
    if (rows.length > 0 && !rows.some((r) => n in r)) throw new Error(`upstream file has no column "${n}"`);
  }
  const kept = rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n] ?? ''])));
  const vp = valueProblems(kept, names, opts.real);
  if (vp.length > 0) throw new Error(`refused: ${vp.join('; ')}`);
  const out = path.join(opts.root, 'third_party', opts.entry, item.path);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${canonicalize(kept)}\n`);
  return { file: out, rows: kept.length };
}

function main(): void {
  const { values, positionals } = parseArgs({ args: args(), allowPositionals: true, options: { root: { type: 'string' } } });
  const [entry, allowedPath, upstreamFile] = positionals;
  if (!entry || !allowedPath || !upstreamFile) {
    console.error('usage: reuse:subset -- [--root <dir>] <entry> <allowedPath> <upstreamFile>');
    process.exit(2);
  }
  const root = path.resolve(values.root ?? toolsRoot);
  if (!existsSync(path.resolve(upstreamFile))) {
    console.error(`reuse:subset: ${upstreamFile} does not exist`);
    process.exit(2);
  }
  const real = loadRealSide(process.env.DV_NAMES_REAL_JSON);
  if (!real) console.log('SKIP reuse subset values: DV_NAMES_REAL_JSON not set');
  try {
    const res = extractSubset({ root, entry, allowedPath, upstreamFile: path.resolve(upstreamFile), real });
    console.log(`reuse:subset: wrote ${path.relative(root, res.file)} (${res.rows} rows)`);
  } catch (e) {
    console.error(`reuse:subset: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
