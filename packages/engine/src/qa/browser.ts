/**
 * Worker-side entry of the determinism page's `?run=` mode (M04d). QA builds only. The page puts the `RunSpec`, the fixture pack
 * bytes (from a Vite `?url` import of the committed file, never from the asset catalog) and `hashes.json` into the boot config;
 * this verifies the bytes and runs the spec on sims the runner builds itself.
 */
import type { RetryEnv } from '../sim/physics/rapier-backend.ts';
import { createCanonicalRunner, type RunSpec, type StateHashTrace } from './runner.ts';
import { verifyFixturePack } from './scenarios.ts';

export async function runQaSpec(config: Readonly<Record<string, unknown>>, retry: Partial<RetryEnv>): Promise<StateHashTrace> {
  const spec = config['run'] as RunSpec | undefined;
  if (!spec) throw new Error('qa-run: boot.config.run is missing');
  const packs: Record<string, Uint8Array> = {};
  const raw = config['packs'] as Record<string, unknown> | undefined;
  const hashes = (config['hashes'] ?? {}) as Record<string, string>;
  const p0 = raw?.['p0'];
  if (p0 instanceof ArrayBuffer || p0 instanceof Uint8Array) {
    const bytes = p0 instanceof Uint8Array ? p0 : new Uint8Array(p0);
    verifyFixturePack('p0-64-64.pack', bytes, hashes);
    packs['p0'] = bytes;
  }
  // other packs (a mode's own fixture, for example the racing corridor) are handed to the loader as they are
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k !== 'p0' && (v instanceof ArrayBuffer || v instanceof Uint8Array)) packs[k] = v instanceof Uint8Array ? v : new Uint8Array(v);
  }
  const build = typeof config['build'] === 'string' ? config['build'] : 'local';
  return createCanonicalRunner({ packs, retry, build, processEnv: {} }).run(spec);
}
