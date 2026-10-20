/**
 * The ambient traffic components and archetypes (02-world-living.md sections 2.5 and 8; M03b1).
 *
 * Components 256 `TrafficAgent`, 258 `RobotaxiBrain`, 259 `ParkedCar` and 263 `Witness` are hashed; 262 `SignalState` is derived from the
 * tick and is not. Component 263 is registered as `WorldWitness` because the engine's own `Witness` (id 18, owner S01) already holds
 * that name (BD-M03b1-01). The ids 257, 260, 261 and 264 belong to pedestrians, transit and aircraft (M03b2).
 *
 * Pure; C02 lint applies.
 */
import { defineComponent } from '@dv/engine/sim';
import type { ComponentDef } from '@dv/shared';
import compact from '../../../../../assets/prefabs/vehicle.compact.json';
import sedan from '../../../../../assets/prefabs/vehicle.sedan.json';
import rideshare from '../../../../../assets/prefabs/vehicle.rideshare.json';
import van from '../../../../../assets/prefabs/vehicle.van.json';
import truck from '../../../../../assets/prefabs/vehicle.truck.json';
import pickup from '../../../../../assets/prefabs/vehicle.pickup.json';
import cruiser from '../../../../../assets/prefabs/police.cruiser.json';
import robotaxi from '../../../../../assets/prefabs/robotaxi.default.json';

export const TrafficAgent = defineComponent({
  id: 256, name: 'TrafficAgent', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { edge: 'u32', s: 'f32', lane: 'u8', speed: 'f32', nextEdge: 'u32', turn: 'u8', state: 'u8' },
});
export const RobotaxiBrain = defineComponent({
  id: 258, name: 'RobotaxiBrain', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { mode: 'u8', holdUntil: 'u32', fare: 'u8' },
});
export const ParkedCar = defineComponent({
  id: 259, name: 'ParkedCar', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { seg: 'u32', s: 'f32', side: 'i8', locked: 'u8' },
});
export const SignalState = defineComponent({
  id: 262, name: 'SignalState', owner: 'S02', hashed: false, snapshot: 'none',
  schema: { junction: 'u16', phase: 'u8', aspectBits: 'u16' },
});
export const WorldWitness = defineComponent({
  id: 263, name: 'WorldWitness', owner: 'S02', hashed: true, snapshot: 'none',
  schema: { target: 'u32', reportAtTick: 'u32', kind: 'u8' },
});

/** The components the world module adds to a session that has a world (the registry is fixed when the sim is built). */
export const WORLD_COMPONENTS: readonly ComponentDef[] = [TrafficAgent, RobotaxiBrain, ParkedCar, SignalState, WorldWitness];

/** `TrafficAgent.state` values. */
export const AgentState = {
  /** Driving along an edge. */
  Drive: 0,
  /** Inside a junction, on the connector of its movement. */
  Cross: 1,
  /** Stopped or slowing for something it waits on (a line, a claim, a leader). */
  Wait: 2,
  /** A robotaxi holding at a dark signal with hazard lights on. */
  Stalled: 3,
  /** Pulled right for a siren. */
  Pulled: 4,
  /** Stopped at a dead end for a second before the U-turn. */
  DeadEnd: 5,
  /** Its edge left residency: frozen for 2 s, then despawned. */
  Frozen: 6,
} as const;
export type AgentStateId = (typeof AgentState)[keyof typeof AgentState];

/** `TrafficAgent.turn` values: the turn the agent will take at the end of its edge (255: not planned yet). */
export const Turn = { Straight: 0, Right: 1, Left: 2, UTurn: 3, None: 255 } as const;

/** Bits of `Anim.state` that the traffic renderer reads (lights; the head and tail lamps follow the darkness on the page). */
export const LightBit = { Brake: 1, Hazard: 2, Dome: 4, Reverse: 8 } as const;

/** What kind of ambient entity an agent is. */
export const AgentKind = { Traffic: 0, Robotaxi: 1, Parked: 2 } as const;
export type AgentKindId = (typeof AgentKind)[keyof typeof AgentKind];

/** An ambient archetype: a gray-box car until M10d1 (Q-39). Dimensions are half extents of the prefab box, metres. */
export interface Archetype {
  readonly id: number;
  /** Entity prefab of the vehicle a promoted agent becomes (M03a1). */
  readonly prefab: string;
  /** The C07 asset the snapshot carries (`vehicle/graybox.*`). */
  readonly asset: string;
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly halfHeight: number;
  /** Metres the box centre stands above the road. */
  readonly lift: number;
  readonly massKg: number;
}

interface PrefabJson {
  id: string;
  render: { asset: string };
  physics: { dims: number[]; liftM: number; massKg: number };
}

const arch = (id: number, p: unknown): Archetype => {
  const j = p as PrefabJson;
  const [hx, hy, hz] = j.physics.dims as [number, number, number];
  return { id, prefab: j.id, asset: j.render.asset, halfWidth: hx, halfLength: hz, halfHeight: hy, lift: j.physics.liftM, massKg: j.physics.massKg };
};

/** In the order of the shares below; an archetype's index is the byte the traffic renderer groups by. */
export const ARCHETYPES: readonly Archetype[] = [
  arch(0, compact), arch(1, sedan), arch(2, rideshare), arch(3, robotaxi), arch(4, van), arch(5, truck), arch(6, pickup), arch(7, cruiser),
];
export const ARCH = { compact: 0, sedan: 1, rideshare: 2, robotaxi: 3, van: 4, truck: 5, pickup: 6, cruiser: 7 } as const;

/** The C07 assets of the archetypes, indexed by archetype id (the traffic renderer's draw groups). */
export const ARCHETYPE_ASSETS: readonly string[] = ARCHETYPES.map((a) => a.asset);

/** The 12-colour body palette (sRGB hex), picked by hash. */
export const PALETTE: readonly number[] = [
  0xe8e8ea, 0x1c1d21, 0x8c9096, 0xb9bcc2, 0xa4262c, 0x2f5fa8, 0x2b7a4b, 0xd6a02a, 0x6b4a2f, 0xe06b2d, 0x5a3a8a, 0x7fb6c9,
];

/** Profiles where the robotaxi share is 8 % (living part 2.5); elsewhere 3 %. */
const ROBOTAXI_DENSE = new Set(['cbd', 'cbd-tech', 'nightlife', 'civic-dense', 'tourist-dense']);

/** Share of patrol cruisers among all slots (they are ordinary agents until the PursuitDirector owns them, M03c). */
export const POLICE_SHARE = 0.02;

/**
 * The archetype for a unit draw `u` in [0, 1) in a cell of the named density profile. Shares of the non-police slots: compact 32,
 * sedan 26, rideshare 12, robotaxi 8 (3 in the other profiles, the difference going to sedan), van 8, truck 6, pickup 6; the
 * industrial profile triples the van and truck shares and renormalizes. `police.cruiser` takes 2 % of all slots.
 */
export function pickArchetype(u: number, profile: string): number {
  if (u < POLICE_SHARE) return ARCH.cruiser;
  const v = (u - POLICE_SHARE) / (1 - POLICE_SHARE);
  const robo = ROBOTAXI_DENSE.has(profile) ? 8 : 3;
  const heavy = profile === 'industrial' ? 3 : 1;
  const w = [32, 26 + (8 - robo), 12, robo, 8 * heavy, 6 * heavy, 6];
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i] as number;
  let t = v * total;
  for (let i = 0; i < w.length; i++) {
    t -= w[i] as number;
    if (t < 0) return i;
  }
  return ARCH.pickup;
}
