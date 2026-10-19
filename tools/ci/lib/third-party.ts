/**
 * Register-driven checks for third_party/ (ADR-REUSE-01, M00f). Pure of process state: every function takes the
 * repository root, so tests run them on fixture trees. Nothing here fetches anything.
 *
 * The register is docs/legal/third-party-reuse.json (schema third-party-reuse/1). A "vendored" entry is a
 * REUSE-WITH-ATTRIBUTION entry; every rule is a no-op while third_party/ does not exist.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { looksBinary } from '../../../packages/shared/src/assets/gates/ip.ts';
import { compileRealNames, scanRealNames } from '../../../packages/shared/src/assets/gates/names.ts';
import type { NamesFile } from '../../../packages/shared/src/assets/gates/names.ts';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { listTree, sha256Hex } from './common.ts';

export const REGISTER_PATH = 'docs/legal/third-party-reuse.json';
export const MAX_ENUM_VALUES = 32;

export interface FieldSpec { name: string; note?: string }
export interface AllowedPathItem {
  path: string;
  spdx: string;
  kind: 'code' | 'data';
  fields?: FieldSpec[];
  modified?: boolean;
}
export interface LicenceFileItem { path: string; spdx: string }
export interface RegisterEntry {
  name?: string;
  repo?: string;
  url?: string;
  verdict: string;
  pinnedSha?: string | null;
  allowedPaths?: AllowedPathItem[];
  licenceFiles?: LicenceFileItem[];
}
export interface Register {
  thirdPartyLicences?: { code?: string[]; dataOnly?: string[] };
  excludedFieldPatterns?: string[];
  entries: RegisterEntry[];
}

export function loadRegister(root: string): Register | null {
  const file = path.join(root, REGISTER_PATH);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Register;
}

export function reuseEntries(reg: Register | null): RegisterEntry[] {
  return (reg?.entries ?? []).filter((e) => e.verdict === 'REUSE-WITH-ATTRIBUTION' && typeof e.name === 'string');
}

/** An entry with a pinned SHA and at least one allowed item: something is, or may be, vendored. */
export function vendoredEntries(reg: Register | null): RegisterEntry[] {
  return reuseEntries(reg).filter((e) => !!e.pinnedSha && (e.allowedPaths ?? []).length > 0);
}

export function hasThirdParty(root: string): boolean {
  return existsSync(path.join(root, 'third_party'));
}

export function readText(root: string, rel: string): string | null {
  const file = path.join(root, rel);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  return looksBinary(bytes) ? null : bytes.toString('utf8');
}

// ---------------------------------------------------------------------------------------------
// "Portions from" headers

/** Built from fragments so this file never matches its own header regex. */
const PORTIONS = ['Portions', 'from'].join(' ');
const HEADER_RE = new RegExp(`${PORTIONS}\\s+\`?third_party/([a-z0-9][a-z0-9._-]*)/([^\\s\`]+)`, 'g');

export interface PortionsHeader { name: string; path: string }

export function parsePortionsHeaders(text: string): PortionsHeader[] {
  const out: PortionsHeader[] = [];
  for (const m of text.matchAll(HEADER_RE)) {
    out.push({ name: m[1] as string, path: (m[2] as string).replace(/[.,;:)]+$/, '') });
  }
  return out;
}

const CODE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export const isCodeFile = (rel: string): boolean => CODE_EXT.test(rel);

const SKIP_PREFIXES = ['third_party/', 'tools/ci/fixtures/', 'spec/', 'research/', 'prompt-pack/', 'docs/', '.claude/'];

/** Source files that may carry a header: tracked code files outside third_party/, fixtures and documentation. */
export function sourceFiles(root: string, tree: readonly string[] = listTree(root)): string[] {
  return tree.filter((f) => isCodeFile(f) && !SKIP_PREFIXES.some((p) => f.startsWith(p)));
}

export function findItem(reg: Register | null, h: PortionsHeader): { entry: RegisterEntry; item: AllowedPathItem } | null {
  const entry = reuseEntries(reg).find((e) => e.name === h.name);
  const item = entry?.allowedPaths?.find((i) => i.path === h.path);
  return entry && item ? { entry, item } : null;
}

// ---------------------------------------------------------------------------------------------
// NOTICE lines

export interface NoticeLine { raw: string; ref: string; spdx: string; creator: string; url: string; modified: boolean; parts: number }

