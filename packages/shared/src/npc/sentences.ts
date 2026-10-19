/**
 * Sentence splitter for per-sentence TTS (04-npc.md section 5.7) and the partial-line scanner of the dialogue client.
 * Rules: a sentence ends at . ! ? or an ellipsis, optionally followed by closing quotes or brackets, when whitespace follows.
 * Known abbreviations, single initials, numbers like 3.5 and an ellipsis before a lower-case word do not end a sentence.
 * Pure and deterministic.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'inc', 'ltd', 'co', 'no', 'ave', 'blvd', 'rd', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s',
]);

const isTerminator = (c: string): boolean => c === '.' || c === '!' || c === '?' || c === '…';
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);

function endsOnAbbreviation(text: string, dotAt: number): boolean {
  let start = dotAt;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1] as string)) start--;
  const word = text.slice(start, dotAt).toLowerCase();
  if (word.length === 0) return false;
  if (ABBREVIATIONS.has(word)) return true;
  return word.length === 1 && /[a-z]/.test(word); // a single initial such as "J."
}

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const src = text.replace(/\s+/g, ' ').trim();
  let from = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (!isTerminator(c)) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < src.length && (isTerminator(src[end] as string) || CLOSERS.has(src[end] as string))) end++;
    const next = src[end];
    let boundary = next === undefined || next === ' ';
    // An ellipsis followed by a lower-case word continues the sentence: "Well... maybe."
    if (boundary && next === ' ' && /\u2026|\.\./.test(src.slice(i, end)) && /[a-z]/.test(src[end + 1] ?? '')) boundary = false;
    if (boundary && c === '.' && end === i + 1 && endsOnAbbreviation(src, i)) {
      i = end;
      continue;
    }
    if (boundary) {
      const s = src.slice(from, end).trim();
      if (s) out.push(s);
      from = end;
    }
    i = end;
  }
  const rest = src.slice(from).trim();
  if (rest) out.push(rest);
  return out;
}
