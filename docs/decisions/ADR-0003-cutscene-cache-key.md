# ADR-0003 — Cutscene cache key

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-03 (amended by DL-051); contract C09

## Context
A cutscene must be generated at most once per distinct input (R-CUT-01, R-ENG-03). The key must change when anything that alters the picture changes, and must not change when something merely labels it. Vendor-side `updated_at` values change without notice; licence status changes by legal events; both must not silently invalidate shipped clips [research/gap-video-model-licence-clearance.md §7].

## Options considered
1. **Hash of the prompt text.** Misses soul versions, tiers, endpoint, seed and input images.
2. **Include the vendor's live `updatedAt`.** A vendor-side change would orphan every shipped clip (the original A-03 wording; fixed by DL-051).
3. **Include licence status.** A revocation could not delist a key without regenerating others; research recommends keeping licence in the manifest instead.
4. **Client-side key from raw inputs.** Input hashes are build artifacts (sheet crops, stage plates), so the client cannot compute them.
5. **Eight-property canonical hash, computed at release time in CI** (chosen).

## Decision
`key = sha256Hex(canonicalize(normalizeKeyInput(i)))` (RFC 8785, `packages/shared/src/json.ts` and `hash.ts`; pure and synchronous, DL-073) over exactly these properties:

```ts
interface CutsceneKeyInput {
  template: `${string}@${number}`;
  characters: { id: string; soulVersion: number; likenessTier: LikenessTier }[]; // sorted by id
  move: string | null; stage: string | null;
  style: `${string}@${number}`;
  endpoint: `${string}@${string}`;  // endpointId@pinnedUpdatedAt from config/genai-endpoints.json
  seed: number;                     // u32
  inputHashes: string[];            // sorted lowercase SHA-256, never URLs
}
```

- `pinnedUpdatedAt` changes only through the reviewed `genai:repin` PR.
- `likenessTier` is the C10 `assetTier()` value (`original` for invented characters, DL-083).
- Duration, shot count, aspect, resolution and `prompt_expansion_mode: disabled` are template frontmatter, so changing one bumps the template version and the key. The template also records `keyframePin`; CI fails if it differs from the registry.
- Story beat text is locked by `beats.lock.json`; a change without a `rev` bump fails `missions:build`.
- `seed` is `content/cutscenes/seeds.json[refId]` when a reviewed retake is pinned, else the first 8 hex digits of `sha256Hex(refId)`. A retake is a new seed and a new key.
- **Licence status is never in the key.** It lives in the manifest `licence` block (ADR-GENAI-01).
- **Single flight.** `CutsceneJobDO.idFromName(key)` is the lock; readiness is `HEAD cutscenes/<key>/manifest.json`, written last.
- **Index carry-over.** The release-time `cutscene-index` maps `CutsceneRef → key`; if the desired key is not ready, the previous release's key is kept (`stale: true`) while the characters, `soulVersion`, tier, kill state and provider remain valid.
- Seven test vectors are mandatory (reordering, `soulVersion` +1, tier change, re-pin, new seed, rejected extra property).

## Consequences
- (+) Zero duplicate generation; a re-pin or provider switch makes new keys and never overwrites old clips.
- (+) Licence revocation delists a provider's keys without touching others.
- (−) Keys exist only after a release build computes them, so the runtime needs the shipped index.
- (−) Any template edit regenerates that template's clips; the $40 cutscene line (ADR-0015) makes such edits costly, so templates freeze early.

## Affected contracts and milestones
C09 (`cutsceneKey`, `CutsceneIndex`, manifest), C07 (`AssetRef`, provenance), C12 (route 27). M05b1 (`CutsceneJobDO`), M05b2 (key, index), M05c2–M05c3 (prewarm), M08b2 (fighter hooks), M10b (kill drill).

## Links
`spec/domains/03-story-cutscenes.md` §D3; `05-assets-pipeline.md` §6; `spec/11-decision-log.md` DL-051, DL-073, DL-083; ADR-GENAI-01, ADR-0022.
