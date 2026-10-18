# 04 — Data models, part 6: C10 NPCSoul and dialogue

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/04-npc-contracts.md` §B2, §B4, §B5 and `spec/domains/04-npc-builder.md` §C3 (S04). The owner specs stay normative; prompt blocks and model-facing schemas (§B7) and lints (§B8) are cited, not copied.

## C10 — `NPCSoul` + dialogue

| Field | Value |
|---|---|
| Owner · version | S04 · `C10_VERSION = '1.0.0'`; frontmatter format `soul/1.0` |
| Source paths | `packages/shared/src/contracts/c10-npc.ts`, `contracts/c10-npc-builder.ts`; schemas `packages/shared/schemas/npc/*.json`; generated validators `packages/shared/src/npc/validators.gen.ts` (`pnpm npc:schemas`) |
| Defined in | `04-npc-contracts.md` §B1–§B5, §B7; `04-npc-builder.md` §C3 |
| Created in | M06a2 (types, schemas, soul compiler); M06a3 (dialogue proxy); M06b1 (builder API) |
| Consumers | S02, S03, S05, S07, S08, S09, S10, S12; milestones M05a1 (talk ops), M06a1, M06a2, M06a3, M06a4, M06a5, M06b1, M06b2, M06b3, M06c, M08b1 (`fighter` block), M09b2 (`context.tycoon.deals`), M10a family, M10c, M13a3 (`npc.cameo`) |

Rules summary (§B1): `NpcId` `^[a-z][a-z0-9_-]{2,47}$` equals the C07 character AssetId, the C01 key `npc:<id>`, `roster_flag.npc_id`, `npc_memory.npc_id`, KV `ks:likeness:<id>` and the R2 tag `char:<id>`; user NPCs are `u_` + 26-character lower-case Crockford base32 of a UUIDv7. `soulVersion` is an integer that increases whenever compiled prompt bytes or public JSON change and is never reused; the server accepts the active and previous version for 24 h after a publish, anything else is `409 conflict`. `NPCDialogueRequest` has no history (EncounterDO holds it); SSE events `meta`, `line.delta`, `line.done`, `effects`, `fallback`, `done`; fallback when no first token arrives within 4 s. Schemas are compiled ahead of time; nothing compiles a schema at runtime.

Identifiers and enums:

```ts
// packages/shared/src/contracts/c10-npc.ts
import type { AssetRef, LikenessTier } from '../assets/c07';
import type { StableKey } from './c01-ecs';
export const C10_VERSION = '1.0.0' as const;

export type NpcId = string;                 // /^[a-z][a-z0-9_-]{2,47}$/ (B1 rule 4)
export type SoulVersion = number;           // integer ≥ 1 (fixed)
export type SoulTier = Exclude<LikenessTier, 'original'>;          // 'consented' | 'parody' | 'fictionalized'
export type LikenessBasis = 'real_person' | 'original';
export type { PoiId, DistrictId } from '../world/c08';   // C08 owns both id spaces (DL-077): ^poi\.[a-z0-9.-]{3,64}$ and ^[a-z0-9-]{2,32}$
import type { PoiId, DistrictId, ChunkKey } from '../world/c08';
/** Tier used on assets (C07 LikenessSummary) and in the C09 cutscene key: 'original' for invented characters, else the soul tier (DL-083). */
export const assetTier = (s: { basis: LikenessBasis; tier: SoulTier }): LikenessTier => (s.basis === 'original' ? 'original' : s.tier);
export type ConsentScope = 'name' | 'likeness_stylized' | 'likeness_realistic' | 'voice_designed' | 'voice_clone'
  | 'biography' | 'catchphrases' | 'marketing' | 'merchandise' | 'ugc_remix' | 'cutscene';   // research/legal-ip-likeness.md L2
export type VoiceTier = 'text' | 't1' | 't2' | 't3';             // D-23
export type ModelTier = 'haiku' | 'sonnet';                        // D-21
export type Archetype = 'rapper' | 'founder' | 'vc' | 'influencer' | 'athlete' | 'civilian' | 'police' | 'vendor' | 'official' | 'other';
export type Activity = 'sleep' | 'eat' | 'work' | 'perform' | 'record' | 'train' | 'hustle' | 'socialize' | 'commute'
  | 'shop' | 'pitch' | 'race' | 'patrol' | 'idle';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';   // weekday(t) = floor(t / 172800) % 7, 0 = mon
export type Emotion = 'neutral' | 'happy' | 'amused' | 'annoyed' | 'angry' | 'sad' | 'scared' | 'proud' | 'suspicious';
export type Gesture = 'none' | 'nod' | 'shrug' | 'point' | 'laugh' | 'wave' | 'cross_arms' | 'facepalm' | 'dap' | 'lean_in' | 'back_off';
export type NpcAction = 'none' | 'offer_mission' | 'offer_race' | 'offer_fight' | 'offer_deal' | 'give_item' | 'sell'
  | 'refuse' | 'call_police' | 'flee' | 'attack' | 'follow' | 'leave';
export type MemoryKind = 'player_fact' | 'promise' | 'event' | 'preference' | 'rumor' | 'reflection';
export type NearbyEvent = 'car_crash' | 'melee_fight' | 'police_chase' | 'race_finished' | 'player_won_race' | 'player_lost_race'
  | 'sideshow' | 'rain_started' | 'fog_rolling_in' | 'night_fell' | 'mission_started' | 'mission_failed' | 'mission_passed';
