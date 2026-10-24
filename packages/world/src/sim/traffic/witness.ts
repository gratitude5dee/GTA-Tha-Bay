/**
 * Robotaxi witness hooks (02-world-living.md section 3 item 5; M03b1).
 *
 * Whatever detects an infraction (the PursuitDirector of M03c, a rule system, a test) posts it to the `WitnessBoard`. A robotaxi within
 * 40 m with a clear line of sight picks it up: it writes component 263 (`WorldWitness`: target, report tick, kind) and, 2 s later,
 * the board's sink receives exactly one `world.witness` event for that infraction, `{t: 'world.witness', s: <InfractionKind>,
 * n: <reportAtTick>}`. Line of sight is a ray against the static colliders; the robotaxis share at most 4 rays per tick.
 * Until M03c subscribes, the events are only counted.
 *
 * Pure; C02 lint applies.
 */

/** `InfractionKind` of the pursuit contract (01-engine-save-modes.md); the C06 type lands with M04a. */
export type InfractionKind =
  | 'speedingSeen' | 'redLightSeen' | 'hitCivilianVehicle' | 'hitPoliceVehicle' | 'propertyDamage' | 'assault' | 'zoneViolation' | 'evasion';

/** The `WorldWitness.kind` byte of each kind. */
export const INFRACTION_CODE: Readonly<Record<InfractionKind, number>> = {
  speedingSeen: 1, redLightSeen: 2, hitCivilianVehicle: 3, hitPoliceVehicle: 4, propertyDamage: 5, assault: 6, zoneViolation: 7, evasion: 8,
};
const KIND_OF_CODE: readonly (InfractionKind | undefined)[] = [
  undefined, 'speedingSeen', 'redLightSeen', 'hitCivilianVehicle', 'hitPoliceVehicle', 'propertyDamage', 'assault', 'zoneViolation', 'evasion',
];
export const kindOfCode = (code: number): InfractionKind | undefined => KIND_OF_CODE[code];

/** A witness sees an infraction within this distance, metres. */
export const WITNESS_RANGE_M = 40;
/** Ticks between a robotaxi seeing an infraction and the report (2 s). */
export const REPORT_DELAY_TICKS = 120;
/** Line-of-sight rays the robotaxis may cast per tick together. */
export const ROBOTAXI_RAYS_PER_TICK = 4;
/** Infractions older than this (ticks) that nobody saw are forgotten (10 s). */
export const INFRACTION_TTL_TICKS = 600;

export interface Infraction {
  id: number;
  kind: InfractionKind;
  /** Where it happened, ENU metres. */
  x: number;
  y: number;
  z: number;
  /** StableKey of the actor (the player's vehicle), or the empty string. */
  actor: string;
  /** Tick it was posted. */
  tick: number;
  /** A robotaxi has reported it; later witnesses drop theirs. */
  reported: boolean;
}

export interface WitnessEvent {
  kind: InfractionKind;
  reportAtTick: number;
  infraction: number;
  witness: string;
}

export type WitnessSink = (e: WitnessEvent) => void;

/** The infractions waiting to be seen and the sinks that hear the reports. */
export class WitnessBoard {
  private nextId = 1;
  private list: Infraction[] = [];
  private readonly sinks = new Set<WitnessSink>();
  /** `world.witness` events emitted so far (counted until M03c subscribes). */
  emitted = 0;

  /** Posts an infraction; returns its id. */
  post(kind: InfractionKind, at: { x: number; y: number; z: number }, actor: string, tick: number): number {
    const i: Infraction = { id: this.nextId++, kind, x: at.x, y: at.y, z: at.z, actor, tick, reported: false };
    this.list.push(i);
    return i.id;
  }

  /** Live infractions, oldest first. */
  pending(): readonly Infraction[] {
    return this.list;
  }

  get(id: number): Infraction | undefined {
    for (const i of this.list) if (i.id === id) return i;
    return undefined;
  }

  /** Marks `id` reported and tells the sinks; false when it was already reported (the second witness stays silent). */
  report(id: number, witness: string, reportAtTick: number): boolean {
    const i = this.get(id);
    if (!i || i.reported) return false;
    i.reported = true;
    this.emitted++;
    const e: WitnessEvent = { kind: i.kind, reportAtTick, infraction: id, witness };
    for (const s of [...this.sinks]) s(e);
    return true;
  }

  /** Drops reported infractions and those nobody saw within the time to live. */
  prune(tick: number): void {
    if (this.list.length === 0) return;
    this.list = this.list.filter((i) => !i.reported && tick - i.tick <= INFRACTION_TTL_TICKS);
  }

  onWitness(fn: WitnessSink): () => void {
    this.sinks.add(fn);
    return () => this.sinks.delete(fn);
  }

  clear(): void {
    this.list = [];
  }
}
