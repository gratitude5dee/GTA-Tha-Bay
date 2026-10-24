/**
 * The seam between a race and the world it runs in (M07a1). The race session (`session.ts`) holds all the rules and talks to the
 * physics world only through this port, so the mode (production, behind `ModeContext`) and the headless QA scenario (Node and
 * WebKit, `qa/scenario.ts`) run the same code. The engine implementation is `engine-port.ts`.
 *
 * Positions are ENU metres (+X east, +Y up, -Z north); `yaw` follows the engine convention (0 faces -Z).
 */
import type { DamageState } from '@dv/shared';

export interface CarReadout {
  /** Body centre. */
  pos: [number, number, number];
  /** Point on the front axle, for the gate test. */
  front: [number, number, number];
  yaw: number;
  /** Signed speed along the heading, m/s. */
  speedMps: number;
  vel: [number, number, number];
  /** Y component of the up vector. */
  upY: number;
  /** Ticks since any wheel touched the ground. */
  airTicks: number;
  gear: number;
  rpm: number;
  /** Slip angle of the body, degrees (0 when rolling straight). */
  slipDeg: number;
}

/** Driving command for one tick: the integer fields of a C03 `InputFrame` plus the handbrake. */
export interface CarCommand {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

/** A contact reported by the physics wrapper since the last read. */
export interface CarImpact {
  vNormal: number;
  /** The front of the car took the hit. */
  frontal: boolean;
}

export interface RaceWorldPort {
  /** Colliders under (x, z) are in the working set. */
  collidersReady(x: number, z: number): boolean;
  /** Puts the player's car on the grid and seats the local player at its wheel. False when it cannot be made yet. */
  spawnCar(prefabId: string, pos: [number, number, number], yaw: number): boolean;
  /** The car's state, or null while there is no car. */
  read(): CarReadout | null;
  /** Moves the car (a respawn or a retry), stops it, and clears the suspension memory. */
  place(pos: [number, number, number], yaw: number): void;
  /** Writes the driving command; the wrapper steps the handling with it. */
  drive(c: CarCommand): void;
  /** Nitro is open this tick (`HandlingState.nitroOn`). */
  setNitro(on: boolean, charge: number): void;
  /** Overwrites the damage the wrapper tracks (engine health feeds `powerScale`, tyre health the grip). */
  setDamage(d: DamageState): void;
  /** The contacts since the last call, oldest first. */
  takeImpacts(): CarImpact[];
  /** The ground height under (x, z), or null when no collider is there. */
  groundY(x: number, z: number): number | null;
  /** Removes the car and puts the player back on foot beside where it stood. */
  release(): void;
}
