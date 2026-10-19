/**
 * The seeded input script for `walk-drop`: out-and-back legs from the spawn point (walk, run, sprint, jumps, the ramp),
 * so a 10,000-tick run stays inside the fixture world. QA builds and tests only: this file imports the bot, which a
 * production dist must not contain (`apps/web/scripts/verify-dist.mjs`).
 */
import { Rng, SimButton } from '@dv/shared';
import { ScriptedBotInput, type BotSegment } from '../input/bot-input.ts';
import { WALK_DROP } from './walk-drop.ts';

/** camYaw (u16) that faces +X, -Z (north), +Z. Forward is (-sin yaw, -cos yaw). */
const YAW_EAST = 49152;
const YAW_NORTH = 0;
const YAW_SOUTH = 32768;

type Profile = { stick: number; sprint: boolean; mps: number };
const PROFILES: readonly Profile[] = [
  { stick: 51, sprint: false, mps: 1.6 }, // walk: 0.4 of the stick
  { stick: 127, sprint: false, mps: 4.2 }, // run
  { stick: 127, sprint: true, mps: 6.8 }, // sprint
];

/**
 * Builds the script from `seed`. Every leg goes out for `legTicks` and comes back the same way, with 0 to 2 jumps at
 * seeded times; the ramp leg heads east along the grade. The return leg turns the view round (yaw + 180 degrees).
 */
export function walkDropBotScript(seed: number = WALK_DROP.seed, totalTicks: number = WALK_DROP.ticks): BotSegment[] {
  const rng = new Rng(seed ^ 0xb07);
  const out: BotSegment[] = [];
  let t = 30; // a half second to settle first
  const jumpBit = 1 << SimButton.Jump;
  const sprintBit = 1 << SimButton.Sprint;
  while (t < totalTicks) {
    const profile = PROFILES[rng.nextU32() % PROFILES.length] as Profile;
    const heading = [YAW_EAST, YAW_NORTH, YAW_SOUTH][rng.nextU32() % 3] as number;
    // Keep the leg inside the world: at most 36 m out, so the walk never leaves the fixture ground or reaches the ring.
    const maxTicks = Math.floor((36 / profile.mps) * 60);
    const legTicks = 60 + (rng.nextU32() % Math.max(1, maxTicks - 60));
    const jumps: number[] = [];
    for (let n = rng.nextU32() % 3; n > 0; n--) jumps.push(10 + (rng.nextU32() % Math.max(1, legTicks - 20)));
    for (const [dir, start] of [[heading, t], [(heading + 32768) & 0xffff, t + legTicks + 20]] as const) {
      const base: BotSegment = {
        from: start,
        to: start + legTicks,
        moveY: -profile.stick,
        camYaw: dir,
        buttons: profile.sprint ? sprintBit : 0,
      };
      // Split the leg at the jump ticks: a jump is one tick with the Jump bit held.
      const cuts = [...jumps].sort((a, b) => a - b);
      let from = base.from;
      for (const j of cuts) {
        const at = base.from + j;
        if (at <= from || at >= base.to - 1) continue;
        out.push({ ...base, from, to: at });
        out.push({ ...base, from: at, to: at + 1, buttons: (base.buttons ?? 0) | jumpBit });
        from = at + 1;
      }
      out.push({ ...base, from, to: base.to });
    }
    t += legTicks * 2 + 40;
  }
  return out;
}

export function walkDropBot(seed?: number): ScriptedBotInput {
  return new ScriptedBotInput(walkDropBotScript(seed));
}