export type InkKnot = 'greeting' | 'smalltalk' | 'busy' | 'deflect' | 'farewell' | `mission_${string}`;
```

Frontmatter (`soul.md`):

```ts
export interface ScheduleBlock {
  days: 'daily' | 'weekdays' | 'weekends' | Weekday[];
  from: string; to: string;                // 'HH:MM' game time; to may be '24:00'; 1 game hour = 7,200 C06 half-seconds
  activity: Activity; place: PoiId; interruptible: boolean; priority: number;   // 0–9
}
export interface Move { id: string /* ^[a-z0-9_]{3,32}$, unique roster-wide (C09 key part) */; name: string; input?: string; desc?: string }
export interface SoulLikeness {
  basis: LikenessBasis;
  subjectId: string | null;                // opaque 'subj_…' (C07 LikenessSummary.subjectId); real names live only in DB likeness_subject
  consentRecordId: string | null;          // 'consent_…'; required when tier = consented
  consentScopes: ConsentScope[];
  deceased: boolean;
  faceReferenceAllowed: boolean;           // = tier==='consented' && scopes ∩ {likeness_stylized, likeness_realistic} ≠ ∅ (lint L11)
  fameDomain: string[];                    // e.g. 'basketball', 'rap_performance'; S06/S07 refuse matching modes or moves for parody
  nameDistanceOk: boolean;                 // written by lint L3
  disclaimer: 'courtesy' | 'parody' | 'fictional' | 'none';   // = C07 LikenessSummary.disclaimer
}
export interface SoulFrontmatter {
  schema: 'soul/1.0';
  id: NpcId; soulVersion: SoulVersion;
  status: 'draft' | 'active' | 'retired';
  origin: 'first_party' | 'user';
  ownerProfileId: string | null;           // identity profile id (UUIDv7) when origin = 'user'
  name: string;                            // display name, 2–40 chars; parody: distance ≥ 0.4 from real name and aliases
  shortBio: string;                        // ≤ 280, shown in phone contacts
  archetype: Archetype; tags: string[];
  tier: SoulTier;                          // likeness tier (R-NPC-04)
  minor: false;                            // const (sketch field, top level): no minors as subjects, ever; S05 refuses TIER_UNKNOWN otherwise
  likeness: SoulLikeness;
  visual_brief: string;                    // 40–1,200 chars, text-only appearance; never photographs, real names, logos, numbers
  standIn: AssetRef | null;                // 'character/<NpcId>' of an active original soul; required when basis = real_person
  heightM: number;                         // 1.40–2.20 (S05 rig height_meters)
  moves: number[];                         // ≤ 8 Meshy animation action ids (S05 stage 5)
  roles: { hero: boolean; questGiver: boolean; vendor: boolean; fighter: boolean; tycoonActor: boolean; racer: boolean };
  speech: { register: string[]; dialectNotes?: string; lexicon: { term: string; gloss: string; freq: 'rare' | 'sometimes' | 'often' }[];
            catchphrases: string[]; avoid: string[]; verbosity: 'terse' | 'normal' | 'chatty';
            maxWordsPerLine: number /* 8–60 */; profanity: 'none' | 'mild' | 'strong'; languages: string[] /* BCP-47 */ };
  voice: { tier: VoiceTier; design_prompt: string /* ≤ 300; never names, describes or imitates a real person */;
           voiceRef: AssetRef | null /* 'voice/<id>' C07 kind voice */; speed: number /* 0.8–1.2 */ };
  personality: { traits: string[]; values: string[]; motivations: string[]; fears: string[]; humor: string;
                 temperament: 'calm' | 'volatile' | 'warm' | 'cold' };
  knowledge: { knows: string[]; doesNotKnow: string[]; era: string; realWorldRefs: 'none' | 'public_record' | 'free' };
  relations: { npc: NpcId; kind: 'ally' | 'rival' | 'mentor' | 'protege' | 'family' | 'business' | 'beef'; affinity: number; note: string }[];
  locations: { districts: DistrictId[]; home: PoiId; hangouts: PoiId[] };
  schedule: ScheduleBlock[];               // covers 24 h every weekday, no overlaps (lint L1)
  goals: string[];                         // ⊆ config/npc-goals.json (closed catalog)
  stats: { fighter?: { power: number; speed: number; defense: number; reach: number; meterGain: number };   // each 1–10
           tycoon?: { riskAppetite: number /* 0–1 */; valuationBias: number /* −1..1 */; checkUsd: { min: number; max: number } } };
  fighter?: { style: 'rushdown' | 'zoner' | 'grappler' | 'all_round' | 'trickster' | 'power';
              specials: Move[]; super: Move; finisher: Move; introQuote: string; winQuotes: string[]; taunts: string[] };
  tycoon?: { roles: ('founder' | 'vc' | 'angel' | 'exec' | 'regulator' | 'journalist')[]; thesis: string[];
             negotiationStyle: 'hardball' | 'founder_friendly' | 'herd' | 'contrarian'; redFlags: string[]; pitchHooks: string[] };
  rails: { rating: 'T' | 'M'; forbiddenTopics: string[]; never: string[]; deflectionStyle: string; mayReferenceRealEvents: boolean };
  dialogue: { modelTier: ModelTier; maxTurnsPerEncounter: number /* 4–20, default 12 */; ink: string /* repo path *.ink */; barkPool: string /* repo path */ };
  assetsPending?: boolean;                 // dev/staging only; `pnpm npc:build --release` fails if an active soul sets it
  provenance: { authoredBy: string; generatedBy: { model: string; date: string } | null;
                reviewedBy: string | null; reviewedAt: string | null /* 'YYYY-MM-DD' */; contentSha256: string };
}
```

Compiled outputs:

```ts
export interface CompiledSoulAssets {      // AssetRefs by convention; existence checked by lint L10 against assets/assets.lock.json
  model: AssetRef /* character/<id> */; rig: 'rig/bay_rig_v1'; anim: AssetRef[] /* anim/<id>.<name> */;
  portrait: AssetRef | null; mouthAtlas: AssetRef | null; voice: AssetRef | null;
  ink: AssetRef /* data/ink.<id> */; barks: AssetRef | null /* data/barks.<id> */;
}
/** Client view. All public souls ship in one C07 `data/npc-roster` asset (NpcRosterBundle); rails and prompt text never do. */
export interface CompiledSoulPublic {
  schema: 'soul-public/1';
  id: NpcId; soulVersion: SoulVersion; status: 'active' | 'retired'; origin: 'first_party' | 'user';
  name: string; shortBio: string; archetype: Archetype; tags: string[];
  tier: SoulTier; basis: LikenessBasis; disclaimer: SoulLikeness['disclaimer']; fameDomain: string[];
  marketingAllowed: boolean;               // basis original, or consented with scope 'marketing' (legal L2); S10/S13 marketing reads only these
  ugcCameo: boolean;                       // C14 npc.cameo may place this NPC; compiler default false for tier 'parody', true otherwise (DN-S12-07, DL-088)
  standIn: AssetRef | null; heightM: number; moves: number[]; roles: SoulFrontmatter['roles'];
  locations: SoulFrontmatter['locations']; schedule: ScheduleBlock[]; goals: string[];
  voice: { tier: VoiceTier; voiceRef: AssetRef | null; speed: number };
  dialogue: { modelTier: ModelTier; maxTurnsPerEncounter: number };
  stats: SoulFrontmatter['stats']; fighter?: SoulFrontmatter['fighter']; tycoon?: SoulFrontmatter['tycoon'];
  assets: CompiledSoulAssets;
}
/** Server view: PRIVATE souls/<id>/<ver>/soul.compiled.json; also what S05's RosterPort returns. */
export interface CompiledSoul extends Omit<CompiledSoulPublic, 'schema' | 'voice'> {
  schema: 'soul-compiled/1';
  voice: SoulFrontmatter['voice'];         // includes design_prompt for S05 voice_design
  minor: false; likeness: SoulLikeness; visual_brief: string;
  speech: SoulFrontmatter['speech']; rails: SoulFrontmatter['rails'];
  prompt: { key: string /* souls/<id>/<ver>/soul.prompt.txt */; sha256: string; tokens: number /* messages.count_tokens, claude-haiku-5-5 */ };
  sourceSha256: string;                    // sha256 of the soul.md bytes
  rulesVersion: number;                    // block A version the prompt was linted against
  compiledAt: number;                      // epoch ms
}
export interface NpcRosterEntry {
  id: NpcId; soul: string /* repo path of soul.md */; status: 'draft' | 'active' | 'retired';
  tier: SoulTier; basis: LikenessBasis; hero: boolean;
  pipeline: 'standard' | 'lean' | 'premium' | 'none';     // S05 preset for `assets:gen plan --roster`
  priority: number;                                       // 1 (first) … 9
  research: 'none' | 'pending' | 'normalized';            // Q-19 research layer state
  standIn: AssetRef | null; modes: ('story' | 'racing' | 'fighter' | 'tycoon')[];
}
export interface NpcRosterManifest { schema: 'npc-roster/1'; rosterVersion: number; entries: NpcRosterEntry[] }
export interface NpcRosterBundle { schema: 'npc-roster-bundle/1'; rosterVersion: number; souls: CompiledSoulPublic[] }
```

Dialogue (route 31, SSE):

```ts
export type PlayerIntent = 'greet' | 'smalltalk' | 'ask_mission' | 'accept' | 'decline' | 'trade' | 'compliment'
  | 'insult' | 'threaten' | 'farewell' | `ask_about_npc:${string}` | `ask_about_place:${string}`   // arg = NpcId | PoiId
  | 'pitch' | 'answer' | 'ask_more' | 'counter' | 'close'   // only with context.mode 'tycoon' (S08 meeting moves, DL-086)
  | 'fight_pre' | 'fight_post';                            // only with context.mode 'fighter' (S07 trash talk, DL-086)
