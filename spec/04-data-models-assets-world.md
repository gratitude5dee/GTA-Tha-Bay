# 04 — Data models, part 4: C07 assets and provenance, C08 world

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/05-assets.md` §4, `05-assets-pipeline.md` §14 (S05) and `spec/domains/02-world-contracts.md` §2–§5 (S02). The owner specs stay normative. The asset-manifest JSON Schema below is new integration text derived from the C07 TypeScript; where they differ, the TypeScript wins and the schema is fixed.

## C07 — `AssetManifest`, addressing, provenance, genAI jobs

| Field | Value |
|---|---|
| Owner · version | S05 · `C07_VERSION = '1.1.0'` |
| Source paths | `packages/shared/src/assets/c07.ts`, `assets/provenance.ts`, `assets/fidelity.ts` (build-side helper, not C07), `genai/types.ts`, `genai/registry.ts`, `rig/bay_rig_v1.json`; pure gate cores `assets/gates/` |
| Defined in | `05-assets.md` §4.1–§4.7; `05-assets-pipeline.md` §14 (1.1) |
| Created in | M00b (types, provenance schema, registry, gates); M01d (catalog, publish, `check:assets`) |
| Consumers | S02, S03, S04, S06, S07, S09, S10, S11, S12; milestones M00b, M00c, M01d, M01e, M02a1 (world packs), M03a1 (vehicle extras), M04b2 (creator kit), M05b1, M06a2, M10a family, M13a1 (mod `AssetSource`) |

Addressing (`05-assets.md` §4.1): `AssetRef = '<kind>/<id>'`; object keys `<root>/<variant>.<sha256[0:12]>.<ext>`, immutable, identity-encoded (F-019); roots `characters/<slug>/<part>/`, `rig/bay_rig_v1`, `cutscenes/<key>/`, `audio/barks/<sha256>.opus`, `assets/<kind>/<id>/`. Variant resolution: `default` if present, else the first id of C13 `VARIANT_FALLBACK[tier]` that exists; it never steps upward.

```ts
export const C07_VERSION = '1.1.0' as const;            // bump with 06; additive = minor; 1.1 additions: 05-assets-pipeline.md §14

export type AssetKind =
  | 'character' | 'character_sheet' | 'rig' | 'anim' | 'portrait' | 'mouth_atlas'
  | 'vehicle' | 'prop' | 'building' | 'terrain' | 'texture' | 'ui' | 'font'
  | 'audio_music' | 'audio_sfx' | 'audio_bark' | 'voice' | 'cutscene'
  | 'map_data' | 'world_pack' | 'data';
export type AssetId = string;                            // /^[a-z0-9][a-z0-9._-]{1,62}$/
export type AssetRef = `${AssetKind}/${AssetId}`;
import type { QualityTierId } from '../platform/c13';   // C13 v1.1.0 (S11): desktop-ultra | desktop | mobile | mobile-low | xr-quest | xr-visionpro
export type VariantId = QualityTierId | 'default';

export type Origin = 'generated' | 'authored' | 'licensed' | 'open_data' | 'derived';
export type LikenessTier = 'consented' | 'parody' | 'fictionalized' | 'original';
export type VoiceMode = 'none' | 'synthetic' | 'designed' | 'consented_clone' | 'licensed';

export interface VariantStats { tris?: number; verts?: number; bones?: number; materials?: number; primitives?: number;
  texMaxPx?: number; texGpuBytes?: number; durationS?: number; lufs?: number; truePeakDb?: number; fps?: number }

export interface AssetVariant {
  key: string;                         // object key in MEDIA; URL = `${MEDIA_ORIGIN}/${key}` (origin from config, never stored)
  sha256: string;                      // lowercase hex of stored bytes; equals ProvenanceRecord.sha256
  bytes: number;                       // ≤ 25 MiB (D-17); world_pack ≤ 4 MiB
  contentType: string;                 // model/gltf-binary | image/ktx2 | audio/ogg … (table §4.4)
  encoding: 'identity';
  codec?: { mesh?: 'meshopt' | 'none'; tex?: 'ktx2-uastc' | 'ktx2-etc1s' | 'webp' | 'png'; audio?: 'opus' | 'aac' };
  stats?: VariantStats;
}

export interface ProvenanceSummary {   // copy of the ROOT record's headline fields (full record: §4.3)
  root: string;                        // sha256 of the root ProvenanceRecord
  origin: Origin; license: string; attribution?: string;
  aiGenerated: boolean; vendor?: string; endpoint?: string; requestId?: string; promptSha256?: string;
}

export interface LikenessSummary {
  tier: LikenessTier;
  subjectId: string | null;            // opaque 'subj_…'; real-side strings never leave the server (NameRegistry)
  soulVersion?: number;
  faceReferenceUsed: boolean;          // tier !== 'consented' ⇒ false
  voiceMode: VoiceMode;                // tier !== 'consented' ⇒ none | synthetic | designed
  consentRecordId?: string;            // required when tier === 'consented'
  photoreal: boolean;                  // tier !== 'consented' ⇒ false (style preset toon-pbr only)
  standIn?: AssetRef;                  // required when tier !== 'original'; must resolve to an 'original' asset
  disclaimer: 'courtesy' | 'parody' | 'fictional' | 'none';
}

export type KindExtras =
  | { t: 'character'; npcId: string; rigFamily: 'bay_rig_v1'; heightM: number; bones: { jaw: boolean; fingers: boolean };
      animSets: AssetRef[]; portrait?: AssetRef; mouthAtlas?: AssetRef; mouthAnchor?: [number, number, number] }
  | { t: 'vehicle'; class: 'traffic' | 'race' | 'police' | 'hero'; fictionalMake: string; wheelRadiusM: number;
      nodes: { body: string; wheels: [string, string, string, string]; steer?: string[]; lights?: string[]; collider?: string } }
  | { t: 'audio'; durationS: number; lufs: number; truePeakDb: number; sampleRate: 48000; loop?: { startS: number; endS: number }; cues?: AssetRef }
  | { t: 'voice'; vendor: string; voiceId: string; endpointKey: string; mode: VoiceMode; designPromptSha256?: string };

