/**
 * Frame data of the open-world melee (M05c1, `CombatApi`; S01 basic core until M08a1 brings the fighter's frame data). Three
 * moves at 60 Hz: a move has `startup` ticks before the hitbox exists, `active` ticks in which it can connect (one hit per victim),
 * and `recovery` ticks in which the attacker cannot start another. The numbers are design values; the economy of the game does not
 * depend on them. The set is non-lethal by construction: a hit that would take a target to 0 hp sets `Health.ko` instead, and
 * nothing is despawned.
 */
export type MoveId = 'jab' | 'shove' | 'takedown';

export interface MoveDef {
  id: MoveId;
  startup: number;
  active: number;
  recovery: number;
  /** Distance from the attacker's centre to the hitbox centre, metres. */
  reachM: number;
  /** Radius of the hitbox sphere, metres. */
  radiusM: number;
  /** Health points taken (of 100). */
  damage: number;
  /** Metres the victim is pushed along the attack heading. */
  pushM: number;
  /** Only connects with a target that has lost some health; a hit on a damaged target sets `Health.ko`. */
  needsDamaged: boolean;
}

export const BASIC_MOVE_SET = 'basic';

export const MOVES: Readonly<Record<MoveId, MoveDef>> = {
  jab: { id: 'jab', startup: 6, active: 4, recovery: 10, reachM: 1.0, radiusM: 0.55, damage: 12, pushM: 0.15, needsDamaged: false },
  shove: { id: 'shove', startup: 10, active: 3, recovery: 16, reachM: 0.95, radiusM: 0.6, damage: 4, pushM: 1.5, needsDamaged: false },
  takedown: { id: 'takedown', startup: 14, active: 3, recovery: 22, reachM: 0.9, radiusM: 0.6, damage: 25, pushM: 0, needsDamaged: true },
};

export const MOVE_IDS: readonly MoveId[] = ['jab', 'shove', 'takedown'];

export const isMoveId = (s: string): s is MoveId => s === 'jab' || s === 'shove' || s === 'takedown';

/** A target at or below this fraction of its maximum health is "damaged enough" for the player's attack to pick a takedown. */
export const TAKEDOWN_BELOW = 0.65;
/** Ticks a knocked-out character stays down (10 s). */
export const KO_TICKS = 600;
/** Health fraction a character wakes up with. */
export const WAKE_FRACTION = 0.25;
/** Victim capsule used by the hitbox test (matches the `ped.actor` and player capsules). */
export const VICTIM_RADIUS_M = 0.35;
export const VICTIM_HEIGHT_M = 1.8;
/** Height of the hitbox centre above the attacker's feet. */
export const HITBOX_Y_M = 1.0;
