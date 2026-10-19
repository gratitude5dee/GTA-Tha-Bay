import physicsJson from '../../../../../config/physics.json';

/** The `character` block of config/physics.json (M01b1): capsule, KCC settings, speeds, hill factors, jump, timings. */
export interface CharacterConfig {
  readonly radiusM: number;
  readonly heightM: number;
  /** Camera anchors, metres above the feet. */
  readonly headY: number;
  readonly chestY: number;
  /** KCC contact skin. */
  readonly skinM: number;
  readonly autostepM: number;
  readonly autostepMinWidthM: number;
  readonly snapToGroundM: number;
  readonly maxSlopeDeg: number;
  readonly slide: boolean;
  readonly walkMps: number;
  readonly runMps: number;
  readonly sprintMps: number;
  /** Stick magnitude at or below which the character walks. */
  readonly walkStickMax: number;
  readonly hillUphillMin: number;
  readonly hillUphillSlope: number;
  readonly hillDownhillMax: number;
  readonly hillDownhillSlope: number;
  readonly jumpApexM: number;
  readonly terminalMps: number;
  readonly landTicks: number;
  readonly enterSettleTicks: number;
  readonly leaveSettleTicks: number;
  /** Ticks a request waits for the ground under its target before it gives up. */
  readonly groundWaitTicks: number;
  /** How far below a target a static collider is looked for. */
  readonly groundProbeM: number;
  readonly ragdollTicks: number;
  readonly getUpTicks: number;
}

/** config/physics.json (schema: config/schemas/physics.schema.json). */
export interface PhysicsConfig {
  readonly character: CharacterConfig;
  readonly schema: 1;
  readonly gravity: readonly [number, number, number];
  readonly solverIterations: number;
  readonly rebaseDistanceM: number;
  readonly defaultFriction: number;
  readonly defaultRestitution: number;
  readonly groups: Readonly<Record<'static' | 'dynamic' | 'character' | 'vehicle' | 'kinematic' | 'sensor', number>>;
}

export const PHYSICS_CONFIG: PhysicsConfig = physicsJson as unknown as PhysicsConfig;
