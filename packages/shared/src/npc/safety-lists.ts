/**
 * Input prefilter lists of the dialogue route (04-npc.md section 5.4.1). Pure, so the Worker and the client share them: the client can
 * refuse an obvious slur before the request and the Worker repeats the check, because the client is never trusted.
 *
 * The slur list is stored ROT13-encoded so the repository and its bundles do not carry the terms in plain text (the ip and names gates
 * grep shipped text). It is a floor, not a moderation product: asynchronous moderation (M06b1) and the model's own rails do the rest.
 * Matching is on whole tokens after NFD folding, leet folding and de-duplication of repeated letters, so a longer word that merely
 * contains a listed string is not a hit.
 */
import { scrubPii } from './pii.ts';
import { sanitizePlayerText } from './scene.ts';

const rot13 = (s: string): string => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

/** ROT13 of the listed terms (lower case, singular). */
const SLUR_TERMS_ROT13: readonly string[] = ['avttre', 'avttn', 'snttbg', 'snt', 'puvax', 'xvxr', 'fcvp', 'genaal', 'pbba', 'jrgonpx', 'tbbx', 'qlxr'];

const SLURS: ReadonlySet<string> = new Set(SLUR_TERMS_ROT13.map(rot13));

/** Phrases that mean the player may hurt themselves (matched on folded text, so spacing and case do not matter). */
export const SELF_HARM_PHRASES: readonly string[] = [
  'kill myself', 'killing myself', 'end my life', 'ending my life', 'take my own life', 'want to die', 'wanna die', 'suicide', 'suicidal',
  'hurt myself', 'hurting myself', 'harm myself', 'self harm', 'selfharm', 'cut myself', 'cutting myself', 'better off dead', 'end it all',
  'dont want to live', 'do not want to live', 'dont want to be alive', 'do not want to be alive',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lower case, accents removed, leet folded, anything but letters and single spaces dropped, runs of one letter cut to two. */
function fold(text: string): string {
  const base = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[013457@$]/g, (c) => LEET[c] ?? ' ');
  return base.replace(/[^a-z ]+/g, ' ').replace(/([a-z])\1{2,}/g, '$1$1').replace(/\s+/g, ' ').trim();
}

/** Tokens of the folded text; runs of single letters ("c h i n k") are joined into one token. */
function tokens(text: string): string[] {
  const out: string[] = [];
  let run = '';
  for (const t of fold(text).split(' ')) {
    if (t.length === 1) {
      run += t;
      continue;
    }
    if (run.length > 0) out.push(run);
    run = '';
    if (t !== '') out.push(t);
  }
  if (run.length > 0) out.push(run);
  return out;
}

/** A listed slur appears as a whole token (also with a plural s, or with a doubled letter cut to one). */
export function hasSlur(text: string): boolean {
  for (const token of tokens(text)) {
    const singular = token.endsWith('s') ? token.slice(0, -1) : token;
    const single = token.replace(/([a-z])\1/g, '$1');
    if (SLURS.has(token) || SLURS.has(singular) || SLURS.has(single)) return true;
  }
  return false;
}

/** A self-harm phrase appears in the folded text. */
export function hasSelfHarm(text: string): boolean {
  const folded = ` ${fold(text.replace(/['’]/g, ''))} `;
  return SELF_HARM_PHRASES.some((p) => folded.includes(` ${p} `));
}

export type PrefilterVerdict = 'ok' | 'slur' | 'self_harm';

export interface PrefilterResult {
  /** The text that enters the prompt: NFC, controls and tags stripped, contact data removed, at most 280 characters. */
  text: string;
  /** True when an e-mail, phone number or street address was removed (the `<player pii_removed="true">` flag). */
  piiRemoved: boolean;
  verdict: PrefilterVerdict;
}

/**
 * SafetyFilter.pre (04-npc.md section 5.4.1): sanitise, remove PII, then look at the lists. A slur is `slur` (the route answers
 * `moderation_blocked`); a self-harm phrase is `self_harm` (the turn proceeds and the conversation is forced to end).
 */
export function prefilterPlayerText(raw: string | undefined): PrefilterResult {
  const clean = sanitizePlayerText(raw ?? '');
  const scrubbed = scrubPii(clean);
  const verdict: PrefilterVerdict = hasSlur(clean) ? 'slur' : hasSelfHarm(clean) ? 'self_harm' : 'ok';
  return { text: scrubbed.text, piiRemoved: scrubbed.removed > 0, verdict };
}