export interface NPCDialogueContext {      // client-built from sim state; enums and numbers only, so no free text reaches the prompt
  schema: 1;
  clockT: number;                          // C06 WorldClockState.t (integer half-seconds)
  chunkKey: ChunkKey;                      // C08 'z/x/y'
  poiId: PoiId | null;
  mode: 'story' | 'sandbox' | 'racing' | 'fighter' | 'tycoon' | 'experience';
  missionId: string | null; missionStep: string | null;    // C09 ids; for a C09 talk objective missionStep = TalkDef.id and the fallback knot is mission_<missionId>_<talkId> with '.' and '-' → '_' (DL-085)
  player: { heat: 0 | 1 | 2 | 3 | 4 | 5 | 6; inVehicle: boolean; health: 'ok' | 'hurt' | 'down'; streetCred: number; techClout: number };
  relation: { trust: number /* C05 StorySlice.npcRelations[id].trust, −100..100 */; met: boolean };
  events: NearbyEvent[];                   // ≤ 5, newest first
  offers: { missionIds: string[]; raceIds: string[]; dealIds: string[] };   // the only valid action_arg values
  tycoon: {                                // S08 engine output (DL-087); the sim decides every number, the LLM voices it or picks one of `deals`
    roundId: string; stance: 'open' | 'firm' | 'walk'; week: number; mood: number /* 0..100 */;
    sector: string; arrBand: 0 | 1 | 2 | 3 | 4; growthBand: 0 | 1 | 2 | 3 | 4; runwayBand: 0 | 1 | 2 | 3 | 4; weakestMetric: string;
    deals: { id: string; amountCents: number; preMoneyCents: number; poolBp: number; boardSeat: boolean; liq: '1x' | '1.5x' | '2x' }[];   // ≤ 3, inside S08's envelope; ids repeat in offers.dealIds
  } | null;
  voice: 'off' | 'auto';
  locale: 'en-US';                         // v1
}
export interface NPCDialogueRequest {      // fixed shape (06 §4.4)
  npcId: NpcId;                            // must equal the :npcId path parameter
  encounterId?: string;                    // UUIDv7 from a previous meta event; absent = open a new encounter
  soulVersion: SoulVersion;
  turn: { text?: string /* ≤ 280 chars after NFC */; intent?: PlayerIntent };   // at least one
  context: NPCDialogueContext;
  maxTokens: number;                       // server clamps to min(value, 512)
}
export interface AudioChunk {
  sentence: number; codec: 'mp3' | 'pcm_s16le_16000';
  b64: string; last: boolean;
  alignment?: { chars: string; startS: number[]; endS: number[] };  // t2 only (ElevenLabs with-timestamps)
}
export type FallbackReason = 'timeout' | 'refusal' | 'upstream' | 'invalid_output' | 'killed' | 'moderation';
export type DialogueEvent =
  | { event: 'meta'; data: { encounterId: string; turnIndex: number; npcId: NpcId; soulVersion: SoulVersion;
        model: ModelTier; voice: VoiceTier /* effective tier for this turn */; turnsLeft: number;
        disclosure: { aiCharacter: true; disclaimer: SoulLikeness['disclaimer'] }; gov: 0 | 1 | 2 | 3 } }
  | { event: 'line.delta'; data: { seq: number; text?: string; audio?: AudioChunk } }
  | { event: 'line.done'; data: { text: string; words: number } }
  | { event: 'effects'; data: { action?: { kind: NpcAction; arg: string | null }; mood?: Emotion; memoryWrite?: { count: number };
        gesture?: Gesture; affinityDelta?: number /* −10..10, applied by the client to C05 npcRelations.trust */; endConversation?: boolean } }
  | { event: 'fallback'; data: { reason: FallbackReason; knot: InkKnot } }
  | { event: 'done'; data: { costMicros: number; turnsLeft: number; closed: boolean } };