export interface AssetManifest {       // one asset; 06 sketch {id, kind, variants, provenance, deps}
  schema: 'asset/1';
  id: AssetId; kind: AssetKind;
  rev: number;                         // +1 whenever any variant byte changes
  variants: Partial<Record<VariantId, AssetVariant>>;
  deps: AssetRef[];                    // loaded together; acyclic (CI)
  provenance: ProvenanceSummary;
  likeness?: LikenessSummary;          // REQUIRED for character, character_sheet, rig, anim, portrait, mouth_atlas, voice, audio_bark, cutscene
  status: 'active' | 'quarantined' | 'killed';   // catalogs omit non-active
  visibility: 'public' | 'private';    // private entries never appear in the public catalog
  tags: string[];                      // 'char:<npcId>' on every character-derived asset (purge index)
  extras?: KindExtras;
}

export interface AssetCatalog {        // immutable, content-addressed: manifests/assets-<sha256>.json
  schema: 'asset-catalog/1'; c07: typeof C07_VERSION; buildId: string; gitSha: string; createdAt: number /* epoch ms */;
  entries: Record<AssetRef, AssetManifest>;
}
export interface CatalogPointer {      // built into the Worker's static assets: /asset-catalog.json
  schema: 'asset-catalog-pointer/1'; sha256: string; key: string; bytes: number;
}

export declare function assetRefOf(kind: AssetKind, id: AssetId): AssetRef;
export declare function objectKey(kind: AssetKind, id: AssetId, variant: VariantId, sha256: string, ext: string): string;
export declare function resolveVariant(m: AssetManifest, tier: QualityTierId): AssetVariant;  // default, else C13 VARIANT_FALLBACK[tier]; throws NO_VARIANT
```

Provenance record (`provenance/1.0`, snake_case on disk, one per stored file at `assets/provenance/<sha256[0:2]>/<sha256>.json`, timestamps ISO-8601 `Z` per DL-059):

```ts
export interface ProvenanceRecord {
  schema: 'provenance/1.0';
  sha256: string; paths: string[];                       // repo or catalog paths that resolve to these bytes
  kind: AssetKind; origin: Origin;
  license: string;                                       // SPDX or LicenseRef-*; allowlist in config/license-allowlist.json
  attribution?: string; authors: string[];               // 'profile:…' | 'studio:…'
  source?: { url: string | null; dataset_id: string | null; retrieved: string };      // licensed / open_data
  generator?: {                                          // REQUIRED when origin is 'generated'
    vendor: 'fal' | 'elevenlabs' | 'minimax' | 'openai' | 'workers_ai' | 'anthropic' | 'local';
    endpoint: string; endpoint_registry_key: string; endpoint_updated_at: string | null; model_version?: string;
    request_id: string; seed?: number; job_key: string; params_sha256: string;
    prompt_template: string; prompt_sha256: string; negative_prompt_sha256?: string; expanded_prompt_sha256?: string;
    input_refs: string[];                                // 'sha256:<hex>' of every input file, never URLs
    plan?: string;                                       // vendor plan tier when terms depend on it (music)
    terms_snapshot: { path: string; sha256: string; checked_at: string };
    licence_gate?: { gate: 'ADR-GENAI-01'; status: 'cleared' | 'pending' | 'blocked'; evidence?: string };
    cost_usd_micros?: number; generated_at: string;
    executor: 'workflow' | 'cli' | 'mock'; env: 'production' | 'previs' | 'test';
  };
  derived_from: string[];                                // parent sha256s (retopo, LODs, KTX2, transcodes)
  tool?: { name: string; version: string; args_sha256: string };                       // for origin 'derived'
  likeness?: { subject_id: string | null; tier: LikenessTier; face_reference_used: boolean; voice_mode: VoiceMode;
               consent_record_id?: string; consent_scopes_used?: string[]; photoreal: boolean };
  review: { gate: string; by: string; at: string; decision: 'approve' | 'reject'; note?: string }[];
  ip_checks: { signatures: 'pass' | 'n/a'; strings: 'pass' | 'n/a'; similarity: 'pass' | 'n/a'; vision?: 'pass' | 'review' };
  ai_generated: boolean; c2pa?: 'valid' | 'valid-untrusted' | 'absent' | 'invalid' | 'resigned';
  status: 'active' | 'quarantined' | 'killed'; created_at: string; // all ProvenanceRecord timestamps: ISO-8601 UTC 'Z' (06 §4.3 exception, DL-059)
}
```

**Runtime JSON Schema — provenance** (`packages/shared/schemas/provenance-1.0.schema.json`; the owner shows the conditionals with the field list elided; M00b writes every field of the interface, the seven `allOf` conditionals and `additionalProperties: false`):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"provenance-1.0","type":"object","additionalProperties":false,
 "required":["schema","sha256","paths","kind","origin","license","authors","derived_from","review","ip_checks","ai_generated","status","created_at"],
 "properties":{"schema":{"const":"provenance/1.0"},"sha256":{"pattern":"^[0-9a-f]{64}$"},"status":{"enum":["active","quarantined","killed"]}},
 "allOf":[
  {"if":{"properties":{"origin":{"const":"generated"}}},"then":{"required":["generator"],"properties":{"ai_generated":{"const":true}}}},
  {"if":{"properties":{"origin":{"const":"licensed"}}},"then":{"required":["source"]}},
  {"if":{"properties":{"origin":{"const":"open_data"}}},"then":{"required":["source","attribution"]}},
  {"if":{"properties":{"origin":{"const":"derived"}}},"then":{"required":["tool"],"properties":{"derived_from":{"minItems":1}}}},
  {"if":{"properties":{"kind":{"enum":["character","character_sheet","rig","anim","portrait","mouth_atlas","voice","audio_bark","cutscene"]}}},"then":{"required":["likeness"]}},
  {"if":{"required":["likeness"],"properties":{"likeness":{"properties":{"tier":{"enum":["parody","fictionalized","original"]}}}}},
   "then":{"properties":{"likeness":{"properties":{"face_reference_used":{"const":false},"photoreal":{"const":false},"voice_mode":{"enum":["none","synthetic","designed"]}}}}}},
  {"if":{"required":["likeness"],"properties":{"likeness":{"properties":{"tier":{"const":"consented"}}}}},"then":{"properties":{"likeness":{"required":["consent_record_id"]}}}}]}
```

