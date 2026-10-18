/**
 * Pure core of names:lint (display side and real side) and names:brand (research/legal-ip-likeness.md R-NAME-1,
 * R-NAME-2). Real-side strings only ever come from the CI secret and never enter the repository.
 */
import { finding, type GateFinding } from './types.ts';

const GATE = 'names:lint';

export interface NameEntry {
  id: string;
  /** Display side: the name the game shows. */
  display?: string;
  /** Real side: the real person, team, venue or mark. */
  real?: string;
  aliases?: string[];
}

export interface NamesFile { schema: 'names/1'; entries: NameEntry[] }

export const NAME_DISTANCE_THRESHOLD = 0.4;

/** Lower-case, strip diacritics, keep letters and digits only. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] ?? 0;
}

/** Edit distance over normalised names divided by the longer length: 0 identical, 1 unrelated. */
export function normalisedDistance(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 0 : editDistance(x, y) / longest;
}

function realStrings(e: NameEntry): string[] {
  return [e.real, ...(e.aliases ?? [])].filter((s): s is string => typeof s === 'string' && normalizeName(s).length >= 3);
}

/** Display names must stay at or above the threshold from every real-side name and alias. */
export function checkDisplayDistance(
  displayEntries: readonly NameEntry[],
  realEntries: readonly NameEntry[],
  threshold = NAME_DISTANCE_THRESHOLD,
): GateFinding[] {
  const out: GateFinding[] = [];
  for (const d of displayEntries) {
    if (!d.display) continue;
    for (const r of realEntries) {
      for (const s of realStrings(r)) {
        const dist = normalisedDistance(d.display, s);
        if (dist < threshold) {
          out.push(finding(GATE, `names:${d.id}`, 'name-distance', `display name is ${dist.toFixed(2)} from real-side entry ${r.id} (limit ${threshold})`));
        }
      }
    }
  }
  return out;
}

function boundaryRegex(s: string): RegExp {
  const tokens = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const body = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]{1,3}');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
}

export interface RealNameMatcher { id: string; re: RegExp }

export function compileRealNames(realEntries: readonly NameEntry[]): RealNameMatcher[] {
  const out: RealNameMatcher[] = [];
  for (const e of realEntries) for (const s of realStrings(e)) out.push({ id: e.id, re: boundaryRegex(s) });
  return out;
}

/** Real-side strings found in client code, content, provenance records or prompt templates. */
export function scanRealNames(path: string, text: string, matchers: readonly RealNameMatcher[]): GateFinding[] {
  const out: GateFinding[] = [];
  for (const m of matchers) {
    if (m.re.test(text)) out.push(finding(GATE, path, 'real-name-in-client', `real-side entry ${m.id} appears in shipped text`));
  }
  return out;
}

/** names:brand: the display-name literal outside config/brand.ts. */
export function scanDisplayLiteral(path: string, text: string, displayName: string): GateFinding[] {
  return text.includes(displayName)
    ? [finding('names:brand', path, 'display-name-literal', 'the display name comes only from config/brand.ts')]
    : [];
}

/**
 * R-NAME-2 bundle check: the shipped-name regex over built text. `exceptions` are the full-string exceptions of
 * config/ip-denylist.json (the disclaimer sentence); the same words in any other sentence still fail.
 */
export function scanShippedNames(
  path: string,
  text: string,
  nameRegex: { regex: string; flags: string },
  exceptions: readonly string[],
): GateFinding[] {
  let t = text;
  for (const ex of exceptions) t = t.split(ex).join(' '.repeat(ex.length));
  const re = new RegExp(nameRegex.regex, nameRegex.flags.replace('g', ''));
  const m = re.exec(t);
  return m ? [finding(GATE, path, 'shipped-name', `R-NAME-2 match: ${m[0].toLowerCase()}`)] : [];
}