// Order: meta, line.delta*, line.done, effects, done — or meta, fallback, done. Errors found before the upstream call are
// C12 ApiError JSON (never SSE): bad_request, unauthorized, age_blocked, not_found, conflict{reason:'busy'|'turn_cap'|'soul_version'},
// rate_limited, quota_exhausted, budget_offline, feature_disabled, kill_switched, moderation_blocked, upstream_unavailable.
```

Agency intents (route 32, JSON):

```ts
export type IntentTrigger = 'block_boundary' | 'player_near' | 'encounter_ended' | 'world_event' | 'mission_state';
export interface NPCIntentRequest {
  npcId: NpcId; soulVersion: SoulVersion; trigger: IntentTrigger;
  situation: { clockT: number; chunkKey: ChunkKey; poiId: PoiId | null; activeBlock: number /* index into schedule */;
               nearby: { key: StableKey; kind: 'player' | 'npc' | 'vehicle'; distM: number }[] /* ≤ 8 */;
               events: NearbyEvent[]; relation: { trust: number; met: boolean } };
}
export interface NpcIntent {
  goal: string;                            // ∈ soul.goals ∪ {continue_schedule, approach_player, avoid_player, go_to}
  target: StableKey | PoiId | null;        // must appear in situation.nearby or soul.locations
  urgency: 'low' | 'med' | 'high';
  bark: string | null;                     // a BarkTag of the NPC's pool (no free text)
  until: 'next_block' | '30s' | '2m' | '5m';
}
export interface NPCIntentResponse { intent: NpcIntent; cached: boolean; source: 'llm' | 'cache' | 'default' }
```

Memory types (imported by C12 `DataPort.npcMemory`, C12 1.1):

```ts
export interface MemoryWrite { kind: MemoryKind; text: string /* ≤ 240, paraphrased, PII-scrubbed */; importance: number /* 1–10 */;
  gameTime: number /* C06 half-seconds */; source: 'dialogue' | 'mission' | 'world' | 'summary'; embedding: Float32Array /* 1024, bge-m3 */ }
export interface MemoryHit { id: number; text: string; kind: MemoryKind; score: number }
export interface SummaryPatch { summaryUpdate: string /* ≤ 600 */; memories: Omit<MemoryWrite, 'embedding'>[] /* ≤ 5 */;
  affinityDelta: number; trustDelta: number; flagsPatch: Record<string, boolean | number | string>; soulVersion: SoulVersion; reflection: boolean }
