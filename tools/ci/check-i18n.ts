/**
 * check:i18n (M04b1, DL-230): the English catalog against the code.
 *  - missing keys: every `t('key')`, `lk('key')` and `plural('base', ...)` literal (and each `nav.json` label key) exists in
 *    `content/ui/i18n/en.json` (`plural` needs `base.other`). A missing key fails the check.
 *  - unused keys: catalog keys no literal, template prefix (`t(`prefix.${x}`)`) or exact string literal in the sources refers to.
 *    Reported, not failing: dynamic keys built from tables are listed by prefix.
 *  - stale hashes: for each other catalog `<lang>.json`, the sidecar `<lang>.hashes.json` records the hash of the English string a
 *    translation was made from; a differing hash is reported (none exist while English is the only catalog).
 *  - display name: neither a catalog value nor `packages/ui/src` / `apps/web/src` source may hold the display-name literal; text
 *    carries `{brand}` (R-NAME-1).
 *
 *   tsx tools/ci/check-i18n.ts [--root <dir>]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BRAND } from '../../config/brand.ts';
import { args, repoRoot } from './run.ts';
import { isMain } from './lib/common.ts';

export interface I18nReport {
  keys: number;
  used: string[];
  missing: { key: string; file: string }[];
  unused: string[];
  dynamicPrefixes: string[];
  stale: { lang: string; key: string }[];
  literals: { where: string; text: string }[];
  languages: string[];
}

const SOURCE_DIRS = ['packages/ui/src', 'apps/web/src'];
/** Key families the sim raises (toasts) or a table builds by name; they have no `t()` call to find. */
const EXTERNAL_PREFIXES = ['world.', 'mode.', 'unlock.', 'garage.', 'save.profile.', 'legal.doc.', 'help.', 'hint.', 'creator.part.', 'creator.morph.', 'touch.layout.', 'engine.vehicle.', 'phone.ride.', 'nhood.', 'map.travel.', 'sandbox.refuse.', 'phone.sandbox.heat'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

export function runCheckI18n(root: string = repoRoot): I18nReport {
  const catalogDir = path.join(root, 'content/ui/i18n');
  const en = JSON.parse(readFileSync(path.join(catalogDir, 'en.json'), 'utf8')) as Record<string, string>;
  const keys = new Set(Object.keys(en));
  const used = new Set<string>();
  const prefixes = new Set<string>();
  const missing: I18nReport['missing'] = [];
  const literals: I18nReport['literals'] = [];

  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(root, d)));
  const allText = new Map<string, string>();
  for (const file of files) allText.set(file, readFileSync(file, 'utf8'));

  for (const [file, text] of allText) {
    const rel = path.relative(root, file);
    for (const m of text.matchAll(/\b(?:t|lk)\(\s*(['"])([\w.-]+)\1/g)) {
      const key = m[2] as string;
      used.add(key);
      if (!keys.has(key)) missing.push({ key, file: rel });
    }
    for (const m of text.matchAll(/\bplural\(\s*(['"])([\w.-]+)\1/g)) {
      const base = m[2] as string;
      used.add(`${base}.one`);
      used.add(`${base}.other`);
      if (!keys.has(`${base}.other`)) missing.push({ key: `${base}.other`, file: rel });
    }
    for (const m of text.matchAll(/\b(?:t|lk)\(\s*`([\w.-]+\.)\$\{/g)) prefixes.add(m[1] as string);
    for (const m of text.matchAll(/(['"])([a-z][\w-]*(?:\.[\w-]+)+)\1/g)) if (keys.has(m[2] as string)) used.add(m[2] as string);
    if (text.includes(BRAND.displayName) && !rel.endsWith('.test.ts') && !rel.endsWith('.spec.ts')) literals.push({ where: rel, text: BRAND.displayName });
  }

  // Menu labels in config/ui/nav.json.
  const navPath = path.join(root, 'config/ui/nav.json');
  if (existsSync(navPath)) {
    const nav = JSON.parse(readFileSync(navPath, 'utf8')) as { items: { labelKey: string }[] };
    for (const item of nav.items) {
      used.add(item.labelKey);
      if (!keys.has(item.labelKey)) missing.push({ key: item.labelKey, file: 'config/ui/nav.json' });
    }
  }

  const banned = [BRAND.displayName, BRAND.shortName].map((s) => s.toLowerCase());
  for (const [key, value] of Object.entries(en)) {
    const lower = value.toLowerCase();
    for (const b of banned) if (lower.includes(b)) literals.push({ where: `content/ui/i18n/en.json:${key}`, text: b });
  }

  const unused = [...keys].filter((k) => !used.has(k) && ![...prefixes, ...EXTERNAL_PREFIXES].some((p) => k.startsWith(p)));

  const languages = readdirSync(catalogDir)
    .filter((f) => /^[a-z]{2}(-[A-Za-z]+)?\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''));
  const stale: I18nReport['stale'] = [];
  for (const lang of languages.filter((l) => l !== 'en')) {
    const hashFile = path.join(catalogDir, `${lang}.hashes.json`);
    const hashes = existsSync(hashFile) ? (JSON.parse(readFileSync(hashFile, 'utf8')) as Record<string, string>) : {};
    const cat = JSON.parse(readFileSync(path.join(catalogDir, `${lang}.json`), 'utf8')) as Record<string, string>;
    for (const key of Object.keys(cat)) if (keys.has(key) && hashes[key] !== sha(en[key] as string)) stale.push({ lang, key });
  }

  return { keys: keys.size, used: [...used], missing, unused, dynamicPrefixes: [...prefixes].sort(), stale, literals, languages };
}

/** The hash recorded beside a translation (`<lang>.hashes.json`) for an English string. */
export const englishHash = sha;

export function main(argv: readonly string[] = args()): number {
  const { values } = parseArgs({ args: [...argv], options: { root: { type: 'string' } }, allowPositionals: true });
  const root = values.root ? path.resolve(values.root) : repoRoot;
  const r = runCheckI18n(root);
  console.log(`check:i18n ${r.keys} keys, ${r.used.length} referenced, ${r.dynamicPrefixes.length} dynamic prefixes, languages: ${r.languages.join(', ')}`);
  if (r.dynamicPrefixes.length > 0) console.log(`  dynamic prefixes: ${r.dynamicPrefixes.join(' ')}`);
  console.log(`  missing English keys: ${r.missing.length}`);
  for (const m of r.missing) console.log(`    MISSING ${m.key}  (${m.file})`);
  console.log(`  unused English keys: ${r.unused.length}`);
  for (const k of r.unused) console.log(`    unused ${k}`);
  console.log(`  stale translations: ${r.stale.length}${r.languages.length <= 1 ? ' (English is the only catalog)' : ''}`);
  for (const s of r.stale) console.log(`    stale ${s.lang}:${s.key}`);
  console.log(`  display-name literals: ${r.literals.length}`);
  for (const l of r.literals) console.log(`    LITERAL ${l.where}  (${l.text})`);
  const ok = r.missing.length === 0 && r.literals.length === 0;
  console.log(ok ? 'check:i18n ok' : 'check:i18n FAILED');
  return ok ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = main();
