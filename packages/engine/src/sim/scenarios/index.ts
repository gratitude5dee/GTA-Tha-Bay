import type { PhysicsScenario } from '../sim-factory.ts';
import { civicGrayboxScenario } from './civic-graybox.ts';
import { physicsDropScenario } from './physics-drop.ts';
import { walkDropScenario } from './walk-drop.ts';

export * from './civic-graybox.ts';
export * from './physics-drop.ts';
export * from './walk-drop.ts';

/** Scenarios the sim worker can boot by id (`boot.config.scenario`). */
const SCENARIOS: readonly PhysicsScenario[] = [physicsDropScenario, walkDropScenario, civicGrayboxScenario];

export function scenarioById(id: string): PhysicsScenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}
