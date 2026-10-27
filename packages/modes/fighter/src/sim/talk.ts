/**
 * Trash talk (FC10.5, M08b1): the authored pre- and post-fight lines per pair class (`content/fighter/talk.json`). The line is a pure
 * function of the two slots and a seed, so a rematch of the same pair says the same thing and a replay shows the same subtitle.
 * The ink and model lines of M10c replace these without touching the call sites. Sim code under the C02 lint.
 */
import { fnv32 } from '@dv/shared';
import talkJson from '../../../../../content/fighter/talk.json';

interface TalkFile {
  v: 1;
  families: Record<string, string>;
  classes: Record<string, { pre: string[]; post: string[] }>;
  fallback: { pre: string[]; post: string[] };
}
const TALK = talkJson as unknown as TalkFile;

export type TalkKind = 'pre' | 'post';

/** `rap-tech`, `sport-sport`, `player-any`: the two families sorted, or the player class when the player's avatar is in the pair. */
export function pairClass(slotA: string, slotB: string): string {
  const a = TALK.families[slotA] ?? 'any', b = TALK.families[slotB] ?? 'any';
  if (a === 'player' || b === 'player') return 'player-any';
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

/** The line for a pair: `kind` pre (before the bout) or post (the winner's line afterwards). */
export function talkLine(slotA: string, slotB: string, kind: TalkKind, seed = 0): string {
  const cls = TALK.classes[pairClass(slotA, slotB)] ?? TALK.fallback;
  const lines = cls[kind];
  if (lines.length === 0) return '';
  const lo = slotA <= slotB ? slotA : slotB, hi = slotA <= slotB ? slotB : slotA;
  return lines[(fnv32(`${lo}|${hi}|${kind}|${seed}`) >>> 0) % lines.length] as string;
}

/** Every line of the file, for the checks (no real name, short, original). */
export function allTalkLines(): string[] {
  return [...Object.values(TALK.classes).flatMap((c) => [...c.pre, ...c.post]), ...TALK.fallback.pre, ...TALK.fallback.post];
}
