import physicsJson from '../../../../../config/physics.json';

/** config/physics.json (schema: config/schemas/physics.schema.json). */
export interface PhysicsConfig {
  readonly schema: 1;
  readonly gravity: readonly [number, number, number];
  readonly solverIterations: number;
  readonly rebaseDistanceM: number;
  readonly defaultFriction: number;
  readonly defaultRestitution: number;
  readonly groups: Readonly<Record<'static' | 'dynamic' | 'character' | 'vehicle' | 'kinematic' | 'sensor', number>>;
}

export const PHYSICS_CONFIG: PhysicsConfig = physicsJson as unknown as PhysicsConfig;