Lock file `assets/assets.lock.json`: `{schema:'asset-lock/1', entries:{[ref]:{rev, variants:{[id]:sha256}, root, approved_by, approved_at}}}` (`05-assets.md` §4.3).

Registry (`config/genai-endpoints.json`, schema `packages/shared/schemas/genai-endpoints-1.schema.json`; endpoint ids and prices: `05-assets.md` §4.5 with F-034, F-044…F-046 [research/genai-pipeline-fal.md]):

```ts
export interface EndpointEntry {
  id: string;                                   // exact vendor id, e.g. 'meshy/v7.1/multi-image-to-3d'
  vendor: 'fal' | 'workers_ai' | 'elevenlabs' | 'anthropic' | 'local';
  role: 'style_bible' | 'sheet' | 'sheet_lean' | 'keyframe' | 'portrait' | 'mesh' | 'mesh_alt' | 'rig'
      | 'tts_draft' | 'tts_final' | 'tts_hero' | 'voice_design' | 'voice_clone' | 'sfx' | 'vision_qa';
  status: 'active' | 'pending' | 'blocked';     // blocked ⇒ callable only with env 'previs'
  price: { usd: number; per: 'image' | 'gen' | 'second' | 'clip' | '1k_chars' | 'voice'; note?: string; checkedAt: string };
  pinnedUpdatedAt: string | null;               // registry updated_at at last review; enters job keys
  licenseType: 'commercial';                    // liveness fails on any other value
  tiers: LikenessTier[];                        // tiers allowed to call it
  acceptsFaceRefs: boolean;                     // true only on consented paths
  termsSnapshot: string;                        // docs/legal/vendor-terms/<vendor>-<date>.md
}
export interface GenAiRegistry {
  schema: 'genai-endpoints/1'; checkedAt: string;
  endpoints: Record<string, EndpointEntry>;
  videoProviders: Record<string, VideoProviderEntry>;   // shape and assertCallable: research/gap-video-model-licence-clearance.md §8
  banned: { id: string; match: 'exact' | 'prefix'; reason: string }[];
  defaults: { videoProvider: string; videoFallbackOrder: string[] };
}
```

Job, gate and key types (`packages/shared/src/genai/types.ts`; money in integer USD micros):

```ts
export type GenKind = 'style_bible' | 'sheet' | 'portrait' | 'mouth_atlas' | 'mesh' | 'rig' | 'voice_design' | 'tts'
  | 'keyframe' | 'cutscene_shot' | 'texture' | 'sfx';       // local-only steps (crops, retarget, optimize) are tools/assets commands
export interface InputFile { role: string; sha256: string;
  origin: 'first_party_generated' | 'first_party_authored' | 'consented_photo' | 'user_upload'; realHumanVisible: boolean }
export interface GenJob {
  schema: 'genjob/1'; jobKey: string; kind: GenKind; endpointKey: string;
  env: 'production' | 'previs' | 'test';
  subject: { assetRef: AssetRef; npcId?: string; soulVersion?: number };   // NO tier field (decision 4)
  params: Record<string, unknown>;       // vendor parameters; file inputs referenced by InputFile.sha256, presigned at submit
  inputs: InputFile[]; promptTemplate: `${string}@${number}`; promptSha256: string;
  budgetUsdMicros: number; runId?: string; requestedBy: string;   // integer USD micros, the unit of S09's ledger
}
export interface JobKeyInput { kind: GenKind; endpointId: string; pinnedUpdatedAt: string | null; params: Record<string, unknown>;
  inputSha256: string[]; promptTemplate: string; promptSha256: string; soulVersion?: number; tier?: LikenessTier; recipe: string }
export declare function jobKey(i: JobKeyInput): string;   // hex sha256 of RFC 8785 canonical JSON; inputs sorted; seed mandatory in params
export type GateCode = 'TIER_UNKNOWN' | 'KILLED' | 'FACE_REF_FORBIDDEN' | 'CLONE_FORBIDDEN' | 'NAME_IN_PROMPT'
  | 'PHOTOREAL_FORBIDDEN' | 'CONSENT_EXPIRED' | 'ENDPOINT_BANNED' | 'ENDPOINT_NOT_CLEARED' | 'KILL_SWITCH' | 'BUDGET' | 'MINOR_SUSPECTED' | 'POLICY_REFUSED';
export type GateVerdict = { ok: true } | { ok: false; code: GateCode; detail: string };
export declare function assertStageAllowed(job: GenJob, stage: string, ports: GenPorts): Promise<GateVerdict>;
```

**C07 1.1 delta** (DL-099, DL-161):

```ts
// KindExtras 'vehicle' — nodes gains optional anchors (S06 CCP-4)
nodes: { body: string; wheels: [string, string, string, string]; steer?: string[]; lights?: string[]; collider?: string;
         cockpit?: string; steeringWheel?: string; anchors?: { driver?: string; hood?: string };
         exhaust?: string[]; thrusters?: string[]; sirens?: string[] }   // plus optional vertex attribute _dent (shader damage, no extra render object)
// InputFile.role (GenJob inputs) accepts 'plate' with InputFile.origin 'first_party_generated' (S03 stage plates); generator.input_refs may cite it.
// The plate's own ProvenanceRecord uses origin 'derived' (tool 'assets:plates', derived_from = the world_pack sha256s rendered), DL-161
// vision_qa schema adds weapon_present: boolean and photoreal: boolean; for cutscene clips (S03 §D8) weapon_present, photoreal or any gore value other than 'none' fails the clip
```

1.1 notes from the owner section: `world_pack` and `map_data` assets carry one `origin: 'derived'` record whose `derived_from` lists the C08 `SourceStamp` hashes, each stamp an `open_data` record; `world_pack` ships variant `default` only; `likeness.tier` of character assets is C10 `assetTier(soul)`; creator-kit assets `character/pc-<slot>-<id>`, `portrait/pc-<slot>-<id>`, `ui/menu-backdrop`; mod files never enter the catalog and resolve as `<kind>/mod.<sha256[0:12]>` through the C13 1.1 `AssetSource` hook. `ODbL-1.0` and `PDDL-1.0` SPDX strings are UNVERIFIED (`spec/99-open-questions.md` §3, S02 register).