```

Voice catalog and barks:

```ts
export interface VoiceCatalogEntry {       // config/voice-catalog.json
  voiceRef: AssetRef;                      // voice/<id>
  tier: VoiceTier; engine: 'workers_ai' | 'elevenlabs' | 'baked_only';
  model: string;                           // e.g. '@cf/deepgram/aura-1', 'eleven_flash_v2_5' [research/ai-npc-runtime.md §5.1]
  providerVoiceId: string; mode: 'synthetic' | 'designed' | 'licensed' | 'consented_clone';
  consentRecordId: string | null;          // required for licensed | consented_clone
  allowedTiers: SoulTier[];                // which likeness tiers may use it
}
export interface VoiceCatalog { schema: 'voice-catalog/1'; entries: VoiceCatalogEntry[] }
export type BarkTag = 'bump' | 'greet_pass' | 'idle' | 'busy' | 'flee' | 'car_crash_nearby' | 'heat_low' | 'heat_high'
  | 'rain' | 'fog' | 'night' | 'compliment_car' | 'player_wins_race' | 'player_loses_race' | 'sideshow' | 'goodbye';
export interface BarkLine { id: string; tag: BarkTag; text: string /* ≤ 80 chars */; audio: AssetRef | null /* audio_bark */; cues: AssetRef | null; weight: number }
export interface BarkPool { schema: 'bark-pool/1'; owner: NpcId | `archetype:${Archetype}`; voiceRef: AssetRef | null; lines: BarkLine[] }
```

Builder API (C12 route 33 sub-paths; S04 semantics, S09 transport):

```ts
// packages/shared/src/contracts/c10-npc-builder.ts
export type DraftState = 'draft' | 'validating' | 'rejected_auto' | 'text_ok' | 'soul_generating' | 'soul_failed' | 'soul_ready'
  | 'probing' | 'private' | 'in_review' | 'published' | 'unpublished_pending_review' | 'rejected' | 'removed' | 'killed';
export type Attestation = 'original';                 // 'self' | 'consented_real' reserved, not accepted in v1
export interface DraftFields { name: string; shortBio: string; archetype: Archetype; tags: string[]; district: DistrictId;
  voiceRef: AssetRef | null; appearancePreset: string | null /* S10 creator preset id */ }
export type Verdict = 'allow' | 'review' | 'block' | 'quarantine';
export interface LintIssue { rule: string /* 'schema' | 'L1'… */; path: string; message: string }
export interface DraftView {
  id: string; npcId: NpcId; rev: number; state: DraftState; fields: DraftFields; backstoryChars: number;
  images: { uploadId: string; state: 'scanning' | 'described' | 'review' | 'blocked' | 'quarantined'; description: string | null }[];
  moderation: { text: Verdict | null; images: Verdict | null; realPerson: 'none' | 'possible' | 'explicit'; publishable: boolean; reasons: string[] };
  soul: { frontmatter: SoulFrontmatter; sections: Record<string, string> } | null; lint: LintIssue[];
  probes: { passed: number; total: 5; failures: string[] } | null;
  publish: { soulVersion: number | null; caseId: string | null; notes: string | null };
  jobs: { id: string; kind: 'validate' | 'soul' | 'images' | 'assets'; state: 'queued' | 'running' | 'done' | 'failed' }[];
  limits: { soulGenerationsLeft: number; previewTurnsLeft: number };
}
export interface CreateDraftReq { fields: DraftFields; attestation: Attestation }
export interface UpdateDraftReq { rev: number; fields?: Partial<DraftFields>; backstory?: string;
  soulEdits?: { frontmatter?: Partial<Pick<SoulFrontmatter, 'shortBio' | 'speech' | 'personality' | 'schedule' | 'goals' | 'visual_brief' | 'rails'>>; sections?: Record<string, string> } }
export interface AttachImagesReq { uploadIds: string[] }       // ≤ 6 total per draft
export interface JobAccepted { jobId: string; state: 'queued' }
export interface SubmitRes { caseId: string }
export interface CommunityNpc { npcId: NpcId; soulVersion: number; name: string; shortBio: string; archetype: Archetype;
  district: DistrictId; publishedAt: number; soul: CompiledSoulPublic }
