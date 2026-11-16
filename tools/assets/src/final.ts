/**
 * The placeholder scan (M10d2, DL-390; `pnpm assets:final`): no gray-box stand-in reaches a release unnoticed. The pure core
 * `artFinal(input)` is what M14b3's `art-final` launch gate imports; the CLI below reads the repository into its input.
 *
 * Rules (a finding names file and ref):
 *   1. an AssetRef matching `^[a-z_]+/graybox\.` appears in `assets/prefabs/**`, `content/**`, `config/**` (the registry itself
 *      excluded) or the catalog (every asset spec under `assets/src` and every entry of the world locks);
 *   2. a registry row has an empty `replacedBy`, or a `replacedBy` ref that is not in the catalog (a `code/<name>` ref resolves to the
 *      module `CODE_REFS` names, a trailing `*` to any catalog ref with that prefix);
 *   3. a row with `holds: { file, pointer }` does not hold its `replacedBy` refs at that JSON pointer of that file.
 * A finding of rules 1 and 2 also names the registry row that owns its ref (`row`), so a test can say who still owes art.
 * `--json` prints `{ status: 'pass'|'pending', findings[] }`. The scan exits 1 while anything is pending.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { args } from '../../ci/run.ts';
import { isMain, toolsRoot } from '../../ci/lib/common.ts';
import { REGISTRY_FILE, readRegistry, rowOf, type PlaceholderRegistry, type PlaceholderRow } from './placeholders.ts';
import { loadSpecs } from './spec.ts';

export const GRAYBOX_RE = /^[a-z_]+\/graybox\./;
/** An AssetRef inside a text: `<kind>/graybox.<id>`. */
const GRAYBOX_IN_TEXT = /(?<![a-z0-9_./-])[a-z_]+\/graybox\.[a-z0-9][a-z0-9._-]*/g;

/** Placeholders that live in code are replaced by code: the module that stands for each `code/<name>` ref (BD-M10d2-01). */
export const CODE_REFS: Readonly<Record<string, string>> = {
  'code/facade-atlas': 'packages/world/src/client/chunks/facade.ts',
  'code/atmosphere-takram': 'packages/world/src/client/sky/atmosphere-takram.ts',
};

export type ArtFinalRule = 1 | 2 | 3;

export interface ArtFinalFinding {
  file: string;
  ref: string;
  rule: ArtFinalRule;
  /** The registry row that owns the ref (rules 1 and 2), when one does. */
  row?: string;
}

export interface ArtFinalResult {
  status: 'pass' | 'pending';
  findings: ArtFinalFinding[];
}

/** A registry row as the scan reads it: the M10d1 shape plus the optional `holds` of rule 3. */
export type FinalRow = PlaceholderRow & { holds?: { file: string; pointer: string } };

export interface ArtFinalInput {
  registry: PlaceholderRegistry;
  /** Repo-relative path of the registry (default `config/art-placeholders.json`). */
  registryFile?: string;
  /** The scanned texts (prefabs, content, config), repo-relative paths; the registry is skipped when listed. */
  files: readonly { path: string; text: string }[];
  /** The catalog: every AssetRef with the file that declares it. */
  catalog: readonly { ref: string; file: string }[];
  /** `code/<name>` refs whose module exists. */
  codeRefs?: ReadonlySet<string>;
  /** Reads a JSON file for rule 3 (undefined when it does not exist or does not parse). */
  readJson?: (file: string) => unknown;
}

/** RFC 6901 pointer lookup; undefined when a step is missing. */
export function atPointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (cur !== null && typeof cur === 'object') cur = (cur as Record<string, unknown>)[key];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

function holdsRef(value: unknown, ref: string): boolean {
  if (typeof value === 'string') return value === ref;
  if (Array.isArray(value)) return value.some((v) => holdsRef(v, ref));
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((v) => holdsRef(v, ref));
  return false;
}