Programme money cap (DL-OWN-01, DL-171): `config/guardrails.yaml` `genai.programCapUsdMicros` = 100,000,000 (USD 100 total for fal and any other production genAI), mirrored to the `budget_program` row of migration 0002.

**Runtime JSON Schema — asset manifest** (`packages/shared/schemas/asset-1.schema.json`, draft 2020-12, validated by `check:assets` on every catalog entry from M01d; kind-specific `extras` members and the cross-entry rules (`rev` monotonic, `deps` exist and are acyclic, every `sha256` has a provenance record, every tier resolves) are code checks in `check:assets`):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"asset-1","type":"object","additionalProperties":false,
 "required":["schema","id","kind","rev","variants","deps","provenance","status","visibility","tags"],
 "properties":{
  "schema":{"const":"asset/1"},"id":{"$ref":"#/$defs/assetId"},"kind":{"$ref":"#/$defs/kind"},
  "rev":{"type":"integer","minimum":0},
  "variants":{"type":"object","minProperties":1,"additionalProperties":false,"properties":{
    "default":{"$ref":"#/$defs/variant"},"desktop-ultra":{"$ref":"#/$defs/variant"},"desktop":{"$ref":"#/$defs/variant"},
    "mobile":{"$ref":"#/$defs/variant"},"mobile-low":{"$ref":"#/$defs/variant"},"xr-quest":{"$ref":"#/$defs/variant"},"xr-visionpro":{"$ref":"#/$defs/variant"}}},
  "deps":{"type":"array","uniqueItems":true,"items":{"$ref":"#/$defs/assetRef"}},
  "provenance":{"type":"object","additionalProperties":false,"required":["root","origin","license","aiGenerated"],"properties":{
    "root":{"$ref":"#/$defs/sha256"},"origin":{"enum":["generated","authored","licensed","open_data","derived"]},"license":{"type":"string","minLength":1},
    "attribution":{"type":"string"},"aiGenerated":{"type":"boolean"},"vendor":{"type":"string"},"endpoint":{"type":"string"},
    "requestId":{"type":"string"},"promptSha256":{"$ref":"#/$defs/sha256"}}},
  "likeness":{"type":"object","additionalProperties":false,"required":["tier","subjectId","faceReferenceUsed","voiceMode","photoreal","disclaimer"],"properties":{
    "tier":{"enum":["consented","parody","fictionalized","original"]},"subjectId":{"type":["string","null"],"pattern":"^subj_"},
    "soulVersion":{"type":"integer","minimum":1},"faceReferenceUsed":{"type":"boolean"},
    "voiceMode":{"enum":["none","synthetic","designed","consented_clone","licensed"]},"consentRecordId":{"type":"string"},
    "photoreal":{"type":"boolean"},"standIn":{"$ref":"#/$defs/assetRef"},"disclaimer":{"enum":["courtesy","parody","fictional","none"]}}},
  "status":{"enum":["active","quarantined","killed"]},"visibility":{"enum":["public","private"]},
  "tags":{"type":"array","uniqueItems":true,"items":{"type":"string","minLength":1}},
  "extras":{"type":"object","required":["t"],"properties":{"t":{"enum":["character","vehicle","audio","voice"]}}}},
 "allOf":[
  {"if":{"properties":{"kind":{"enum":["character","character_sheet","rig","anim","portrait","mouth_atlas","voice","audio_bark","cutscene"]}}},"then":{"required":["likeness"]}},
  {"if":{"required":["likeness"],"properties":{"likeness":{"properties":{"tier":{"enum":["parody","fictionalized","original"]}}}}},
   "then":{"properties":{"likeness":{"properties":{"faceReferenceUsed":{"const":false},"photoreal":{"const":false},"voiceMode":{"enum":["none","synthetic","designed"]}}}}}},
  {"if":{"required":["likeness"],"properties":{"likeness":{"properties":{"tier":{"const":"consented"}}}}},"then":{"properties":{"likeness":{"required":["consentRecordId"]}}}},
  {"if":{"required":["likeness"],"properties":{"likeness":{"properties":{"tier":{"enum":["consented","parody","fictionalized"]}}}}},"then":{"properties":{"likeness":{"required":["standIn"]}}}},
  {"if":{"properties":{"kind":{"const":"world_pack"}}},"then":{"properties":{"variants":{"required":["default"],"maxProperties":1,
    "properties":{"default":{"properties":{"bytes":{"maximum":4194304}}}}}}}}],
 "$defs":{
  "kind":{"enum":["character","character_sheet","rig","anim","portrait","mouth_atlas","vehicle","prop","building","terrain","texture","ui","font",
    "audio_music","audio_sfx","audio_bark","voice","cutscene","map_data","world_pack","data"]},
  "assetId":{"type":"string","pattern":"^[a-z0-9][a-z0-9._-]{1,62}$"},
  "assetRef":{"type":"string","pattern":"^(character|character_sheet|rig|anim|portrait|mouth_atlas|vehicle|prop|building|terrain|texture|ui|font|audio_music|audio_sfx|audio_bark|voice|cutscene|map_data|world_pack|data)/[a-z0-9][a-z0-9._-]{1,62}$"},
  "sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
  "variant":{"type":"object","additionalProperties":false,"required":["key","sha256","bytes","contentType","encoding"],"properties":{
    "key":{"type":"string","minLength":1},"sha256":{"$ref":"#/$defs/sha256"},"bytes":{"type":"integer","minimum":1,"maximum":26214400},
    "contentType":{"type":"string","minLength":1},"encoding":{"const":"identity"},
    "codec":{"type":"object","additionalProperties":false,"properties":{"mesh":{"enum":["meshopt","none"]},
      "tex":{"enum":["ktx2-uastc","ktx2-etc1s","webp","png"]},"audio":{"enum":["opus","aac"]}}},
    "stats":{"type":"object","additionalProperties":{"type":"number","minimum":-1000}}}}}}
