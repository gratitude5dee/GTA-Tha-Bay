/**
 * C10 NPC contract, version 1.0.0: spec/domains/04-npc-contracts.md section B2, copied without shape changes.
 * Imports use the .ts extension. DialogueEvent meta.data.safety? (C10 1.1, DL-226) and C10_VERSION 1.1.0 arrive with M06a3.
 * Owner: S04. Change only through the Architect.
 */
import type { AssetRef, LikenessTier } from '../assets/c07.ts';
import type { StableKey } from './c01-ecs.ts';
export const C10_VERSION = '1.0.0' as const;

export type NpcId = string;                 // /^[a-z][a-z0-9_-]{2,47}$/ (B1 rule 4)
export type SoulVersion = number;           // integer ≥ 1 (fixed)
export type SoulTier = Exclude<LikenessTier, 'original'>;          // 'consented' | 'parody' | 'fictionalized'
export type LikenessBasis = 'real_person' | 'original';
export type { PoiId, DistrictId } from '../world/c08.ts';   // C08 owns both id spaces (DL-077): ^poi\.[a-z0-9.-]{3,64}$ and ^[a-z0-9-]{2,32}$
import type { PoiId, DistrictId, ChunkKey } from '../world/c08.ts';
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
  prompt: { key: string /* souls/<id>/<ver>/soul.prompt.txt */; sha256: string; tokens: number /* messages.count_tokens on claude-haiku-5-5 when a key is set, else M06a2's byte-bound estimate (DL-234) */ };
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

export interface MemoryWrite { kind: MemoryKind; text: string /* ≤ 240, paraphrased, PII-scrubbed */; importance: number /* 1–10 */;
  gameTime: number /* C06 half-seconds */; source: 'dialogue' | 'mission' | 'world' | 'summary'; embedding: Float32Array /* 1024, bge-m3 */ }
export interface MemoryHit { id: number; text: string; kind: MemoryKind; score: number }
export interface SummaryPatch { summaryUpdate: string /* ≤ 600 */; memories: Omit<MemoryWrite, 'embedding'>[] /* ≤ 5 */;
  affinityDelta: number; trustDelta: number; flagsPatch: Record<string, boolean | number | string>; soulVersion: SoulVersion; reflection: boolean }

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