```

## Runtime JSON Schema — soul.md frontmatter

`packages/shared/schemas/npc/soul-1.0.schema.json` (draft 2020-12, canonical, hand-written by S04). Fixtures in `packages/shared/schemas/npc/fixtures/{good,bad}/` (12 negative cases, one per conditional). Sibling schemas, mechanical translations of §B2: `soul-1.0.llm.schema.json` (generated, never hand-edited), `npc-roster-1.0.schema.json`, `npc-turn-1.0.schema.json` (`output_config.format`, identical for every NPC), `npc-intent-1.0.schema.json`, `npc-summary-1.0.schema.json`, `dialogue-request-1.0.schema.json`, `voice-catalog-1.0.schema.json`, `bark-pool-1.0.schema.json`.

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"soul-1.0","type":"object","additionalProperties":false,
"required":["schema","id","soulVersion","status","origin","ownerProfileId","name","shortBio","archetype","tags","tier","minor","likeness","visual_brief","standIn","heightM","moves","roles","speech","voice","personality","knowledge","relations","locations","schedule","goals","stats","rails","dialogue","provenance"],
"properties":{
 "schema":{"const":"soul/1.0"},"id":{"$ref":"#/$defs/npcId"},"soulVersion":{"type":"integer","minimum":1},
 "status":{"enum":["draft","active","retired"]},"origin":{"enum":["first_party","user"]},
 "ownerProfileId":{"type":["string","null"],"pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"},
 "name":{"type":"string","minLength":2,"maxLength":40},"shortBio":{"type":"string","maxLength":280},
 "archetype":{"enum":["rapper","founder","vc","influencer","athlete","civilian","police","vendor","official","other"]},
 "tags":{"type":"array","maxItems":16,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z0-9-]{2,32}$"}},
 "tier":{"enum":["consented","parody","fictionalized"]},"minor":{"const":false},"likeness":{"$ref":"#/$defs/likeness"},
 "visual_brief":{"type":"string","minLength":40,"maxLength":1200},
 "standIn":{"type":["string","null"],"pattern":"^character/[a-z][a-z0-9_-]{2,47}$"},
 "heightM":{"type":"number","minimum":1.4,"maximum":2.2},
 "moves":{"type":"array","maxItems":8,"uniqueItems":true,"items":{"type":"integer","minimum":0}},
 "roles":{"type":"object","additionalProperties":false,"required":["hero","questGiver","vendor","fighter","tycoonActor","racer"],
  "properties":{"hero":{"type":"boolean"},"questGiver":{"type":"boolean"},"vendor":{"type":"boolean"},"fighter":{"type":"boolean"},"tycoonActor":{"type":"boolean"},"racer":{"type":"boolean"}}},
 "speech":{"type":"object","additionalProperties":false,"required":["register","lexicon","catchphrases","avoid","verbosity","maxWordsPerLine","profanity","languages"],
  "properties":{"register":{"$ref":"#/$defs/s40x6"},"dialectNotes":{"type":"string","maxLength":400},
   "lexicon":{"type":"array","maxItems":40,"items":{"type":"object","additionalProperties":false,"required":["term","gloss","freq"],"properties":{"term":{"type":"string","maxLength":40},"gloss":{"type":"string","maxLength":120},"freq":{"enum":["rare","sometimes","often"]}}}},
   "catchphrases":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":80}},"avoid":{"type":"array","maxItems":20,"items":{"type":"string","maxLength":80}},
   "verbosity":{"enum":["terse","normal","chatty"]},"maxWordsPerLine":{"type":"integer","minimum":8,"maximum":60},
   "profanity":{"enum":["none","mild","strong"]},"languages":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"string","pattern":"^[a-z]{2}(-[A-Z]{2})?$"}}}},
 "voice":{"type":"object","additionalProperties":false,"required":["tier","design_prompt","voiceRef","speed"],
  "properties":{"tier":{"enum":["text","t1","t2","t3"]},"design_prompt":{"type":"string","maxLength":300},
   "voiceRef":{"type":["string","null"],"pattern":"^voice/[a-z0-9][a-z0-9._-]{1,62}$"},"speed":{"type":"number","minimum":0.8,"maximum":1.2}}},
 "personality":{"type":"object","additionalProperties":false,"required":["traits","values","motivations","fears","humor","temperament"],
  "properties":{"traits":{"$ref":"#/$defs/s40x8"},"values":{"$ref":"#/$defs/s80x6"},"motivations":{"$ref":"#/$defs/s80x6"},"fears":{"$ref":"#/$defs/s80x6"},
   "humor":{"type":"string","maxLength":160},"temperament":{"enum":["calm","volatile","warm","cold"]}}},
 "knowledge":{"type":"object","additionalProperties":false,"required":["knows","doesNotKnow","era","realWorldRefs"],
  "properties":{"knows":{"$ref":"#/$defs/s80x24"},"doesNotKnow":{"$ref":"#/$defs/s80x24"},"era":{"type":"string","maxLength":40},"realWorldRefs":{"enum":["none","public_record","free"]}}},
 "relations":{"type":"array","maxItems":24,"items":{"type":"object","additionalProperties":false,"required":["npc","kind","affinity","note"],
  "properties":{"npc":{"$ref":"#/$defs/npcId"},"kind":{"enum":["ally","rival","mentor","protege","family","business","beef"]},"affinity":{"type":"integer","minimum":-100,"maximum":100},"note":{"type":"string","maxLength":160}}}},
 "locations":{"type":"object","additionalProperties":false,"required":["districts","home","hangouts"],
  "properties":{"districts":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","pattern":"^[a-z0-9-]{2,32}$"}},"home":{"$ref":"#/$defs/poi"},"hangouts":{"type":"array","maxItems":8,"items":{"$ref":"#/$defs/poi"}}}},
 "schedule":{"type":"array","minItems":1,"maxItems":24,"items":{"$ref":"#/$defs/block"}},
 "goals":{"type":"array","maxItems":8,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z_]{3,32}$"}},
 "stats":{"type":"object","additionalProperties":false,"properties":{
   "fighter":{"type":"object","additionalProperties":false,"required":["power","speed","defense","reach","meterGain"],"properties":{"power":{"$ref":"#/$defs/r10"},"speed":{"$ref":"#/$defs/r10"},"defense":{"$ref":"#/$defs/r10"},"reach":{"$ref":"#/$defs/r10"},"meterGain":{"$ref":"#/$defs/r10"}}},
   "tycoon":{"type":"object","additionalProperties":false,"required":["riskAppetite","valuationBias","checkUsd"],"properties":{"riskAppetite":{"type":"number","minimum":0,"maximum":1},"valuationBias":{"type":"number","minimum":-1,"maximum":1},
    "checkUsd":{"type":"object","additionalProperties":false,"required":["min","max"],"properties":{"min":{"type":"integer","minimum":0},"max":{"type":"integer","minimum":0}}}}}}},
 "fighter":{"type":"object","additionalProperties":false,"required":["style","specials","super","finisher","introQuote","winQuotes","taunts"],
  "properties":{"style":{"enum":["rushdown","zoner","grappler","all_round","trickster","power"]},"specials":{"type":"array","minItems":2,"maxItems":6,"items":{"$ref":"#/$defs/move"}},
   "super":{"$ref":"#/$defs/move"},"finisher":{"$ref":"#/$defs/move"},"introQuote":{"type":"string","maxLength":120},
   "winQuotes":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":120}},"taunts":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":80}}}},
 "tycoon":{"type":"object","additionalProperties":false,"required":["roles","thesis","negotiationStyle","redFlags","pitchHooks"],
  "properties":{"roles":{"type":"array","minItems":1,"uniqueItems":true,"items":{"enum":["founder","vc","angel","exec","regulator","journalist"]}},"thesis":{"$ref":"#/$defs/s80x8"},
   "negotiationStyle":{"enum":["hardball","founder_friendly","herd","contrarian"]},"redFlags":{"$ref":"#/$defs/s80x8"},"pitchHooks":{"$ref":"#/$defs/s80x8"}}},
 "rails":{"type":"object","additionalProperties":false,"required":["rating","forbiddenTopics","never","deflectionStyle","mayReferenceRealEvents"],
  "properties":{"rating":{"enum":["T","M"]},"forbiddenTopics":{"$ref":"#/$defs/s80x24"},"never":{"type":"array","maxItems":24,"items":{"type":"string","maxLength":120}},
   "deflectionStyle":{"type":"string","maxLength":200},"mayReferenceRealEvents":{"type":"boolean"}}},
 "dialogue":{"type":"object","additionalProperties":false,"required":["modelTier","maxTurnsPerEncounter","ink","barkPool"],
  "properties":{"modelTier":{"enum":["haiku","sonnet"]},"maxTurnsPerEncounter":{"type":"integer","minimum":4,"maximum":20},
   "ink":{"type":"string","pattern":"^content(-private)?/npcs/[a-z0-9_/-]+\\.ink$"},"barkPool":{"type":"string","pattern":"^content(-private)?/npcs/[a-z0-9_/.-]+\\.json$"}}},
 "assetsPending":{"type":"boolean"},
 "provenance":{"type":"object","additionalProperties":false,"required":["authoredBy","generatedBy","reviewedBy","reviewedAt","contentSha256"],
  "properties":{"authoredBy":{"type":"string","maxLength":80},"generatedBy":{"type":["object","null"],"additionalProperties":false,"required":["model","date"],"properties":{"model":{"type":"string"},"date":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"}}},
   "reviewedBy":{"type":["string","null"]},"reviewedAt":{"type":["string","null"],"pattern":"^\\d{4}-\\d{2}-\\d{2}$"},"contentSha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}}}},
"allOf":[
 {"if":{"required":["origin"],"properties":{"origin":{"const":"user"}}},"then":{"properties":{"ownerProfileId":{"type":"string"},"tier":{"const":"fictionalized"},
   "likeness":{"properties":{"basis":{"const":"original"}}},"roles":{"properties":{"hero":{"const":false}}},"dialogue":{"properties":{"modelTier":{"const":"haiku"}}},"voice":{"properties":{"tier":{"enum":["text","t1"]}}}}}},
 {"if":{"required":["status"],"properties":{"status":{"const":"active"}}},"then":{"properties":{"provenance":{"properties":{"reviewedBy":{"type":"string"},"reviewedAt":{"type":"string"}}}}}},
 {"if":{"required":["roles"],"properties":{"roles":{"required":["fighter"],"properties":{"fighter":{"const":true}}}}},"then":{"required":["fighter"],"properties":{"stats":{"required":["fighter"]}}}},
 {"if":{"required":["roles"],"properties":{"roles":{"required":["tycoonActor"],"properties":{"tycoonActor":{"const":true}}}}},"then":{"required":["tycoon"],"properties":{"stats":{"required":["tycoon"]}}}},
 {"if":{"required":["dialogue"],"properties":{"dialogue":{"required":["modelTier"],"properties":{"modelTier":{"const":"sonnet"}}}}},"then":{"properties":{"roles":{"properties":{"hero":{"const":true}}}}}},
 {"if":{"required":["tier"],"properties":{"tier":{"const":"consented"}}},"then":{"properties":{"likeness":{"properties":{"basis":{"const":"real_person"},"consentRecordId":{"type":"string"},"consentScopes":{"minItems":1},"disclaimer":{"const":"courtesy"}}}}}},
 {"if":{"required":["tier"],"properties":{"tier":{"enum":["parody","fictionalized"]}}},"then":{"properties":{"likeness":{"properties":{"faceReferenceAllowed":{"const":false}}},"voice":{"properties":{"tier":{"enum":["text","t1","t2"]}}}}}},
 {"if":{"required":["tier"],"properties":{"tier":{"const":"parody"}}},"then":{"properties":{"knowledge":{"properties":{"realWorldRefs":{"enum":["none","public_record"]}}},
   "likeness":{"properties":{"basis":{"const":"real_person"},"nameDistanceOk":{"const":true},"disclaimer":{"const":"parody"},"deceased":{"const":false}}}}}},
 {"if":{"required":["tier"],"properties":{"tier":{"const":"fictionalized"}}},"then":{"properties":{"knowledge":{"properties":{"realWorldRefs":{"const":"none"}}},"likeness":{"properties":{"disclaimer":{"enum":["fictional","none"]}}}}}},
 {"if":{"required":["likeness"],"properties":{"likeness":{"required":["basis"],"properties":{"basis":{"const":"real_person"}}}}},"then":{"properties":{"standIn":{"type":"string"},"likeness":{"properties":{"subjectId":{"type":"string"}}}}}},
 {"if":{"required":["likeness"],"properties":{"likeness":{"required":["basis"],"properties":{"basis":{"const":"original"}}}}},"then":{"properties":{"tier":{"const":"fictionalized"},
   "likeness":{"properties":{"subjectId":{"const":null},"consentRecordId":{"const":null},"consentScopes":{"maxItems":0},"fameDomain":{"maxItems":0}}}}}},
 {"if":{"required":["voice"],"properties":{"voice":{"required":["tier"],"properties":{"tier":{"const":"t3"}}}}},"then":{"properties":{"tier":{"const":"consented"},"likeness":{"properties":{"consentScopes":{"contains":{"const":"voice_clone"}}}}}}}],
"$defs":{
 "npcId":{"type":"string","pattern":"^[a-z][a-z0-9_-]{2,47}$"},"poi":{"type":"string","pattern":"^poi\\.[a-z0-9.-]{3,64}$"},
 "r10":{"type":"integer","minimum":1,"maximum":10},
 "s40x6":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":40}},"s40x8":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":40}},
 "s80x6":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":80}},"s80x8":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":80}},
 "s80x24":{"type":"array","maxItems":24,"items":{"type":"string","maxLength":80}},
 "move":{"type":"object","additionalProperties":false,"required":["id","name"],"properties":{"id":{"type":"string","pattern":"^[a-z0-9_]{3,32}$"},"name":{"type":"string","maxLength":40},"input":{"type":"string","maxLength":24},"desc":{"type":"string","maxLength":200}}},
 "block":{"type":"object","additionalProperties":false,"required":["days","from","to","activity","place","interruptible","priority"],
  "properties":{"days":{"anyOf":[{"enum":["daily","weekdays","weekends"]},{"type":"array","minItems":1,"uniqueItems":true,"items":{"enum":["mon","tue","wed","thu","fri","sat","sun"]}}]},
   "from":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"to":{"type":"string","pattern":"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"},
   "activity":{"enum":["sleep","eat","work","perform","record","train","hustle","socialize","commute","shop","pitch","race","patrol","idle"]},
   "place":{"$ref":"#/$defs/poi"},"interruptible":{"type":"boolean"},"priority":{"type":"integer","minimum":0,"maximum":9}}},
 "likeness":{"type":"object","additionalProperties":false,"required":["basis","subjectId","consentRecordId","consentScopes","deceased","faceReferenceAllowed","fameDomain","nameDistanceOk","disclaimer"],
  "properties":{"basis":{"enum":["real_person","original"]},"subjectId":{"type":["string","null"],"pattern":"^subj_[0-9a-z]{6,40}$"},
   "consentRecordId":{"type":["string","null"],"pattern":"^consent_[0-9a-z]{8,40}$"},
   "consentScopes":{"type":"array","uniqueItems":true,"items":{"enum":["name","likeness_stylized","likeness_realistic","voice_designed","voice_clone","biography","catchphrases","marketing","merchandise","ugc_remix","cutscene"]}},
   "deceased":{"type":"boolean"},"faceReferenceAllowed":{"type":"boolean"},
   "fameDomain":{"type":"array","maxItems":6,"items":{"type":"string","pattern":"^[a-z_]{3,32}$"}},"nameDistanceOk":{"type":"boolean"},
   "disclaimer":{"enum":["courtesy","parody","fictional","none"]}}}}}
```