```
`stats.lufs` and `truePeakDb` are negative, hence the loose numeric bound; the 25 MiB per-file ceiling is D-17, the 4 MiB pack ceiling C08 rule 4.

## C08 — `WorldChunk`, `RoadGraph`, spawn tables, world services

| Field | Value |
|---|---|
| Owner · version | S02 · `C08_VERSION = '1.0.0'`; pack format `DVWP` version 1 |
| Source paths | `packages/shared/src/world/c08.ts`, `world/c08-api.ts`, `world/pack-codec.ts` (pure `decodeP0`, `toStaticShapeSet`, `chunkKeyOf`); `config/world.bounds.json` |
| Defined in | `02-world-contracts.md` §1 (rules 1–20), §2, §3, §4 (binary layout), §5, §7 (versioning) |
| Created in | M01f (graybox fixture, codec); M02a1 (bake core) |
| Consumers | S01, S03, S04, S06, S07, S09, S10, S11, S12; milestones M01f, M02a1, M02a2, M02b1, M02c1, M02c2, M02d1, M03b1, M03b2, M03c, M05a1, M06a2, M07b1, M12b (pose validation), M13b2 (anchor mask) |

Frame (rule 1): ENU metres from San Francisco City Hall (37.7793 N, −122.4193 W), +X east, +Y up, −Z north; 110,992.06 m per degree latitude, 88,083.39 m per degree longitude [research/repos-world.md §1.1]. Grid (rule 2): quadtree over `[−65,664, +65,408)` m, levels z 9/7/5/3 (256 m, 1,024 m, 4,096 m, 16,384 m); City Hall is the centre of chunk `9/256/256`.

```ts
// packages/shared/src/world/c08.ts — C08 v1.0.0 (S02). Types, constants and pure functions only (C02 lint applies).
import type { AssetRef } from '../assets/c07';
import type { QualityTierId } from '../platform/c13';

export const C08_VERSION = '1.0.0' as const;

// ---- 1. Frame and grid ------------------------------------------------------------------
export const ORIGIN = { lat: 37.7793, lng: -122.4193 } as const;     // SF City Hall = ENU (0,0,0)
export const M_PER_DEG_LAT = 110992.06, M_PER_DEG_LNG = 88083.39;   // [research/repos-world.md §1.1]
export const enuFromLatLng = (lat: number, lng: number) =>
  ({ x: (lng - ORIGIN.lng) * M_PER_DEG_LNG, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT });
export const latLngFromEnu = (x: number, z: number) =>
  ({ lat: ORIGIN.lat - z / M_PER_DEG_LAT, lng: ORIGIN.lng + x / M_PER_DEG_LNG });

export const GRID_MIN_M = -65664;            // NW corner of the root square, both axes (City Hall is the centre of chunk 9/256/256)
export const GRID_EDGE_M = 131072;           // root square edge = 2^17 m
export type ChunkZ = 9 | 7 | 5 | 3;         // 256 m chunk · 1,024 m tile · 4,096 m block · 16,384 m region
export const CHUNK_EDGE_M = { 9: 256, 7: 1024, 5: 4096, 3: 16384 } as const;
export const TERRAIN_POSTS = 65 as const;    // every level: 64 cells, shared edge posts → cell 4 / 16 / 64 / 256 m
export type ChunkKey = `${ChunkZ}/${number}/${number}`;   // "z/x/y", x east, y south; no ':' (ambient cell keys, C01)
export interface ChunkBounds { minX: number; minZ: number; maxX: number; maxZ: number }
export type PackFamily = 'p0' | 'l0' | 'l1' | 'l2';       // sim data z9 · render z9 · render z7 · render z5

export function chunkKeyAt(z: ChunkZ, x: number, zEnu: number): ChunkKey {
  const e = CHUNK_EDGE_M[z];
  return `${z}/${Math.floor((x - GRID_MIN_M) / e)}/${Math.floor((zEnu - GRID_MIN_M) / e)}`;
}
/** Pure: the z=9 chunk key of an authored or anchor position (C17 anchors, route 37, CLI and server anchor checks; DL-079). */
export const chunkKeyOf = (lat: number, lng: number): ChunkKey => { const p = enuFromLatLng(lat, lng); return chunkKeyAt(9, p.x, p.z); };
export function parseChunkKey(k: string): { z: ChunkZ; x: number; y: number } | null {
  const m = /^(9|7|5|3)\/(\d{1,3})\/(\d{1,3})$/.exec(k);
  return m ? { z: Number(m[1]) as ChunkZ, x: Number(m[2]), y: Number(m[3]) } : null;
}
export function chunkBounds(k: ChunkKey): ChunkBounds {
  const p = parseChunkKey(k)!, e = CHUNK_EDGE_M[p.z];
  return { minX: GRID_MIN_M + p.x * e, minZ: GRID_MIN_M + p.y * e, maxX: GRID_MIN_M + (p.x + 1) * e, maxZ: GRID_MIN_M + (p.y + 1) * e };
}
export function ancestorKey(k: ChunkKey, z: ChunkZ): ChunkKey {          // z must be coarser than k
  const p = parseChunkKey(k)!, f = 2 ** (p.z - z);
  return `${z}/${Math.floor(p.x / f)}/${Math.floor(p.y / f)}`;
}
/** Pack AssetRef for a chunk: p0/l0 live under the z7 tile of a z9 chunk, l1 under the z5 block of a z7 chunk, l2 under the z3 region of a z5 chunk. */
export function packRefOf(k: ChunkKey, family: PackFamily): AssetRef {
  const host = family === 'l1' ? 5 : family === 'l2' ? 3 : 7;
  const a = parseChunkKey(ancestorKey(k, host as ChunkZ))!;
  return `world_pack/${family}-${a.x}-${a.y}` as AssetRef;               // AssetId ^[a-z0-9][a-z0-9._-]{1,62}$
}

// ---- 2. Static collision and terrain ------------------------------------------------------
export interface HeightGrid {                  // 65 × 65 posts; row-major, z outer; metres × 10; identical in every tier variant
  originX: number; originZ: number; cellM: number; dm: Int16Array;
}
/** Packed prisms for C01 StaticShapeSet.prisms: repeat [nVerts, baseY, heightM, x0, z0, … x(n-1), z(n-1)] (Float32, ENU m, CCW). */
export type PrismPack = Float32Array;

