import type RapierDeterministic from '@dimforge/rapier3d-deterministic-compat';
import type { PhysicsBuild } from './backend.ts';

/** The Rapier module namespace. Both `-compat` builds export the same API, so one type serves both. */
export type RapierModule = typeof RapierDeterministic;

export interface LoadBuildOptions {
  /**
   * When true, loading a second, different build in the same JavaScript realm throws. The sim worker sets it: exactly
   * one build is loaded per sim session, and switching means `SimHost.restart` (C02 determinism rule 5).
   */
  exclusive?: boolean;
}

let loadedInRealm: PhysicsBuild | null = null;

/** The build this realm has loaded through `loadRapierBuild`, if any. */
export function loadedBuild(): PhysicsBuild | null {
  return loadedInRealm;
}

/**
 * Imports one Rapier `-compat` build (the wasm is embedded as base64, so no fetch) and runs its `init()`. The import
 * paths are literal so the bundler splits each build into its own chunk and the other build is never fetched.
 */
export async function loadRapierBuild(build: PhysicsBuild, opts: LoadBuildOptions = {}): Promise<RapierModule> {
  if (opts.exclusive && loadedInRealm !== null && loadedInRealm !== build) {
    throw new Error(`Rapier ${loadedInRealm} is already loaded in this realm; ${build} needs SimHost.restart (a fresh worker)`);
  }
  const mod =
    build === 'simd-compat'
      ? await import('@dimforge/rapier3d-simd-compat')
      : await import('@dimforge/rapier3d-deterministic-compat');
  const rapier = mod.default as RapierModule;
  await rapier.init();
  loadedInRealm ??= build;
  return rapier;
}
