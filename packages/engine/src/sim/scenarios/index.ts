import type { PhysicsScenario } from '../sim-factory.ts';
import { physicsDropScenario } from './physics-drop.ts';

export * from './physics-drop.ts';

/** Scenarios the sim worker can boot by id (`boot.config.scenario`). */
const SCENARIOS: readonly PhysicsScenario[] = [physicsDropScenario];

export function scenarioById(id: string): PhysicsScenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}
