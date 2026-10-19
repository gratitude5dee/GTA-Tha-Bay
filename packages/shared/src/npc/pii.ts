/**
 * PII scrubber for text that may be stored as NPC memory or sent to a model (04-npc.md section 5.4, 5.6).
 * Removes e-mail addresses, phone numbers and street addresses. Pure and deterministic.
 */
export const PII_PLACEHOLDER = '[removed]';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// North American style numbers, with or without country code and separators; 10 digits at least.
const PHONE = /(?<![\w])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/g;
const STREET_SUFFIX =
  '(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Terrace|Ter|Alley|Highway|Hwy|Parkway|Pkwy|Square|Sq)';
const STREET = new RegExp(
  `\\b\\d{1,5}\\s+(?:[A-Za-z0-9][A-Za-z0-9.'-]*\\s+){0,3}${STREET_SUFFIX}\\b\\.?(?:,?\\s+(?:#|Apt\\.?|Unit|Suite|Ste\\.?)\\s*[A-Za-z0-9-]+)?`,
  'gi',
);

export function scrubPii(text: string): { text: string; removed: number } {
  let removed = 0;
  const sub = (): string => {
    removed++;
    return PII_PLACEHOLDER;
  };
  let out = text.replace(EMAIL, sub);
  out = out.replace(PHONE, sub);
  out = out.replace(STREET, sub);
  return { text: out, removed };
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** URLs, e-mail addresses and phone numbers in `text`, for lint L6. */
export function findContactInfo(text: string): { kind: 'url' | 'email' | 'phone'; match: string }[] {
  const out: { kind: 'url' | 'email' | 'phone'; match: string }[] = [];
  const run = (re: RegExp, kind: 'url' | 'email' | 'phone'): void => {
    for (const m of text.matchAll(re)) out.push({ kind, match: m[0] });
  };
  run(URL_RE, 'url');
  run(EMAIL, 'email');
  run(PHONE, 'phone');
  return out;
}