export function parseNotice(text: string): { lines: NoticeLine[]; bad: string[] } {
  const lines: NoticeLine[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(' | ').map((p) => p.trim());
    const ok = parts.length >= 3 && parts.length <= 5 && /^[a-z0-9][a-z0-9._-]*\/\S+$/.test(parts[0] as string) && parts.every((p) => p !== '');
    const last = parts[parts.length - 1];
    const modified = parts.length >= 4 && last === 'modified';
    if (!ok || (parts.length === 5 && !modified)) {
      bad.push(raw);
      continue;
    }
    const url = parts.length === 4 && modified ? '' : (parts[3] ?? '');
    lines.push({ raw: line, ref: parts[0] as string, spdx: parts[1] as string, creator: parts[2] as string, url, modified, parts: parts.length });
  }
  return { lines, bad };
}

export function noticeFor(notice: readonly NoticeLine[], entryName: string, item: AllowedPathItem): NoticeLine | undefined {
  return notice.find((l) => l.ref === `${entryName}/${item.path}`);
}

// ---------------------------------------------------------------------------------------------
// excluded fields

export function compilePatterns(reg: Register | null): RegExp[] {
  return (reg?.excludedFieldPatterns ?? []).map((p) => new RegExp(p, 'i'));
}

/** Class label for a pattern, used in messages so a reviewer sees which kind of field was refused. */
const CLASSES: Array<[RegExp, string]> = [
  [/^(?:url|website|link|domain)$/, 'URL'],
  [/^(?:lat|lon|lng|coord|geo)$/, 'coordinate'],
  [/^(?:address|street|zip|postal)$/, 'address'],
  [/^(?:neighbo|district)$/, 'neighbourhood'],
  [/^osm$/, 'OSM id'],
  [/^(?:person|people|founder|ceo)$/, 'person'],
  [/^(?:logo|image|icon)$/, 'logo'],
  [/^(?:desc|tagline|blurb|summary|about)$/, 'tagline'],
  [/^city$/, 'city'],
  [/^building$/, 'building id'],
  [/^footprint$/, 'footprint link'],
  [/^(?:location|place)$/, 'location'],
  [/^(?:name|company|org|title)$/, 'name'],
];

export function excludedClass(pattern: string): string {
  return CLASSES.find(([re]) => re.test(pattern))?.[1] ?? 'excluded';
}

export function excludedFieldProblems(reg: Register | null, names: readonly string[]): string[] {
  const out: string[] = [];
  const patterns = reg?.excludedFieldPatterns ?? [];
  for (const n of names) {
    for (const p of patterns) {
      if (new RegExp(p, 'i').test(n)) out.push(`field "${n}" is an excluded ${excludedClass(p)} field (pattern /${p}/i)`);
    }
  }
  return out;
}

