// packages/shared/src/fight/states.ts — FC4 fighter states. Data cannot add states.
export const enum St {
  // Ground neutral
  Idle, WalkF, WalkB, Crouch, CrouchDown, StandUp, DashF, DashB, Taunt,
  // Air
  PreJump, JumpN, JumpF, JumpB, Fall, Land, AirAttack,
  // Attack
  Attack, Special, Super, Throw, Auto,
  // Defence
  BlockStand, BlockCrouch, Check, CheckSuccess, Clear,
  // Reaction
  HitStand, HitCrouch, HitAir, Thrown, TechThrow, Knockdown, Wakeup, QuickRise,
  // Match
  RoundWin, RoundLose, Ko, Slumped, Shutdown, Victory, Defeat, Intro,
}
export const STATE_COUNT = 43;

/** Actionable ground states: the parser, jump, dash, crouch and walk all read input here. */
export function isActionable(s: number): boolean {
  return s === St.Idle || s === St.WalkF || s === St.WalkB || s === St.Crouch || s === St.CrouchDown || s === St.StandUp;
}
export function isAirborne(s: number): boolean {
  return s === St.JumpN || s === St.JumpF || s === St.JumpB || s === St.Fall || s === St.AirAttack || s === St.HitAir;
}
export function isMoveState(s: number): boolean {
  return s === St.Attack || s === St.Special || s === St.Super || s === St.Throw || s === St.Auto || s === St.AirAttack
    || s === St.Taunt || s === St.Shutdown;
}
export function isHitState(s: number): boolean {
  return s === St.HitStand || s === St.HitCrouch || s === St.HitAir;
}
export function isBlockState(s: number): boolean { return s === St.BlockStand || s === St.BlockCrouch; }
/** States that may start a block: actionable ones and a block already in blockstun. */
export function canBlockFrom(s: number): boolean { return isActionable(s) || s === St.BlockStand || s === St.BlockCrouch; }
/** Grounded states in which a throw connects (FC4: PreJump is throwable, airborne is not, Wakeup has an invulnerable window). */
export function isThrowable(s: number): boolean {
  return isActionable(s) || s === St.DashF || s === St.DashB || s === St.PreJump || s === St.Land || s === St.Taunt
    || s === St.Attack || s === St.Special || s === St.Super || s === St.Throw || s === St.Auto || s === St.Wakeup
    || s === St.Check || s === St.CheckSuccess;
}