/** Pure: the scan of the three rules over an input the caller gathered. Findings are sorted by rule, file, ref. */
export function artFinal(input: ArtFinalInput): ArtFinalResult {
  const regFile = input.registryFile ?? REGISTRY_FILE;
  const reg = input.registry;
  const out: ArtFinalFinding[] = [];
  const add = (f: ArtFinalFinding): void => {
    if (!out.some((o) => o.file === f.file && o.ref === f.ref && o.rule === f.rule)) out.push(f);
  };
  const owner = (ref: string): string | undefined => rowOf(reg, ref)?.id;

  // rule 1: gray-box refs in the scanned files and in the catalog
  for (const f of input.files) {
    if (f.path === regFile) continue;
    for (const m of f.text.matchAll(GRAYBOX_IN_TEXT)) {
      const ref = m[0];
      const row = owner(ref);
      add(row === undefined ? { file: f.path, ref, rule: 1 } : { file: f.path, ref, rule: 1, row });
    }
  }
  for (const c of input.catalog) {
    if (!GRAYBOX_RE.test(c.ref)) continue;
    const row = owner(c.ref);
    add(row === undefined ? { file: c.file, ref: c.ref, rule: 1 } : { file: c.file, ref: c.ref, rule: 1, row });
  }

  // rule 2: every row is filled and every replacement resolves
  const known = new Set(input.catalog.map((c) => c.ref));
  const code = input.codeRefs ?? new Set<string>();
  const resolves = (ref: string): boolean => {
    if (ref.startsWith('code/')) return code.has(ref);
    if (ref.endsWith('*')) {
      const prefix = ref.slice(0, -1);
      return [...known].some((k) => k.startsWith(prefix));
    }
    return known.has(ref);
  };
  for (const row of reg.rows as FinalRow[]) {
    if (row.replacedBy.length === 0) add({ file: regFile, ref: row.id, rule: 2, row: row.id });
    for (const ref of row.replacedBy) if (!resolves(ref)) add({ file: regFile, ref, rule: 2, row: row.id });
    // rule 3: the file and pointer the row names hold its replacements
    if (row.holds) {
      const doc = input.readJson?.(row.holds.file);
      const value = doc === undefined ? undefined : atPointer(doc, row.holds.pointer);
      for (const ref of row.replacedBy) {
        if (!holdsRef(value, ref)) add({ file: `${row.holds.file}#${row.holds.pointer}`, ref, rule: 3, row: row.id });
      }
    }
  }

  out.sort((a, b) => a.rule - b.rule || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return { status: out.length === 0 ? 'pass' : 'pending', findings: out };
}

// ---- reading the repository ------------------------------------------------------------------------------------------------

const TEXT_EXT = new Set(['.json', '.jsonc', '.md', '.ink', '.txt', '.yaml', '.yml', '.csv', '.ts']);

function walk(root: string, rel: string, out: string[]): void {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs).sort()) {
    const r = `${rel}/${name}`;
    const st = statSync(path.join(root, r));
    if (st.isDirectory()) walk(root, r, out);
    else if (TEXT_EXT.has(path.extname(name))) out.push(r);
  }
}

/** The scanned files of rule 1: text files under `assets/prefabs`, `content` and `config`. */
export function scanFiles(root: string): { path: string; text: string }[] {
  const paths: string[] = [];
  for (const dir of ['assets/prefabs', 'content', 'config']) walk(root, dir, paths);
  return paths.map((p) => ({ path: p, text: readFileSync(path.join(root, p), 'utf8') }));
}

/** The catalog: asset specs under `assets/src` plus the entries of every world lock (`assets/world/*.lock.json`). */
export function repoCatalog(root: string): { ref: string; file: string }[] {
  const out: { ref: string; file: string }[] = loadSpecs(root).specs.map((s) => ({ ref: s.ref, file: s.specPath }));
  const dir = path.join(root, 'assets/world');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.lock.json')).sort()) {
      const lock = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { entries?: Record<string, unknown> };
      for (const ref of Object.keys(lock.entries ?? {}).sort()) out.push({ ref, file: `assets/world/${name}` });
    }
  }
  return out;
}

export function repoInput(root: string): ArtFinalInput {
  const codeRefs = new Set(Object.entries(CODE_REFS).filter(([, file]) => existsSync(path.join(root, file))).map(([ref]) => ref));
  return {
    registry: readRegistry(root),
    files: scanFiles(root),
    catalog: repoCatalog(root),
    codeRefs,
    readJson: (file) => {
      try {
        return JSON.parse(readFileSync(path.join(root, file), 'utf8')) as unknown;
      } catch {
        return undefined;
      }
    },
  };
}

function main(): number {
  const argv = args();
  const json = argv.includes('--json');
  const res = artFinal(repoInput(toolsRoot));
  if (json) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  } else {
    for (const f of res.findings) console.log(`rule ${f.rule}  ${f.file}  ${f.ref}${f.row ? `  (row ${f.row})` : ''}`);
    console.log(`assets:final: ${res.status} (${res.findings.length} finding${res.findings.length === 1 ? '' : 's'})`);
  }
  return res.status === 'pass' ? 0 : 1;
}

if (isMain(import.meta.url)) process.exit(main());
