import { genaiEnv, GENAI_REGISTRY } from '@dv/pipeline/core';
import { jobKey, sha256Hex, type GenJob } from '@dv/shared';
import type { Env } from '../env.ts';

const MOCK_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nMock cutscene fixture.\n';

/**
 * The job for a catalog key. Until the cutscene index and `cutscene_catalog` supply real requests (M05b2, M05d), the catalog
 * holds keys only, so this builds the mock-grade job: one 2 s shot that the mock executor replays from its fixture. It
 * names the registry's default provider; in production and live mode the gate refuses it while that provider is `pending`.
 */
export function buildCutsceneJob(key: string, env: Pick<Env, 'FAL_MODE' | 'ENVIRONMENT'>, requestedBy: string): GenJob {
  const providerKey = GENAI_REGISTRY.defaults.videoProvider;
  const provider = GENAI_REGISTRY.videoProviders[providerKey];
  if (provider === undefined) throw new Error(`registry has no provider ${providerKey}`);
  // The mock prompt passes the real prompt lint (M05b2): it carries the "no text, no logos" clause.
  const prompt = `Mock cutscene ${key.slice(0, 8)}: a two second test pattern. No text, no logos.`;
  const params: Record<string, unknown> = {
    cutsceneKey: key,
    seed: parseInt(key.slice(0, 8), 16),
    preset: 'toon-pbr',
    prompt,
    shots: [{ shotId: 's1', durationS: 2, prompt }],
    characters: [],
    subs: { en: MOCK_VTT },
  };
  const promptSha256 = sha256Hex(prompt);
  return {
    schema: 'genjob/1',
    jobKey: jobKey({ kind: 'cutscene_shot', endpointId: provider.endpoints.i2v ?? providerKey, pinnedUpdatedAt: null, params, inputSha256: [], promptTemplate: 'mock@1', promptSha256, recipe: 'cut@1' }),
    kind: 'cutscene_shot',
    endpointKey: providerKey,
    env: genaiEnv(env),
    subject: { assetRef: `cutscene/cut-${key.slice(0, 16)}` },
    params,
    inputs: [],
    promptTemplate: 'mock@1',
    promptSha256,
    budgetUsdMicros: 1_000_000,
    requestedBy,
  };
}
