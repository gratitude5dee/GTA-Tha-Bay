/**
 * jobKey (C07 1.1, spec/domains/05-assets.md section 4.6): lowercase hex SHA-256 of the RFC 8785 canonical JSON of the
 * job-key input, with the input hashes lowercased and sorted. Pure and synchronous. `seed` is mandatory in `params`, so
 * a job without a pinned seed can never be keyed (a retake is a new seed and therefore a new key).
 */
import { sha256Hex } from '../hash.ts';
import { canonicalize } from '../json.ts';
import type { JobKeyInput } from './types.ts';

export function normalizeJobKeyInput(i: JobKeyInput): JobKeyInput {
  const seed = i.params['seed'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('jobKey: params.seed must be an integer in 0..4294967295');
  }
  const inputSha256 = i.inputSha256.map((h) => h.toLowerCase());
  for (const h of inputSha256) {
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`jobKey: input hash is not lowercase SHA-256 hex: ${h}`);
  }
  inputSha256.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: JobKeyInput = {
    kind: i.kind,
    endpointId: i.endpointId,
    pinnedUpdatedAt: i.pinnedUpdatedAt,
    params: i.params,
    inputSha256,
    promptTemplate: i.promptTemplate,
    promptSha256: i.promptSha256,
    recipe: i.recipe,
  };
  if (i.soulVersion !== undefined) out.soulVersion = i.soulVersion;
  if (i.tier !== undefined) out.tier = i.tier;
  return out;
}

export function jobKey(i: JobKeyInput): string {
  return sha256Hex(canonicalize(normalizeJobKeyInput(i)));
}
