/**
 * The Tycoon policies as `BotDriver`s (M09a2; 13-qa.md 3.2, "P-9: every system has a bot"): ids `tycoon.median`, `tycoon.aggressive`,
 * `tycoon.frugal` and `tycoon.random`. A Tycoon run has no input frames (no physics, no controller), so `frame()` returns the neutral
 * frame; the decisions are `Command`s, read through `decide(view)` and applied by whoever hosts the run (the harness, the mode
 * through `mode.cmd`, a test). The driver draws randomness only from the host's `bot` stream. QA builds and Node only.
 */
import type { InputFrame } from '../../../packages/shared/src/index.ts';
import type { Command, PolicyView } from '../../../packages/shared/src/tycoon/index.ts';
import { registerBot, registeredBots, type BotContext, type BotDriver } from '../../../packages/engine/src/qa/bots.ts';
import { POLICY_IDS, shippedPolicies, type BotRng, type Policy } from './policies.ts';
import { loadContent, vcInfoOf } from './run.ts';

export const tycoonDriverId = (policy: string): string => `tycoon.${policy}`;

export interface TycoonBotDriver extends BotDriver {
  /** The commands the policy gives for this view of the company. */
  decide(view: PolicyView): Command[];
}

const NEUTRAL = (tick: number): InputFrame =>
  ({ tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 }) as InputFrame;

function streamRng(next: () => number): BotRng {
  const int = (n: number): number => Math.min(n - 1, Math.floor(next() * n));
  return { next, int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)] as T };
}

export function createTycoonBotDriver(policyId: string, policy?: Policy): TycoonBotDriver {
  let chosen: Policy | null = policy ?? null;
  let rng: BotRng | null = null;
  let lastPhase: PolicyView['phase'] | null = null;
  return {
    id: tycoonDriverId(policyId),
    device: 'bot',
    init(ctx: BotContext): void {
      chosen ??= shippedPolicies(vcInfoOf(loadContent()))[policyId] ?? null;
      if (!chosen) throw new Error(`tycoon bot driver: unknown policy '${policyId}'`);
      rng = streamRng(ctx.rng('bot'));
      lastPhase = null;
    },
    frame: NEUTRAL,
    decide(view: PolicyView): Command[] {
      if (!chosen || !rng) throw new Error(`driver '${tycoonDriverId(policyId)}' used before init`);
      lastPhase = view.phase;
      return chosen.decide(view, rng);
    },
    done(): { done: boolean; outcome?: string } {
      return lastPhase === 'ended' ? { done: true, outcome: 'ended' } : { done: false };
    },
  };
}

/** Registers `tycoon.<policy>` for the four shipped policies; ids that are already registered are left alone. Returns the ids. */
export function registerTycoonBots(): string[] {
  const have = new Set(registeredBots());
  const ids: string[] = [];
  for (const p of POLICY_IDS) {
    const id = tycoonDriverId(p);
    ids.push(id);
    if (!have.has(id)) registerBot(id, () => createTycoonBotDriver(p));
  }
  return ids;
}
