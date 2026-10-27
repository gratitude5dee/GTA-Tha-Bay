/**
 * `AnimStateId` block 160 to 207, reserved for the fighter by ADR-0016 (07-fighter-content.md FX7). The presentation maps the sim's
 * fighter states (FC4, `St`) to these ids; the move being played is `FighterView.move` plus its frame, so the ids of move-driven
 * states (attack, special, super) only name the family. Pure; no DOM, no three.
 */
import type { AnimStateId } from '@dv/shared';
import { St } from '@dv/shared/fight';

export const FIGHTER_ANIM = {
  idle: 160, walkF: 161, walkB: 162, crouch: 163, crouchDown: 164, standUp: 165,
  preJump: 166, jumpN: 167, jumpF: 168, jumpB: 169, fall: 170, land: 171, dashF: 172, dashB: 173,
  blockStand: 174, blockCrouch: 175, hitStand: 176, hitHeavy: 177, hitCrouch: 178, hitAir: 179,
  knockdownFall: 180, knockdownLie: 181, wakeup: 182, quickRise: 183,
  throwAttempt: 184, thrown: 185, tech: 186, attack: 187, special: 188, superStart: 189, superMove: 190,
  check: 191, checkSuccess: 192, clear: 193, rattled: 194, taunt: 195,
  intro: 196, roundWin: 197, roundLose: 198, ko: 199, slumped: 200, shutdown: 201, timeOutLose: 202, victory: 203, defeat: 204, summonCall: 205,
} as const satisfies Record<string, AnimStateId>;

export const FIGHTER_ANIM_MIN = 160;
export const FIGHTER_ANIM_MAX = 207;

const TABLE: Record<number, AnimStateId> = {
  [St.Idle]: FIGHTER_ANIM.idle, [St.WalkF]: FIGHTER_ANIM.walkF, [St.WalkB]: FIGHTER_ANIM.walkB, [St.Crouch]: FIGHTER_ANIM.crouch,
  [St.CrouchDown]: FIGHTER_ANIM.crouchDown, [St.StandUp]: FIGHTER_ANIM.standUp, [St.DashF]: FIGHTER_ANIM.dashF, [St.DashB]: FIGHTER_ANIM.dashB,
  [St.Taunt]: FIGHTER_ANIM.taunt,
  [St.PreJump]: FIGHTER_ANIM.preJump, [St.JumpN]: FIGHTER_ANIM.jumpN, [St.JumpF]: FIGHTER_ANIM.jumpF, [St.JumpB]: FIGHTER_ANIM.jumpB,
  [St.Fall]: FIGHTER_ANIM.fall, [St.Land]: FIGHTER_ANIM.land, [St.AirAttack]: FIGHTER_ANIM.attack,
  [St.Attack]: FIGHTER_ANIM.attack, [St.Special]: FIGHTER_ANIM.special, [St.Super]: FIGHTER_ANIM.superMove, [St.Throw]: FIGHTER_ANIM.throwAttempt,
  [St.Auto]: FIGHTER_ANIM.attack,
  [St.BlockStand]: FIGHTER_ANIM.blockStand, [St.BlockCrouch]: FIGHTER_ANIM.blockCrouch, [St.Check]: FIGHTER_ANIM.check,
  [St.CheckSuccess]: FIGHTER_ANIM.checkSuccess, [St.Clear]: FIGHTER_ANIM.clear,
  [St.HitStand]: FIGHTER_ANIM.hitStand, [St.HitCrouch]: FIGHTER_ANIM.hitCrouch, [St.HitAir]: FIGHTER_ANIM.hitAir, [St.Thrown]: FIGHTER_ANIM.thrown,
  [St.TechThrow]: FIGHTER_ANIM.tech, [St.Knockdown]: FIGHTER_ANIM.knockdownLie, [St.Wakeup]: FIGHTER_ANIM.wakeup, [St.QuickRise]: FIGHTER_ANIM.quickRise,
  [St.RoundWin]: FIGHTER_ANIM.roundWin, [St.RoundLose]: FIGHTER_ANIM.roundLose, [St.Ko]: FIGHTER_ANIM.ko, [St.Slumped]: FIGHTER_ANIM.slumped,
  [St.Shutdown]: FIGHTER_ANIM.shutdown, [St.Victory]: FIGHTER_ANIM.victory, [St.Defeat]: FIGHTER_ANIM.defeat, [St.Intro]: FIGHTER_ANIM.intro,
};

/** The anim id of a fight state; `rattled` replaces the idle family while the fighter is Rattled. */
export function animOfState(state: number, rattled = false): AnimStateId {
  const id = TABLE[state] ?? FIGHTER_ANIM.idle;
  if (rattled && id >= FIGHTER_ANIM.idle && id <= FIGHTER_ANIM.standUp) return FIGHTER_ANIM.rattled;
  return id;
}

/** States whose clip is the move being played (frame-locked, FX7): the presenter plays `anim/<slug>.moves` clip `FighterView.move`. */
export function isMoveDriven(state: number): boolean {
  return state === St.Attack || state === St.Special || state === St.Super || state === St.Throw || state === St.Auto || state === St.AirAttack
    || state === St.Taunt || state === St.Shutdown;
}
