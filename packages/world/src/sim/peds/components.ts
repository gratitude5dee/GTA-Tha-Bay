/**
 * The pedestrian component and states (02-world-living.md sections 4 and 8; M03b2).
 *
 * Component 257 `PedAgent` is hashed. The ids 260, 261 and 264 belong to transit and aircraft (`transit/components.ts`).
 * Pure; C02 lint applies.
 */
import { defineComponent } from '@dv/engine/sim';
import type { ComponentDef } from '@dv/shared';

export const PedAgent = defineComponent({
  id: 257, name: 'PedAgent', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { node: 'u32', next: 'u32', t: 'f32', state: 'u8', timer: 'u16' },
});

/** The components the pedestrian layer adds to a session that asks for it (`WorldSimConfig.ambient.peds`). */
export const PED_COMPONENTS: readonly ComponentDef[] = [PedAgent];

/** `PedAgent.state` values (the FSM of living part 4.2). */
export const PedState = {
  Walk: 0,
  /** Standing at the kerb of a crossing that is not open. */
  Wait: 1,
  /** Phone, talk, bench: 5 to 40 s at a `Waiting` node. */
  Idle: 2,
  /** Stepping out of the path of a fast vehicle. */
  Dodge: 3,
  Flee: 4,
  /** Filming an attractor. */
  Record: 5,
  Cheer: 6,
  /** Knocked down by a vehicle; gets up after 3 s. */
  Hit: 7,
  /** Standing still until the seeded report of an infraction. */
  Witness: 8,
  /** Its chunk left residency: frozen for 2 s, then removed. */
  Frozen: 9,
} as const;
export type PedStateId = (typeof PedState)[keyof typeof PedState];

/** Eight bodies (palette variants `ped.ambient.{a..h}`) by twenty outfits; no child bodies, no real likeness. */
export const PED_BODIES = 8;
export const PED_OUTFITS = 20;
/** The gray-box C07 assets of the eight bodies, indexed by body. */
export const PED_ASSETS: readonly string[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => `character/ped.ambient.${c}`);

/** Clothing palette (sRGB hex) the instanced figure tints with: index = outfit. */
export const PED_PALETTE: readonly number[] = [
  0x3b5ba8, 0xa8423b, 0x3b8a5a, 0xd0a53a, 0x6f4a8f, 0x2c2f36, 0xd9d9d6, 0x8a6b4a, 0x2f7f8c, 0xc9663b,
  0x5d6b2f, 0xb04a7f, 0x4a4f8f, 0x7c7f86, 0x1f4d3a, 0xe0c9a0, 0x8f3b2c, 0x3a6fa8, 0x9a8f3a, 0x55353f,
];

/** Walking pace and its spread, m/s (living 4.2). */
export const WALK_MPS = 1.4;
export const WALK_SPREAD_MPS = 0.2;
export const STAIRS_FACTOR = 0.6;
export const FLEE_MPS = 2.8;
export const FLEE_TICKS = 600;
export const DODGE_TICKS = 36;
export const IDLE_MIN_TICKS = 300;
export const IDLE_MAX_TICKS = 2400;
export const WITNESS_MIN_TICKS = 180;
export const WITNESS_MAX_TICKS = 360;
export const HIT_TICKS = 180;
export const PED_FREEZE_TICKS = 120;
