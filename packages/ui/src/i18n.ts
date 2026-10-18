import { BRAND } from '../../../config/brand.ts';
import en from './i18n/en.json';

/**
 * Localization hook. One catalog today (en). Catalogs hold the `{brand}` placeholder and never the literal
 * display name (R-NAME-1); `t()` substitutes it from config/brand.ts.
 */
export type LocKey = keyof typeof en;

export const catalogs = { en } as const;
export type Lang = keyof typeof catalogs;

const missing = new Set<string>();

/** Keys that were requested but absent from the active catalog (reported by tests and QA). */
export function missingKeys(): readonly string[] {
  return [...missing];
}

export function t(key: LocKey, vars: Readonly<Record<string, string | number>> = {}, lang: Lang = 'en'): string {
  const catalog: Readonly<Record<string, string>> = catalogs[lang];
  const raw = catalog[key];
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
