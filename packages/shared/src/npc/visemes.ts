/**
 * Mouth shapes for lip-sync (04-npc.md section 5.7, M06a4). Pure and deterministic; the client driver renders what this decides.
 *
 * Shapes are the nine Rhubarb mouth shapes: X closed/idle, A closed lips (P B M), B clenched teeth (K S T, EE), C open (EH, AE),
 * D wide open (AA), E rounded (AO, OI), F puckered (OO, W, SH), G teeth on lip (F V), H tongue up (L, TH).
 * The mouth atlas (C07 `mouth_atlas`) is a 3x3 grid in the order of `ATLAS_ORDER`.
 *
 * Three cue sources: t2 ElevenLabs alignment (`visemesFromAlignment`, an English grapheme-to-viseme rule set written for this project),
 * baked Rhubarb cue files (`parseRhubarb`), and the t1 audio envelope (`shapeFromEnvelope`, which has no timestamps).
 */
export type Viseme = 'X' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

/** Row-major cells of the 3x3 mouth atlas. */
export const ATLAS_ORDER: readonly Viseme[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];

export interface VisemeCue {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  shape: Viseme;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Digraphs and trigraphs first (longest match wins), then single letters. */
const GRAPHEMES: readonly (readonly [string, Viseme])[] = [
  ['tch', 'F'], ['igh', 'B'], ['ough', 'F'], ['augh', 'D'],
  ['th', 'H'], ['sh', 'F'], ['ch', 'F'], ['zh', 'F'], ['wh', 'F'], ['ph', 'G'], ['gh', 'B'], ['ck', 'B'], ['ng', 'B'], ['qu', 'F'],
  ['oo', 'F'], ['ou', 'F'], ['ow', 'F'], ['ew', 'F'], ['ue', 'F'], ['oa', 'E'], ['oi', 'E'], ['oy', 'E'],
  ['ee', 'B'], ['ea', 'B'], ['ie', 'B'], ['ai', 'C'], ['ay', 'C'], ['ei', 'C'], ['ey', 'C'],
  ['au', 'D'], ['aw', 'D'], ['ar', 'D'], ['or', 'E'], ['er', 'E'], ['ir', 'E'], ['ur', 'E'],
];

const LETTER: Record<string, Viseme> = {
  a: 'D', e: 'C', i: 'B', o: 'E', u: 'F', y: 'B',
  p: 'A', b: 'A', m: 'A',
  f: 'G', v: 'G',
  l: 'H',
  w: 'F', j: 'F',
  k: 'B', g: 'B', c: 'B', s: 'B', z: 'B', t: 'B', d: 'B', n: 'B', r: 'B', x: 'B', q: 'B',
};

interface Group {
  shape: Viseme;
  /** Index of the first and last character the group covers. */
  from: number;
  to: number;
}

/** Splits `text` (lower-cased by the caller) into grapheme groups. A letter with no rule (h, digits) is skipped; separators give X. */
function groups(text: string): Group[] {
  const out: Group[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (!/[a-z]/.test(c)) {
      // spaces and punctuation close the mouth; digits and symbols are skipped
      if (/[\s.,;:!?…\-—"')\]]/.test(c)) out.push({ shape: 'X', from: i, to: i });
      i++;
      continue;
    }
    let hit: readonly [string, Viseme] | undefined;
    for (const g of GRAPHEMES) {
      if (text.startsWith(g[0], i)) {
        hit = g;
        break;
      }
    }
    if (hit !== undefined) {
      out.push({ shape: hit[1], from: i, to: i + hit[0].length - 1 });
      i += hit[0].length;
      continue;
    }
    // a doubled letter is one sound; a final silent "e" after a consonant adds no mouth movement
    let end = i;
    while (text[end + 1] === c) end++;
    const atWordEnd = !/[a-z]/.test(text[end + 1] ?? ' ');
    const prev = text[i - 1] ?? ' ';
    const silentE = c === 'e' && atWordEnd && /[a-z]/.test(prev) && !VOWELS.has(prev) && i >= 2;
    const shape = LETTER[c];
    if (shape !== undefined && !silentE) out.push({ shape, from: i, to: end });
    i = end + 1;
  }
  return out;
}

/**
 * Viseme cues for an ElevenLabs alignment (`chars` with per-character start and end seconds). Consecutive groups with the same shape
 * merge. Characters beyond the shorter of the three arrays are ignored. Input that is not finite is treated as 0.
 */
export function visemesFromAlignment(alignment: { chars: string; startS: readonly number[]; endS: readonly number[] }): VisemeCue[] {
  // One entry per code point of the original text, so a group's character index is also its index into the timing arrays.
  const chars = Array.from(alignment.chars).map((c) => {
    const l = c.toLowerCase();
    return l.length === 1 ? l : '?';
  });
  const n = Math.min(chars.length, alignment.startS.length, alignment.endS.length);
  const text = chars.slice(0, n).join('');
  const cues: VisemeCue[] = [];
  for (const g of groups(text)) {
    const startRaw = alignment.startS[g.from];
    const endRaw = alignment.endS[Math.min(g.to, n - 1)];
    const start = Number.isFinite(startRaw) ? (startRaw as number) : 0;
    const end = Math.max(start, Number.isFinite(endRaw) ? (endRaw as number) : start);
    const last = cues[cues.length - 1];
    if (last !== undefined && last.shape === g.shape) {
      last.end = Math.max(last.end, end);
    } else {
      cues.push({ start, end, shape: g.shape });
    }
  }
  return cues;
}

/** The shape sequence of a cue list (what the tests and the debug overlay compare). */
export const shapesOf = (cues: readonly VisemeCue[]): string => cues.map((c) => c.shape).join('');

/** Share of letters that are vowels, 0..1 (0 for text without letters). */
export function vowelDensity(text: string): number {
  let letters = 0;
  let vowels = 0;
  for (const ch of text.toLowerCase()) {
    if (ch < 'a' || ch > 'z') continue;
    letters++;
    if (VOWELS.has(ch)) vowels++;
  }
  return letters === 0 ? 0 : vowels / letters;
}

/** RMS thresholds of the t1 envelope (linear amplitude of the time-domain signal, 0..1). */
export const ENVELOPE_THRESHOLDS = { closed: 0.02, lips: 0.07, teeth: 0.14, open: 0.26 } as const;
/** Above this vowel density the open shapes alternate with E and F. */
export const VOWEL_ALTERNATE_AT = 0.4;

/**
 * Shape for one envelope sample of a t1 line: silence is X, then A, B, C, D by loudness. A vowel-heavy line alternates the open shapes
 * (C, D) with the rounded ones (E, F) by `step`, the count of hold intervals so far.
 */
export function shapeFromEnvelope(rms: number, vowelDens: number, step: number): Viseme {
  const t = ENVELOPE_THRESHOLDS;
  const r = Number.isFinite(rms) ? rms : 0;
  if (r < t.closed) return 'X';
  if (r < t.lips) return 'A';
  if (r < t.teeth) return 'B';
  const open: Viseme = r < t.open ? 'C' : 'D';
  if (vowelDens >= VOWEL_ALTERNATE_AT) {
    const k = ((Math.trunc(step) % 4) + 4) % 4;
    if (k === 1) return 'E';
    if (k === 3) return 'F';
  }
  return open;
}

/** Cells of the atlas as (column, row) from the top left. */
export function atlasCell(shape: Viseme): { col: number; row: number; index: number } {
  const index = Math.max(0, ATLAS_ORDER.indexOf(shape));
  return { col: index % 3, row: Math.floor(index / 3), index };
}

/** The Rhubarb JSON export: `{ mouthCues: [{ start, end, value }] }`. Unknown values become X; a malformed document gives an empty list. */
export function parseRhubarb(doc: unknown): VisemeCue[] {
  const list = (doc as { mouthCues?: unknown } | null)?.mouthCues;
  if (!Array.isArray(list)) return [];
  const out: VisemeCue[] = [];
  for (const c of list as { start?: unknown; end?: unknown; value?: unknown }[]) {
    if (typeof c?.start !== 'number' || typeof c.end !== 'number' || !Number.isFinite(c.start) || !Number.isFinite(c.end)) continue;
    const v = typeof c.value === 'string' && (ATLAS_ORDER as readonly string[]).includes(c.value) ? (c.value as Viseme) : 'X';
    out.push({ start: c.start, end: c.end, shape: v });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The shape playing at `t` seconds (X outside every cue). Cues are sorted by `start`. */
export function cueAt(cues: readonly VisemeCue[], t: number): Viseme {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid] as VisemeCue;
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c.shape;
  }
  return 'X';
}
