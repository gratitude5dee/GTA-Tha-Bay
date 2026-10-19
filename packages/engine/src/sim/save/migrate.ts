import type { JsonObject, SliceKind } from '@dv/shared';
import { CURRENT_SCHEMA } from './schemas.ts';

/** One pure step: slice data at schema n to schema n + 1 (C05 rule 5). */
export type MigrateStep = (data: JsonObject) => JsonObject;

export interface MigrationRegistry {
  /** The schema number this build writes, per kind. */
  current: Record<SliceKind, number>;
  /** steps[kind][n] migrates n to n + 1. */
  steps: Partial<Record<SliceKind, Record<number, MigrateStep>>>;
}

/** v1 is the first schema of every kind, so there are no steps yet. */
export const DEFAULT_MIGRATIONS: MigrationRegistry = { current: CURRENT_SCHEMA, steps: {} };

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Runs the steps from `from` up to the registry's current schema, in memory. Throws MigrationError on a missing or throwing step. */
export function migrateData(reg: MigrationRegistry, kind: SliceKind, from: number, data: JsonObject): JsonObject {
  const target = reg.current[kind];
  let cur = data;
  for (let n = from; n < target; n++) {
    const step = reg.steps[kind]?.[n];
    if (!step) throw new MigrationError(`no migration for ${kind} schema ${n} -> ${n + 1}`);
    try {
      cur = step(structuredClone(cur));
    } catch (e) {
      throw new MigrationError(`migration ${kind} ${n} -> ${n + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return cur;
}
