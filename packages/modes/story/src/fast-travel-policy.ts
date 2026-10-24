/**
 * Story fast travel (M05c2). The world's teleport service asks its policy once a request's target is resolved; the story mode installs
 * this rule on `ctx.world.teleport.policy` while it is attached and restores the previous policy on exit. A `fast-travel` request is
 * allowed only
 *   - outside a mission stage or beat (a mission that is starting, running its intro or outro, or failed counts as inside), and
 *   - when the target's district (`WorldApi.query.districtAt`) is in `grants.districts` of an UnlockDef the player has unlocked.
 * Otherwise it is refused as `forbidden-in-mode` with `story.fastTravel.inMission` or `story.fastTravel.locked`. Other kinds of
 * teleport (sandbox, debug, comfort) are not the story's to refuse here; the base policy answers them. No contract changes: the
 * C08 result and `TeleportPolicy` are used as they are, plus the optional `deny` hook of the world's own policy interface.
 */
import type { UnlockDef } from '@dv/shared';

export const FAST_TRAVEL_MSG = {
  locked: 'story.fastTravel.locked',
  inMission: 'story.fastTravel.inMission',
} as const;

export interface FastTravelPorts {
  /** A mission stage or beat is in progress. */
  inMission(): boolean;
  /** `WorldApi.query.districtAt`. */
  districtAt(x: number, z: number): string | null;
  /** Whether the unlock id is held (`ctx.unlocks.has`). */
  hasUnlock(id: string): boolean;
  /** The unlock rows of the story (`storyUnlockDefs()`). */
  defs(): readonly UnlockDef[];
}

/** The districts whose unlock is held. */
export function unlockedDistricts(defs: readonly UnlockDef[], has: (id: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const d of defs) {
    if (!d.grants.districts || !has(d.id)) continue;
    for (const dist of d.grants.districts) out.add(dist);
  }
  return out;
}

/** The message key that refuses a fast-travel request to (x, z), or null when it may go on. Other kinds of teleport are never refused here. */
export function fastTravelDenial(kind: string, x: number, z: number, p: FastTravelPorts): string | null {
  if (kind !== 'fast-travel') return null;
  if (p.inMission()) return FAST_TRAVEL_MSG.inMission;
  const district = p.districtAt(x, z);
  if (district === null || !unlockedDistricts(p.defs(), (id) => p.hasUnlock(id)).has(district)) return FAST_TRAVEL_MSG.locked;
  return null;
}

/** The shape of the world's teleport policy this module extends (kept structural so the story package needs no import of the world package). */
export interface PolicyLike {
  allowed(kind: never): boolean;
  heat(): number;
  deny?(kind: never, target: { x: number; z: number; id: string | null }): string | null;
}

/** A policy that is `base` plus the story rule. */
export function storyTeleportPolicy<P extends PolicyLike>(base: P, ports: FastTravelPorts): P {
  const baseDeny = base.deny as ((kind: string, t: { x: number; z: number; id: string | null }) => string | null) | undefined;
  return {
    ...base,
    deny: (kind: string, t: { x: number; z: number; id: string | null }) => baseDeny?.call(base, kind, t) ?? fastTravelDenial(kind, t.x, t.z, ports),
  } as P;
}
