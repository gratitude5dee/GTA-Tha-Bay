/**
 * The ink knot a dialogue falls back to (04-npc.md section 5.5). Pure, shared by the Worker (the knot a `fallback` event names) and the
 * client (the knot it plays when no event named one: a network failure, an offline ApiError, the setting "AI dialogue: off").
 *
 *  - a mission intent (ask_mission, accept, decline) inside a mission step: `mission_<missionId>_<talkId>` with '.' and '-' turned into '_' (DL-085)
 *  - `farewell` for a farewell, `greeting` for a greeting, `smalltalk` for everything else
 */
import type { InkKnot, NPCDialogueContext } from '../contracts/c10-npc.ts';

export function inkKnotFor(ctx: Pick<NPCDialogueContext, 'missionId' | 'missionStep'>, intent: string | undefined): InkKnot {
  const missionIntent = intent === 'ask_mission' || intent === 'accept' || intent === 'decline';
  if (missionIntent && ctx.missionId !== null && ctx.missionStep !== null) {
    const norm = (s: string): string => s.replace(/[.-]/g, '_');
    return `mission_${norm(ctx.missionId)}_${norm(ctx.missionStep)}`;
  }
  if (intent === 'farewell') return 'farewell';
  if (intent === 'greet') return 'greeting';
  return 'smalltalk';
}

/** The knots to try, in order, when the first one is not defined in the NPC's ink: the knot itself, then smalltalk, greeting, busy. */
export function knotChain(knot: InkKnot): InkKnot[] {
  return [...new Set<InkKnot>([knot, 'smalltalk', 'greeting', 'busy'])];
}
