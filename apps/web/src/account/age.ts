import type { AgeBracket } from '@dv/shared';

/**
 * The neutral age screen (10-ui-pages.md section 2.4 rules 1-4): three empty numeric fields in locale order, no threshold text.
 * The date of birth is used here and thrown away; only the bracket leaves this module.
 */

export type DateField = 'month' | 'day' | 'year';

export interface DateInput {
  month: number;
  day: number;
  year: number;
}

/** Field order for the locale, from Intl.DateTimeFormat parts. Falls back to month, day, year. */
export function fieldOrder(locale?: string): DateField[] {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(2001, 10, 22));
    const order = parts.map((p) => p.type).filter((t): t is DateField => t === 'month' || t === 'day' || t === 'year');
    if (order.length === 3 && new Set(order).size === 3) return order;
  } catch {
    /* unknown locale */
  }
  return ['month', 'day', 'year'];
}

/** True for a real calendar date, not in the future, year 1900 or later. */
export function isValidBirthDate(d: DateInput, now: Date): boolean {
  if (![d.month, d.day, d.year].every((n) => Number.isInteger(n))) return false;
  if (d.year < 1900 || d.month < 1 || d.month > 12 || d.day < 1) return false;
  const probe = new Date(Date.UTC(d.year, d.month - 1, d.day));
  if (probe.getUTCFullYear() !== d.year || probe.getUTCMonth() !== d.month - 1 || probe.getUTCDate() !== d.day) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return probe.getTime() <= today;
}

/** The age bracket for a valid date of birth; null for an invalid one. */
export function bracketFor(d: DateInput, now: Date): AgeBracket | null {
  if (!isValidBirthDate(d, now)) return null;
  let years = now.getFullYear() - d.year;
  if (now.getMonth() + 1 < d.month || (now.getMonth() + 1 === d.month && now.getDate() < d.day)) years -= 1;
  if (years >= 18) return '18p';
  if (years >= 16) return '16_17';
  if (years >= 13) return '13_15';
  return 'u13';
}

/** Parses the text of a numeric field; empty or non-numeric text gives NaN. */
export function parseField(text: string): number {
  return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/** The delete button stays disabled until the typed text equals the username (item 14). */
export function deleteConfirmed(typed: string, username: string): boolean {
  return username.length > 0 && typed.trim().toLowerCase() === username.toLowerCase();
}