## Roster manifest

`content/npcs/roster.json` merged with `content-private/npcs/roster.json` by `pnpm npc:build`, validated by `npc-roster-1.0.schema.json` plus rules R1–R6 (unique ids, tier/basis/hero equal the frontmatter, real-derived entries have an `active` original `standIn`, ≤ 8 Sonnet entries, `rosterVersion` increases, `research: pending` stays `draft`). The build emits C07 asset `data/npc-roster` (`NpcRosterBundle`, active souls only, epoch-ms times).

```json
{"schema":"npc-roster/1","rosterVersion":3,"entries":[
 {"id":"npc_test","soul":"content/npcs/npc_test/soul.md","status":"active","tier":"fictionalized","basis":"original","hero":false,"pipeline":"none","priority":9,"research":"none","standIn":null,"modes":["story"]},
 {"id":"ro-batista","soul":"content/npcs/ro-batista/soul.md","status":"active","tier":"fictionalized","basis":"original","hero":true,"pipeline":"standard","priority":1,"research":"none","standIn":null,"modes":["story","racing"]},
 {"id":"canary-mc","soul":"content/npcs/canary-mc/soul.md","status":"active","tier":"fictionalized","basis":"original","hero":false,"pipeline":"standard","priority":2,"research":"none","standIn":null,"modes":["story","fighter"]}]}
```
