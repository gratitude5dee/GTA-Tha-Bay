/**
 * The state of one named NPC's brain and the inputs the brains read (04-npc-builder.md section C8; M06c). Plain data, no ECS: the
 * brain simulation (`sim.ts`) is pure so a headless test can run it for ten game minutes, and `system.ts` mirrors the agents into
 * components 768 to 775. Sim code; C02 lint applies.
 */
import { Rng, type PoiId } from '@dv/shared';
import type { CompiledSoulPublic } from '@dv/shared/contracts/c10-npc';
import type { Vec3 } from '@dv/shared/npc';

/** LOD tiers: A runs the full brain, B follows the schedule only, C is not simulated. */
export const LOD = { A: 0, B: 1, C: 2 } as const;
export type LodTier = (typeof LOD)[keyof typeof LOD];

/** What the utility layer picked; also the order candidates are evaluated in (an earlier index wins a tie). */
export const UTILITY = { Talk: 0, Hold: 1, Flee: 2, Intent: 3, Greet: 4, Schedule: 5 } as const;
export type UtilityKind = (typeof UTILITY)[keyof typeof UTILITY];
export const UTILITY_NAMES: readonly string[] = ['talk', 'hold', 'flee', 'intent', 'greet', 'schedule'];
export const UTILITY_COUNT = 6;

/** Engine anim state ids the brains ask for (C04: idle 0, walk 1, run 2, emote 21; sleeping, working and waving are idle or emote until M10d1's clips). */
export const ANIM = { idle: 0, walk: 1, run: 2, emote: 21 } as const;

export interface IntentGoalState {
  /** A goal of the soul, or one of `approach_player`, `avoid_player`, `go_to`. `continue_schedule` clears the intent instead. */
  goal: string;
  /** A POI id, a StableKey or null. */
  target: string | null;
  /** 0 low, 1 med, 2 high. */
  urgency: 0 | 1 | 2;
  /** Position the goal points at (resolved when the intent arrived). */
  tx: number;
  tz: number;
  /** Sim tick the intent holds until; unused when `block` is set. */
  until: number;
  /** Schedule block index the intent holds for (`until: 'next_block'`), -1 for a timed intent. */
  block: number;
  /** BarkTag the intent asked the NPC to say, or ''. */
  bark: string;
}

export interface ThreatState {
  /** A `NearbyEvent` name, or `intent` when the hero's intent asked the NPC to avoid the player. */
  kind: string;
  x: number;
  z: number;
  /** Sim tick the threat stops counting. */
  until: number;
}

export class NpcAgent {
  /** Dense index in spawn order; breaks every tie. */
  slot = 0;
  readonly key: string;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  lod: LodTier = LOD.C;
  /** False while the roster kill-switch (`spawn` scope) removes the NPC from the world. */
  enabled = true;
  /** True once the NPC has a position from `whereIs`. */
  placed = false;
  /** True once `y` came from the ground query: a later miss (the tile is not resident) keeps it. */
  grounded = false;
  block = -1;
  gameDay = -1;
  winner: UtilityKind = UTILITY.Schedule;
  /** Candidate scores of the last utility pass, in `UTILITY` order. */
  readonly scores = new Float64Array(UTILITY_COUNT);
  tree = -1;
  /** Child index per depth of the behaviour tree. */
  readonly stack = new Uint8Array(4);
  leafT = 0;
  leafAux = -1;
  /** Id of the leaf that ran last (the trace and the debug overlay read it). */
  leafId = 0;
  anim: number = ANIM.idle;
  wx = 0;
  wz = 0;
  /** POI whose smart-object slot the NPC holds, '' when none. */
  slotPoi = '';
  intent: IntentGoalState | null = null;
  threat: ThreatState | null = null;
  talking = false;
  talkTicks = 0;
  fleeTicks = 0;
  /** Mission lock owner count: above 0 the NPC is busy. */
  locks = 0;
  /** Full brain steps run (LOD A) and schedule steps (LOD B). */
  aSteps = 0;
  bSteps = 0;
  /** Seeded from (world seed, NPC id, game day); re-seeded when the day changes. */
  readonly rng: Rng;

  constructor(readonly soul: CompiledSoulPublic) {
    this.key = `npc:${soul.id}`;
    this.rng = new Rng(1);
  }

  get id(): string {
    return this.soul.id;
  }

  get busy(): boolean {
    return this.talking || this.locks > 0;
  }
}

/** Where the world answers a POI and a commute (the baked POIs, the stub table for the rest). */
export interface BrainWorld {
  poiPos(id: PoiId): Vec3 | null;
  pedRoute?(a: PoiId, b: PoiId): Vec3[];
  groundY?(x: number, z: number): number | null;
}

/** What the brains read each tick that is not their own state. */
export interface BrainEnv {
  tick: number;
  /** C06 half-seconds of the game clock. */
  clockT: number;
  /** The local player on foot or in a vehicle, null when there is none (then nothing is simulated). */
  player: { x: number; y: number; z: number } | null;
  /** Trust of the player with this NPC, -100..100 (the save's `npcRelations`; 0 when unknown). */
  trust(npcId: string): number;
}

/** One line of the per-tick brain trace: what the AC-1 determinism test compares. */
export interface TraceRecord {
  tick: number;
  slot: number;
  lod: LodTier;
  block: number;
  winner: UtilityKind;
  leaf: number;
}

/** A fact the brains report to the page: the intent driver turns these into triggers. */
export type BrainEvent =
  | { kind: 'block'; npcId: string; tick: number; block: number }
  | { kind: 'talk.end'; npcId: string; tick: number }
  | { kind: 'bark'; npcId: string; tick: number; tag: string };
