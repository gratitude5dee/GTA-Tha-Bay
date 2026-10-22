/**
 * Cutscene cache key (A-03 v1, DL-051; spec/domains/03-story-cutscenes.md section D3): lowercase hex SHA-256 of the RFC 8785
 * canonical JSON of the normalised key input. `normalizeKeyInput` sorts `characters` by `id`, rejects duplicates, sorts and
 * lowercases `inputHashes`, requires an integer `seed` in 0..2^32-1 and rejects any property outside the eight of
 * `CutsceneKeyInput`. Licence status is never part of the key. Pure and synchronous (C02 scope).
 */
import type { CutsceneKeyInput } from '../contracts/c09-cutscene.ts';
import { sha256Hex } from '../hash.ts';
import { canonicalize } from '../json.ts';

const KEY_PROPS = ['template', 'characters', 'move', 'stage', 'style', 'endpoint', 'seed', 'inputHashes'] as const;
const CHARACTER_PROPS = ['id', 'soulVersion', 'likenessTier'] as const;
const TIERS: ReadonlySet<string> = new Set(['consented', 'parody', 'fictionalized', 'original']);
const VERSIONED = /^[^@\s]+@\d+$/;
const ENDPOINT = /^[^@\s]+@[^@\s]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function onlyProps(where: string, o: object, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new Error(`cutsceneKey: unknown property ${where}${k}`);
  }
}

/** Returns a normalised copy; throws on a bad input. */
export function normalizeKeyInput(i: CutsceneKeyInput): CutsceneKeyInput {
  if (typeof i !== 'object' || i === null || Array.isArray(i)) throw new Error('cutsceneKey: input must be an object');
  onlyProps('', i, KEY_PROPS);
  for (const k of KEY_PROPS) {
    if (!(k in i)) throw new Error(`cutsceneKey: missing property ${k}`);
  }
  if (typeof i.template !== 'string' || !VERSIONED.test(i.template)) throw new Error('cutsceneKey: template must be <name>@<n>');
  if (typeof i.style !== 'string' || !VERSIONED.test(i.style)) throw new Error('cutsceneKey: style must be <name>@<n>');
  if (typeof i.endpoint !== 'string' || !ENDPOINT.test(i.endpoint)) throw new Error('cutsceneKey: endpoint must be <endpointId>@<pinnedUpdatedAt>');
  if (i.move !== null && typeof i.move !== 'string') throw new Error('cutsceneKey: move must be a string or null');
  if (i.stage !== null && typeof i.stage !== 'string') throw new Error('cutsceneKey: stage must be a string or null');
  if (typeof i.seed !== 'number' || !Number.isInteger(i.seed) || i.seed < 0 || i.seed > 0xffffffff) {
    throw new Error('cutsceneKey: seed must be an integer in 0..4294967295');
  }
  if (!Array.isArray(i.characters)) throw new Error('cutsceneKey: characters must be an array');
  if (!Array.isArray(i.inputHashes)) throw new Error('cutsceneKey: inputHashes must be an array');

  const characters = i.characters.map((c) => {
    if (typeof c !== 'object' || c === null) throw new Error('cutsceneKey: a character must be an object');
    onlyProps('characters[].', c, CHARACTER_PROPS);
    if (typeof c.id !== 'string' || c.id === '') throw new Error('cutsceneKey: character id must be a non-empty string');
    if (typeof c.soulVersion !== 'number' || !Number.isInteger(c.soulVersion) || c.soulVersion < 0) {
      throw new Error(`cutsceneKey: soulVersion of ${c.id} must be a non-negative integer`);
    }
    if (!TIERS.has(c.likenessTier)) throw new Error(`cutsceneKey: likenessTier of ${c.id} is not a C07 tier`);
    return { id: c.id, soulVersion: c.soulVersion, likenessTier: c.likenessTier };
  });
  characters.sort((a, b) => byStr(a.id, b.id));
  for (let n = 1; n < characters.length; n++) {
    const cur = characters[n] as { id: string };
    if (cur.id === (characters[n - 1] as { id: string }).id) throw new Error(`cutsceneKey: duplicate character ${cur.id}`);
  }

  const inputHashes = i.inputHashes.map((h) => {
    if (typeof h !== 'string') throw new Error('cutsceneKey: an input hash must be a string');
    const lower = h.toLowerCase();
    if (!SHA256.test(lower)) throw new Error(`cutsceneKey: input hash is not SHA-256 hex: ${h}`);
    return lower;
  });
  inputHashes.sort(byStr);

  return { template: i.template, characters, move: i.move, stage: i.stage, style: i.style, endpoint: i.endpoint, seed: i.seed, inputHashes };
}

/** The registry id of the keyframe model (the Sunburst edit endpoint, `keyframe` role of 05-assets.md section 4.5). */
export const KEYFRAME_ENDPOINT = 'openai/gpt-image-2.5/sunburst/edit';

/**
 * `<endpointId>@<pinnedUpdatedAt>` of a registry entry, the form of the key's `endpoint` and of a template's `keyframePin`.
 * An entry nobody has reviewed yet (`pinnedUpdatedAt: null`) reads `unpinned` (BD-M05b2-01); the first `genai:repin` changes it,
 * which changes the key and forces a template bump.
 */
export function endpointPin(e: { id: string; pinnedUpdatedAt: string | null }): string {
  return `${e.id}@${e.pinnedUpdatedAt ?? 'unpinned'}`;
}

/** `sha256Hex(canonicalize(normalizeKeyInput(i)))`. */
export function cutsceneKey(i: CutsceneKeyInput): string {
  return sha256Hex(canonicalize(normalizeKeyInput(i)));
}