/** Value rules: each kept field is a closed enumeration of at most 32 distinct values; real-side names never appear. */
export function valueProblems(rows: ReadonlyArray<Record<string, unknown>>, names: readonly string[], real?: NamesFile | null): string[] {
  const out: string[] = [];
  for (const n of names) {
    const values = new Set(rows.map((r) => String(r[n] ?? '')));
    if (values.size > MAX_ENUM_VALUES) out.push(`field "${n}" has ${values.size} distinct values (limit ${MAX_ENUM_VALUES}); not a closed enumeration`);
  }
  if (real) {
    const matchers = compileRealNames(real.entries);
    for (const n of names) {
      for (const v of new Set(rows.map((r) => String(r[n] ?? '')))) {
        if (scanRealNames('subset', v, matchers).length > 0) out.push(`field "${n}" holds a value that matches the real-side name registry`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// scanThirdParty

const GATE = 'license:scan';

export interface ScanThirdPartyOptions {
  /** Real-side NameRegistry; omit to skip the subset value rule (a SKIP note is returned). */
  real?: NamesFile | null | undefined;
  /** Tree listing; defaults to listTree(root). */
  tree?: readonly string[] | undefined;
  /** File list `pnpm pack --dry-run` would produce for a package directory (relative to root); injectable for tests. */
  packFiles?: ((pkgDir: string) => string[]) | undefined;
}

export interface ScanThirdPartyResult { findings: GateFinding[]; notes: string[]; scanned: number }

const SPDX_CODE_DEFAULT = ['MIT', 'Apache-2.0'];
const SPDX_DATA_DEFAULT = ['CC-BY-4.0'];

/** Minimal REUSE.toml reader: [[annotations]] with path globs and SPDX-License-Identifier. */
export function parseReuseAnnotations(toml: string): Array<{ globs: string[]; spdx: string | null }> {
  const out: Array<{ globs: string[]; spdx: string | null }> = [];
  for (const block of toml.split(/^\[\[annotations\]\]\s*$/m).slice(1)) {
    const p = /^path\s*=\s*(\[[\s\S]*?\]|"[^"]*")/m.exec(block);
    const s = /^SPDX-License-Identifier\s*=\s*"([^"]*)"/m.exec(block);
    out.push({ globs: p ? [...(p[1] as string).matchAll(/"([^"]*)"/g)].map((m) => m[1] as string) : [], spdx: s ? (s[1] as string) : null });
  }
  return out;
}

function globToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function copyrightLines(licenceText: string): string[] {
  return licenceText.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^copyright\b/i.test(l));
}

function pkgDirOf(root: string, rel: string): string | null {
  let dir = path.posix.dirname(rel);
  while (dir !== '.' && dir !== '') {
    if (existsSync(path.join(root, dir, 'package.json'))) return dir;
    dir = path.posix.dirname(dir);
  }
  return null;
}

export function scanThirdParty(root: string, opts: ScanThirdPartyOptions = {}): ScanThirdPartyResult {
  const findings: GateFinding[] = [];
  const notes: string[] = [];
  const add = (file: string, rule: string, detail: string): void => void findings.push(finding(GATE, file, rule, detail));
  const reg = loadRegister(root);
  const tree = opts.tree ?? listTree(root);
  const tp = tree.filter((f) => f.startsWith('third_party/'));
  const distDir = path.join(root, 'apps/web/dist');
  const hasDist = existsSync(distDir);

  // 1. third_party/ itself.
  if (hasThirdParty(root)) {
    const entries = reuseEntries(reg);
    const toml = existsSync(path.join(root, 'REUSE.toml')) ? readFileSync(path.join(root, 'REUSE.toml'), 'utf8') : '';
    const annotations = parseReuseAnnotations(toml);
    const codeOk = reg?.thirdPartyLicences?.code ?? SPDX_CODE_DEFAULT;
    const dataOk = reg?.thirdPartyLicences?.dataOnly ?? SPDX_DATA_DEFAULT;
    const patterns = reg?.excludedFieldPatterns ?? [];
    const dirs = new Set(tp.filter((f) => f.includes('/', 'third_party/'.length)).map((f) => f.split('/')[1] as string));
    const noticeText = readText(root, 'third_party/NOTICE');
    const notice = parseNotice(noticeText ?? '');
    for (const b of notice.bad) add('third_party/NOTICE', 'notice-bad-format', `line does not parse as <name>/<path> | <spdx> | <creator> | <licence URL> [| modified]: ${b.slice(0, 60)}`);

    for (const name of [...dirs].sort()) {
      const entry = entries.find((e) => e.name === name);
      const where = `third_party/${name}`;
      if (!entry) {
        add(where, 'no-entry', `no REUSE-WITH-ATTRIBUTION entry named "${name}" in ${REGISTER_PATH}`);
        continue;
      }
      if (!entry.pinnedSha || !/^[0-9a-f]{40}$/.test(entry.pinnedSha)) add(where, 'no-sha', 'entry has no pinnedSha (40 hex characters)');
      const allowed = entry.allowedPaths ?? [];
      const lic = entry.licenceFiles ?? [];
      if (!lic.some((l) => /^licen[cs]e/i.test(path.posix.basename(l.path)))) add(where, 'no-license', 'no licenceFiles item for the upstream LICENSE');
      for (const spdx of new Set(allowed.map((i) => i.spdx))) {
        if (!lic.some((l) => l.spdx === spdx)) add(where, 'dual-licence-missing-data-grant', `no licenceFiles item for spdx ${spdx} (a dual-licensed upstream needs the data grant as well as the code LICENSE)`);
      }
      for (const l of lic) {
        if (!existsSync(path.join(root, where, l.path))) add(`${where}/${l.path}`, 'licence-file-missing', 'licenceFiles path does not exist');
      }
      const known = new Set<string>([...allowed.map((i) => i.path), ...lic.map((l) => l.path)]);
      for (const f of tp.filter((x) => x.startsWith(`${where}/`))) {
        if (!known.has(f.slice(where.length + 1))) add(f, 'outside-allowed-paths', 'file is in neither allowedPaths nor licenceFiles');
      }
      for (const item of allowed) {
        const ref = `${where}/${item.path}`;
        if (item.kind === 'code' && !codeOk.includes(item.spdx)) add(ref, 'item-licence', `code item spdx ${item.spdx} is not one of ${codeOk.join(', ')}`);
        else if (item.kind === 'data' && !dataOk.includes(item.spdx)) add(ref, 'item-licence', `data item spdx ${item.spdx} is not one of ${dataOk.join(', ')}`);
        else if (item.kind !== 'code' && item.kind !== 'data') add(ref, 'item-licence', `kind must be code or data, got ${String(item.kind)}`);
        if (!tp.includes(ref)) add(ref, 'item-missing', 'allowedPaths item is not present under third_party/');
        const matching = annotations.filter((a) => a.globs.some((g) => globToRe(g).test(ref)));
        if (!matching.some((a) => a.spdx === item.spdx)) {
          add(ref, 'reuse-toml-mismatch', `REUSE.toml has no annotation for this path with SPDX-License-Identifier ${item.spdx}${matching.length ? ` (found ${matching.map((a) => a.spdx ?? 'none').join(', ')})` : ''}`);
        }
        const line = noticeFor(notice.lines, name, item);
        if (!line) {
          if (noticeText !== null && !notice.bad.length) add(ref, 'notice-missing', 'no third_party/NOTICE line for this item');
          else if (noticeText === null) add('third_party/NOTICE', 'notice-missing', 'third_party/NOTICE is missing');
        } else {
          if (item.kind === 'data' && (line.url === '' || !/^https?:\/\//.test(line.url))) add(ref, 'notice-no-url', 'data NOTICE line lacks the licence URL');
          if (item.kind === 'code' && line.parts < 4) add(ref, 'notice-bad-format', 'NOTICE line lacks the licence URL');
          if (item.modified === true && !line.modified) add(ref, 'notice-no-modified', 'item is modified but its NOTICE line lacks "modified"');
          if (item.modified !== true && line.modified) add(ref, 'notice-modified-mismatch', 'NOTICE line says "modified" but the item is not modified');
          if (line.spdx !== item.spdx) add(ref, 'notice-spdx-mismatch', `NOTICE line says ${line.spdx}, item says ${item.spdx}`);
        }
        if (item.path.endsWith('.subset.json')) {
          if (item.modified !== true) add(ref, 'subset-not-modified', 'a subset file must have modified: true');
          const names = (item.fields ?? []).map((f) => f.name);
          for (const f of item.fields ?? []) if (!f.note) add(ref, 'subset-field-note', `field "${f.name}" has no reviewer note`);
          for (const p of excludedFieldProblems(reg, names)) add(ref, 'excluded-field', p);
          if (patterns.length === 0) add(ref, 'excluded-field', 'register has no excludedFieldPatterns');
          const text = readText(root, ref);
          if (text !== null) {
            let rows: unknown;
            try {
              rows = JSON.parse(text);
            } catch {
              add(ref, 'subset-keys', 'subset file is not valid JSON');
            }
            if (Array.isArray(rows)) {
              const objs = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
              const keys = new Set(objs.flatMap((r) => Object.keys(r)));
              for (const k of keys) {
                for (const p of patterns) {
                  if (new RegExp(p, 'i').test(k)) add(ref, 'excluded-field', `key "${k}" is an excluded ${excludedClass(p)} field (pattern /${p}/i)`);
                }
              }
              const same = keys.size === names.length && names.every((n) => keys.has(n)) && objs.every((r) => Object.keys(r).length === names.length);
              if (!same || objs.length !== rows.length) add(ref, 'subset-keys', `keys [${[...keys].sort().join(', ')}] differ from fields [${[...names].sort().join(', ')}]`);
              for (const p of valueProblems(objs, names.filter((n) => keys.has(n)), opts.real)) add(ref, p.includes('real-side') ? 'subset-name-value' : 'subset-high-cardinality', p);
            } else if (rows !== undefined) add(ref, 'subset-keys', 'subset file must be a JSON array of rows');
          }
        }
      }
    }
    if (!opts.real) notes.push('SKIP reuse subset values: DV_NAMES_REAL_JSON not set');
  }

  // 2. "Portions from" headers, credits, pack lists.
  const sources = sourceFiles(root, tree);
  const ported: Array<{ file: string; header: PortionsHeader }> = [];
  const creditsText = hasDist ? readText(root, 'apps/web/dist/credits.json') : null;
  const licencesTxt = hasDist ? readText(root, 'apps/web/dist/third-party-licenses.txt') : null;
  const notice = parseNotice(readText(root, 'third_party/NOTICE') ?? '').lines;
  for (const file of sources) {
    const text = readText(root, file);
    if (text === null || !text.includes(PORTIONS)) continue;
    for (const h of parsePortionsHeaders(text)) {
      ported.push({ file, header: h });
      const hit = findItem(reg, h);
      if (!hit) {
        add(file, 'header-unresolved', `header names third_party/${h.name}/${h.path}, which is not an allowedPaths item of a REUSE-WITH-ATTRIBUTION entry`);
        continue;
      }
      const licFile = (hit.entry.licenceFiles ?? []).find((l) => /^licen[cs]e/i.test(path.posix.basename(l.path)));
      const licText = licFile ? readText(root, `third_party/${h.name}/${licFile.path}`) : null;
      const lines = licText ? copyrightLines(licText) : [];
      if (lines.length === 0 || !lines.every((l) => text.includes(l))) add(file, 'header-no-copyright', 'file does not repeat the upstream copyright line verbatim');
      const spdx = /SPDX-License-Identifier:\s*([^\s*]+(?:\s+(?:AND|OR)\s+[^\s*]+)*)/.exec(text);
      if (!spdx) add(file, 'header-no-spdx', 'file has no SPDX-License-Identifier line');
      else if ((spdx[1] as string).trim() !== hit.item.spdx) add(file, 'header-spdx-mismatch', `SPDX-License-Identifier ${spdx[1]} differs from the item's ${hit.item.spdx}`);
      if (hasDist && licText && (licencesTxt === null || !licencesTxt.includes(licText.trim()))) {
        add(file, 'licence-not-in-dist', 'the entry LICENSE text is not in apps/web/dist/third-party-licenses.txt');
      }
    }
  }
  if (hasDist) {
    // Items named by a header or by a provenance record's derived_from must have their NOTICE line in credits.json.
    const named = new Map<string, { entry: RegisterEntry; item: AllowedPathItem }>();
    for (const p of ported) {
      const hit = findItem(reg, p.header);
      if (hit) named.set(`${p.header.name}/${p.header.path}`, hit);
    }
    const derived = derivedFromHashes(root);
    for (const entry of vendoredEntries(reg)) {
      for (const item of entry.allowedPaths ?? []) {
        const bytes = existsSync(path.join(root, 'third_party', entry.name as string, item.path)) ? readFileSync(path.join(root, 'third_party', entry.name as string, item.path)) : null;
        if (bytes && derived.has(sha256Hex(bytes))) named.set(`${entry.name}/${item.path}`, { entry, item });
      }
    }
    for (const [ref, { entry, item }] of named) {
      const line = noticeFor(notice, entry.name as string, item);
      if (line && !(creditsText ?? '').includes(JSON.stringify(line.raw).slice(1, -1))) add('apps/web/dist/credits.json', 'credits-missing', `NOTICE line of ${ref} is not in credits.json`);
    }
  }
  const packFiles = opts.packFiles ?? defaultPackFiles(root);
  const pkgs = new Set<string>();
  for (const p of ported) {
    const dir = pkgDirOf(root, p.file);
    if (dir && !dir.startsWith('apps/')) {
      const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8')) as { private?: boolean };
      if (pkg.private !== true) pkgs.add(dir);
    }
  }
  for (const dir of [...pkgs].sort()) {
    const list = packFiles(dir);
    const portedInPack = ported.some((p) => p.file.startsWith(`${dir}/`) && list.includes(p.file.slice(dir.length + 1)));
    if (portedInPack && !list.includes('THIRD_PARTY_LICENSES.txt')) add(`${dir}/package.json`, 'pack-no-licences', 'packed files hold a ported file but no THIRD_PARTY_LICENSES.txt');
  }
  return { findings, notes, scanned: tp.length + sources.length };
}

function derivedFromHashes(root: string): Set<string> {
  const out = new Set<string>();
  const dir = path.join(root, 'assets/provenance');
  if (!existsSync(dir)) return out;
  for (const rel of listTree(root).filter((f) => f.startsWith('assets/provenance/') && f.endsWith('.json'))) {
    try {
      const rec = JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as { derived_from?: unknown };
      if (Array.isArray(rec.derived_from)) for (const d of rec.derived_from) if (typeof d === 'string') out.add(d);
    } catch {
      // unreadable records are provenance:check's finding
    }
  }
  return out;
}

function defaultPackFiles(root: string): (pkgDir: string) => string[] {
  return (pkgDir) => {
    const res = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.join(root, pkgDir), encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`pack list failed for ${pkgDir}: ${res.stderr.trim()}`);
    const doc = JSON.parse(res.stdout) as Array<{ files: Array<{ path: string }> }>;
    return (doc[0]?.files ?? []).map((f) => f.path);
  };
}
