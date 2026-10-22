import { BRAND } from '../../../../config/brand.ts';
import en from '../../../../content/ui/i18n/en.json';

/**
 * Localization (10-ui.md section 2.7, M04b1). One catalog today (en); the structure takes more. Catalogs hold the `{brand}`
 * placeholder and never the literal display name (R-NAME-1); `t()` substitutes it from config/brand.ts. A key is looked up in the
 * catalog of the language, then of its base language ('de-AT' then 'de'), then in English. Keys that no catalog has are recorded
 * for the missing-key report and come back as the key itself.
 */
export type LocKey = string;

/** Marks a string literal as a catalog key where no `t()` call is nearby (tables of rows, `nav.json`); `check:i18n` reads these too. */
export const lk = (key: string): LocKey => key;

export const catalogs: Readonly<Record<string, Readonly<Record<string, string>>>> = { en };
export type Lang = string;

let current: Lang = 'en';
const missing = new Set<string>();

export function setLang(lang: string | null | undefined): void {
  current = lang && lang.length > 0 ? lang : 'en';
}
export function getLang(): Lang {
  return current;
}

/** Keys that were requested but absent from every catalog in the chain (reported by tests and QA). */
export function missingKeys(): readonly string[] {
  return [...missing];
}

/** `['de-AT', 'de', 'en']` for 'de-AT'. */
export function chain(lang: string): string[] {
  const out: string[] = [];
  const add = (l: string): void => {
    if (!out.includes(l)) out.push(l);
  };
  add(lang);
  const dash = lang.indexOf('-');
  if (dash > 0) add(lang.slice(0, dash));
  add('en');
  return out;
}

/** Texts the content brings at run time (mission lines and titles, M05c1): English, consulted after the catalogs. */
const texts = new Map<string, string>();

export function registerTexts(entries: Readonly<Record<string, string>>): void {
  for (const k of Object.keys(entries)) texts.set(k, entries[k] as string);
}

/** A content text (a mission line or title) by its key, else the key itself; never recorded as a missing catalog key. */
export function contentText(key: string): string {
  return texts.get(key) ?? lookup(key, current) ?? key;
}

function lookup(key: string, lang: string): string | undefined {
  for (const l of chain(lang)) {
    const hit = catalogs[l]?.[key];
    if (hit !== undefined) return hit;
  }
  return texts.get(key);
}

export function t(key: LocKey, vars: Readonly<Record<string, string | number>> = {}, lang: Lang = current): string {
  const raw = lookup(key, lang);
  if (raw === undefined) {
    missing.add(key);
    return key;
  }
  const all: Record<string, string | number> = { brand: BRAND.displayName, short: BRAND.shortName, ...vars };
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = all[name];
    return v === undefined ? whole : String(v);
  });
}

/** The `base.one` or `base.other` string by the language's plural rule; `{n}` is filled in. */
export function plural(base: string, n: number, vars: Readonly<Record<string, string | number>> = {}, lang: Lang = current): string {
  let category = 'other';
  try {
    category = new Intl.PluralRules(lang).select(n);
  } catch {
    // an unknown language tag falls back to the other form
  }
  const key = lookup(`${base}.${category}`, lang) !== undefined ? `${base}.${category}` : `${base}.other`;
  return t(key, { n, ...vars }, lang);
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions, lang: Lang = current): string {
  try {
    return new Intl.NumberFormat(lang, opts).format(n);
  } catch {
    return String(n);
  }
}

/** Integer cents as a currency string (game money is integer cents; display only). */
export function formatCents(cents: number, lang: Lang = current): string {
  return formatNumber(cents / 100, { style: 'currency', currency: 'USD' }, lang);
}

export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }, lang: Lang = current): string {
  try {
    return new Intl.DateTimeFormat(lang, opts).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
