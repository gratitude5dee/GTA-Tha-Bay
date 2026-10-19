import type { SaveErrorCode } from '@dv/shared';
import type { MigrationRegistry } from './migrate.ts';
import type { SaveStore } from './store.ts';

/** The steps of C05 rule 1. The fault hook runs after each one completes. */
export type WriteStep = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

/** What the helpers need from the service. */
export interface SaveCtx {
  store: SaveStore;
  deviceId: string;
  buildId: string;
  worldBake: string;
  migrations: MigrationRegistry;
  /** Wall-clock ms, strictly increasing within one service. */
  stamp(): number;
  /** Fault injection: called after step `s`; a test throws SaveKilled to model a killed tab. Null in production. */
  step: ((s: WriteStep) => void | Promise<void>) | null;
}

/** Thrown by a test fault hook. It is never caught inside the service. */
export class SaveKilled extends Error {
  constructor(readonly after: WriteStep) {
    super(`killed after step ${after}`);
    this.name = 'SaveKilled';
  }
}

export const fail = (error: SaveErrorCode, detail?: string): { ok: false; error: SaveErrorCode; detail?: string } =>
  detail === undefined ? { ok: false, error } : { ok: false, error, detail };