// ---- 3. Road graph ---------------------------------------------------------------------
export type EdgeId = number; export type NodeId = number; export type SegId = number;   // u32, global per bake
export const enum RoadClass { Freeway = 0, Ramp = 1, Arterial = 2, Collector = 3, Local = 4, Service = 5 }
export const enum EdgeFlag { OneWay = 1, Bridge = 2, Tunnel = 4, Divided = 8, NoParking = 16, Hill = 32, TramEmbedded = 64, BusLane = 128 }
export interface RoadSegment {                 // geometry shared by the two directed edges of a street
  id: SegId; pts: Float32Array;                // x,y,z triples (ENU), centreline, ≤ 20 m spacing
  lengthM: number; widthM: number;             // carriageway incl. parking lanes
  osmWay: number; cnn: number;                 // provenance for authoring tools (cnn 0 = unmatched)
}
export interface RoadEdge {
  id: EdgeId; seg: SegId; dir: 1 | -1; from: NodeId; to: NodeId; twin: EdgeId | -1;
  cls: RoadClass; lanes: number; laneWidthM: number; speedMps: number; flags: number; layer: number /* i8 */;
  medianM: number; parkingSides: 0 | 1 | 2; maxGradePct: number; nhood: number /* 0..40, 255 none */;
}
export const enum NodeControl { None = 0, Signal = 1, AllWayStop = 2, MinorStop = 3, Yield = 4, DeadEnd = 5, Roundabout = 6 }
export interface RoadNode { id: NodeId; x: number; y: number; z: number; layer: number; control: NodeControl; junction: number /* index into intersections or -1 */ }
export type Turn = 'straight' | 'left' | 'right' | 'uturn';
export interface Movement { id: number; inEdge: EdgeId; outEdge: EdgeId; turn: Turn; lengthM: number; conflicts: number[] }
export type Aspect = 'green' | 'amber' | 'red' | 'dark';
export interface SignalPhase { startTick: number; greenTicks: number; amberTicks: number; clearTicks: number; movements: number[] }
export interface SignalProgram { id: number; cycleTicks: number; offsetTicks: number; phases: SignalPhase[]; pedWalkTicks: number }
export interface Junction { id: number; nodes: NodeId[]; x: number; z: number; control: NodeControl; movements: Movement[]; program: SignalProgram | null; stopApproaches: EdgeId[] }
/** Pure: aspect of one movement. `dark` when blackout. Phase times are in sim ticks (60 Hz). */
export function signalAspect(p: SignalProgram, tick: number, movementId: number, blackout: boolean): Aspect {
  if (blackout) return 'dark';
  const t = (tick + p.offsetTicks) % p.cycleTicks;
  for (const ph of p.phases) {
    if (ph.movements.indexOf(movementId) < 0) continue;
    const u = t - ph.startTick;
    if (u >= 0 && u < ph.greenTicks) return 'green';
    if (u >= ph.greenTicks && u < ph.greenTicks + ph.amberTicks) return 'amber';
  }
  return 'red';
}

// ---- 4. Pedestrian graph ----------------------------------------------------------------
export const enum PedNodeFlag { Crossing = 1, Plaza = 2, Stairs = 4, Park = 8, Transit = 16, Waiting = 32 }
export interface PedNode { id: number; x: number; y: number; z: number; flags: number }
export const enum PedEdgeKind { Sidewalk = 0, Crosswalk = 1, Path = 2, Plaza = 3, Stairs = 4 }
export interface PedEdge { a: number; b: number; kind: PedEdgeKind; widthM: number; junction: number /* -1 none */; movement: number /* crossing parallel to this vehicle movement group, -1 */ }

// ---- 5. Tags (06 §4.4 fixed list) -------------------------------------------------------------
export interface HidingSpot { id: string; x: number; y: number; z: number; radiusM: number; kind: 'viaduct' | 'garage' | 'alley' | 'carwash' | 'tunnel-portal' }
export interface PursuitBreaker { id: string; x: number; y: number; z: number; triggerRadiusM: number; kind: 'scaffold' | 'produce-stand' | 'crane-load' | 'cable-car' | 'billboard'; prefab: string; mission: boolean }
export interface ChokePoint { id: string; x: number; y: number; z: number; edge: EdgeId; widthM: number; kind: 'bridge' | 'tunnel' | 'ramp' | 'narrow' }
export interface JumpZone { id: string; x: number; y: number; z: number; yaw: number; lengthM: number; kind: 'hill-crest' | 'ramp' }
export interface Portal { id: string; x: number; y: number; z: number; yaw: number; widthM: number; kind: 'bridge' | 'county-line' | 'ferry' | 'tunnel'; state: 'closed' | 'open' | 'sealed'; toArea: string | null; edges: EdgeId[] }
export interface ShoreNode { id: string; x: number; y: number; z: number; nx: number; nz: number }
export interface TeleportNode { id: string; x: number; y: number; z: number; yaw: number; kind: 'xr' | 'landmark' | 'transit' | 'safehouse' | 'spawn' }
export interface ChunkTags {
  hidingSpots: HidingSpot[]; pursuitBreakers: PursuitBreaker[]; chokePoints: ChokePoint[]; jumpZones: JumpZone[];
  portals: Portal[]; shoreNodes: ShoreNode[]; teleportNodes?: TeleportNode[];
}

// ---- 6. Spawn tables (C01 rule 5: lower tiers run a prefix of slots) ------------------------------
export const SLOT = { traffic: [0, 255], ped: [256, 511], parked: [512, 767], transit: [768, 831], boat: [832, 863], air: [864, 895] } as const;
export interface ParkedSlot { slot: number; seg: SegId; s: number; side: -1 | 1; yawJitterDm: number }
export interface SpawnTable {
  cellKey: ChunkKey; densityProfile: number;        // index into config/world/density.json profiles
  trafficSlots: number; pedSlots: number; parked: ParkedSlot[];   // counts = capacity at 'desktop-ultra' peak
}
export const ambientKey = (cell: ChunkKey, slot: number) => `amb:${cell}:${slot}` as const;   // C01 StableKey
/** C01 rule 5: a tier may run slots 0 … densityCap − 1. tierFactor comes from C13 CrowdLimits (living part §7). */
export const densityCap = (capacity: number, tierFactor: number): number => Math.min(capacity, Math.floor(capacity * tierFactor));
/** Pure: active prefix length now. hour and weather factors come from config/world/density.json, override from TrafficControl. */
export function activeSlots(capacity: number, tierFactor: number, hourFactor: number, weatherFactor: number, override: number): number {
  return Math.min(densityCap(capacity, tierFactor), Math.floor(capacity * tierFactor * hourFactor * weatherFactor * override));
}

// ---- 7. Chunks ----------------------------------------------------------------------
export interface SimChunk {                   // z9 only; decoded from p0 by packages/shared/src/world/pack-codec.ts (pure)
  key: ChunkKey; bakeId: string; height: HeightGrid; prisms: PrismPack; slabs: PrismPack; hoods: PrismPack;
  segments: RoadSegment[]; edges: RoadEdge[]; nodes: RoadNode[]; junctions: Junction[];
  pedNodes: PedNode[]; pedEdges: PedEdge[]; tags: ChunkTags; spawn: SpawnTable; ground: Uint8Array /* 64×64 GroundClass */;
}
export const enum GroundClass { Grass = 0, Park = 1, Sand = 2, Paved = 3, Dirt = 4, Rock = 5, Asphalt = 6, Sidewalk = 7, Pier = 8, WaterShallow = 9, Water = 10, Rail = 11 }
export const enum BuildingKind { ResLow = 0, ResMid = 1, Commercial = 2, Tower = 3, Industrial = 4, Civic = 5 }
export interface BuildingRecord {             // decoded l0 record; meshed in asset.worker (D-15)
  baseDm: number; heightDm: number; kind: BuildingKind; roof: 0 | 1 | 2 | 3; palette: number; seed: number;
  proxyOf: number;                            // landmark index + 1 when this extrusion is replaced by a glTF, else 0
  ring: Int16Array;                           // x,z pairs, 0.1 m, relative to the chunk NW corner
}
export interface RenderChunk {
  key: ChunkKey; z: ChunkZ; bakeId: string; height: HeightGrid; ground: Uint8Array;
  buildings: BuildingRecord[]; trees: Float32Array /* x,z,scale,species */; lamps: Float32Array /* x,z,yaw */;
  furniture: Float32Array /* x,z,yaw,type */; landmarks: number[];
}
export interface WorldChunk { key: ChunkKey; sim: SimChunk | null; render: RenderChunk | null }

// ---- 8. Index, landmarks, districts, bounds ---------------------------------------------
export type LandmarkId = `lm.${string}`;                      // S03 LandmarkId; AssetRef is `building/lm.<slug>`
export type PoiId = `poi.${string}`;                          // ^poi\.[a-z0-9.-]{3,64}$ ; poi.<nhoodSlug>.<name> (S04)
export type DistrictId = string;                              // ^[a-z0-9-]{2,32}$ : 'd1'…'d10', 'outer', or one of 41 neighbourhood slugs
export interface LandmarkRecord {
  id: LandmarkId; nameKey: string; lat: number; lng: number; x: number; z: number; chunk: ChunkKey; district: DistrictId; nhood: DistrictId;
  cls: 'hero' | 'major' | 'minor'; asset: AssetRef /* building/lm.<slug> */; replaces: string[] /* DataSF sf16_bldgid or OSM ids */;
  swapM: Record<QualityTierId, number>; skyline: boolean; arrival: { x: number; z: number; yaw: number }; roles: string[];
}
export interface PoiRecord {
  id: PoiId; nameKey: string; kind: 'home' | 'work' | 'cafe' | 'bar' | 'shop' | 'park' | 'plaza' | 'transit' | 'landmark' | 'venue' | 'street' | 'hub';
  lat: number; lng: number; x: number; y: number; z: number; chunk: ChunkKey; nhood: DistrictId; district: DistrictId;
  pedNode: number | null; hours: [number, number] | null /* local hours [open, close) */; landmark: LandmarkId | null;
}
export interface DistrictRecord { id: DistrictId; kind: 'district' | 'nhood'; parent: DistrictId | null; nameKey: string; tier: 'A' | 'B' | 'C' | 'stage'; nhoods: string[]; densityProfile: number }
export interface AreaRecord { id: string; status: 'playable' | 'backdrop'; bboxEnu: ChunkBounds; unlock: string | null }
export interface WorldIndex {
  schema: 'world-index/1'; c08: typeof C08_VERSION; bakeId: string; worldSeed: number;
  areas: AreaRecord[]; tiles: { p0: string[]; l0: string[]; l1: string[]; l2: string[] };   // existing pack tile coordinates "x-y"
  landmarks: LandmarkRecord[]; pois: PoiRecord[]; districts: DistrictRecord[]; portals: Portal[]; transit: TransitNode[]; sources: SourceStamp[];
}
export interface SourceStamp { id: string; url: string; retrievedAt: string /* ISO, repo-audited file */; sha256: string; licence: string; attribution: string }
export interface TransitNode { id: string; kind: 'bay-rail' | 'city-metro' | 'cable-car' | 'ferry' | 'rail-terminus'; x: number; z: number; nameKey: string; fastTravel: boolean }
export interface WorldBounds {                // config/world.bounds.json (read by C11 pose validation, S09)
  schema: 'world-bounds/1'; origin: typeof ORIGIN; mPerDegLat: number; mPerDegLng: number;
  play: ChunkBounds & { minY: number; maxY: number }; stream: ChunkBounds; far: ChunkBounds; gridMinM: number; gridEdgeM: number;
}
```

Service interfaces (reach modes as C06 1.1 `ModeContext.world`):

```ts
// packages/shared/src/world/c08-api.ts — service interfaces implemented in packages/world (sim half) and exposed as ModeContext.world (C06 1.1).
import type { ChunkKey, EdgeId, NodeId, Aspect, LandmarkId, LandmarkRecord, PoiId, PoiRecord } from './c08';

export interface EdgePos { edge: EdgeId; s: number /* m along the directed edge */; lane: number }
export interface RouteRequest { from: EdgePos | { x: number; z: number }; to: EdgePos | { x: number; z: number };
  maxExpand: number; avoid?: ReadonlySet<EdgeId>; classMask?: number; allowWrongWay?: boolean; useTopology?: boolean }
export interface Route { edges: EdgeId[]; lengthM: number; etaS: number; complete: boolean }
export interface RoadGraphQuery {
  edge(id: EdgeId): Readonly<import('./c08').RoadEdge> | null;           // null when its chunk is not resident
  nearestEdge(x: number, z: number, y: number | undefined, maxM: number, classMask?: number): { edge: EdgeId; s: number; distM: number } | null;
  laneCentre(e: EdgePos, out: Float64Array): void;                       // x,y,z,yaw
  route(r: RouteRequest): Route | null;                                  // A*, binary heap, ties by edge id; lane-level inside resident chunks, topology graph beyond
  resolve(lat: number, lng: number): { edge: EdgeId; s: number } | null; // authoring tools and mission setup
  signal(node: NodeId, movement: number): Aspect;
  neighbours(node: NodeId): readonly EdgeId[];
}
export interface TrafficControl {
  setBlackout(on: boolean, by: string): void;                            // signals dark, robotaxis hold, lamps off; released by `by`
  setDensity(kind: 'traffic' | 'ped' | 'parked', mult: number, by: string): void;   // 0..1.5, mission or sandbox override
  closeEdges(edges: readonly EdgeId[], by: string): void;                // race closures, barrier props
  release(by: string): void;
  readonly blackout: boolean;
}
export type BlipKind = 'mission' | 'waypoint' | 'route' | 'police' | 'experience' | 'property' | 'shop' | 'transit' | 'landmark' | 'fasttravel' | 'player' | 'friend';
export type BlipShape = 'arrow' | 'diamond' | 'pin' | 'ring' | 'hex' | 'house' | 'bag' | 'dot' | 'star' | 'square' | 'triangle';
export interface MapBlip { id: string; kind: BlipKind; shape: BlipShape; colorToken: string; x: number; z: number; radiusM?: number; labelKey?: string; priority: number; minZoomMPerPx?: number }
export interface MapApi {
  setBlip(b: MapBlip): void; removeBlip(id: string): void; setWaypoint(x: number, z: number): void; clearWaypoint(): void;
  setRoute(to: { x: number; z: number } | null): void;                    // GPS polyline on the drivable graph
  blips(): readonly MapBlip[];
}
export type TeleportKind = 'sandbox' | 'fast-travel' | 'xr-comfort' | 'respawn' | 'debug';
export type TeleportTarget = { x: number; z: number; yaw?: number } | { landmark: string } | { node: string };
export type TeleportResult =
  | { ok: true; x: number; y: number; z: number; yaw: number }
  | { ok: false; reason: 'not-loaded' | 'blocked' | 'water' | 'forbidden-in-mode' | 'heat' | 'out-of-bounds' | 'cooldown'; messageKey: string };
export interface TeleportApi { request(kind: TeleportKind, to: TeleportTarget): Promise<TeleportResult>; candidates(kind: TeleportKind): readonly { id: string; nameKey: string; x: number; z: number }[] }
export interface WorldQuery {
  groundY(x: number, z: number, yHint?: number): number | null;           // heightfield, slabs and hoods; null when not resident
  isWater(x: number, z: number): boolean;
  nhoodAt(x: number, z: number): number;                                  // 0..40, 255 none (district-grid)
  districtAt(x: number, z: number): string | null;
  chunkReady(k: ChunkKey): boolean;
  nearestWalkable(x: number, z: number, maxM: number): { x: number; y: number; z: number } | null;
}
export interface PlaceIndex {
  landmarks(): readonly LandmarkRecord[]; landmark(id: LandmarkId): LandmarkRecord | null;
  poi(id: PoiId): PoiRecord | null; poisNear(x: number, z: number, radiusM: number, kind?: PoiRecord['kind']): readonly PoiRecord[];
  poiPos(id: PoiId): [number, number, number] | null;
  pedRoute(a: PoiId, b: PoiId): [number, number, number][];             // decimated commute polyline (≤ 64 points) on the topology graph; S04 whereIs()
  findPlace(text: string, limit: number): Promise<readonly { label: string; x: number; z: number; kind: string }[]>;   // lazy sf-geocode.v1
}
export interface LatLng { lat: number; lng: number }
export interface SnapRequest { at: LatLng | { landmark: LandmarkId }; snap: 'ground' | 'road' | 'sidewalk' | 'none'; y?: number; yawDeg?: number }
/** Load-time resolver used by S03/S06 compilers and tools; structurally what S03 calls WorldResolver (A-C08-1). */
export interface WorldResolver {
  readonly bake: string;
  toEnu(ll: LatLng): [number, number, number];
  landmark(id: LandmarkId): { enu: [number, number, number]; chunkKey: ChunkKey } | null;
  snap(p: SnapRequest): { pos: [number, number, number]; yaw: number; distM: number } | null;   // null when > 25 m from a valid target
  route(via: LatLng[]): number[] | null;                                  // edge ids, A* between consecutive points
}
export interface WorldApi { readonly graph: RoadGraphQuery; readonly traffic: TrafficControl; readonly map: MapApi; readonly teleport: TeleportApi; readonly query: WorldQuery; readonly places: PlaceIndex; readonly resolver: WorldResolver }
```

`config/world.bounds.json` (committed, regenerated by `map:build`, read by C11 pose validation and the Worker):

```json
{ "schema": "world-bounds/1",
  "origin": { "lat": 37.7793, "lng": -122.4193 }, "mPerDegLat": 110992.06, "mPerDegLng": 88083.39,
  "play":   { "minX": -9400,  "maxX": 6200,  "minZ": -6300,  "maxZ": 8900, "minY": -80, "maxY": 600 },
  "stream": { "minX": -10500, "maxX": 9500,  "minZ": -11000, "maxZ": 9000 },
  "far":    { "minX": -12500, "maxX": 52000, "minZ": -23500, "maxZ": 53300 },
  "gridMinM": -65664, "gridEdgeM": 131072 }
```

Binary `DVWP` v1: 64-byte header (`magic u32 = 0x50575644`, `version u8 = 1`, `family u8`, tile indices, `bakeId[32]`), chunk directory, section table with ids 1–13 (`p0`), 20–25 (`l0`) and 30–32 (`l1`/`l2`); full layouts in `02-world-contracts.md` §4. Packs ≤ 4 MiB (warn > 2.5 MiB). `WorldIndex` (`data/world-index`) validates against `tools/map/schemas/world-index.schema.json`; config schemas live in `tools/map/schemas/`. Versioning (§7): additive sections or tag types are a minor bump and old loaders skip unknown sections; grid, slot ranges, `EdgeId` assignment or section layout changes are a major bump with an ADR and a one-release dual loader, and `DVWP version` changes with `C08_VERSION`.
