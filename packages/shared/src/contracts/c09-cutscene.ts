// C09 cutscene types: spec/domains/03-story-cutscenes.md section D2, copied without changes (M05b1 creates the file because M04c has not landed).
// packages/shared/src/contracts/c09-cutscene.ts  (C09_VERSION re-exported from c09-mission.ts)
import type { LineId, CastName, LatLngTuple } from './c09-mission.ts';
import type { LandmarkId } from '../world/c08.ts';
import type { LikenessTier, AssetRef } from '../assets/c07.ts';   // LikenessTier: consented | parody | fictionalized | original (C07)

export type CutsceneHook = 'story.establish' | 'story.beat' | 'fight.walkin' | 'fight.faceoff' | 'fight.special'
  | 'fight.super' | 'fight.shutdown' | 'fight.ending' | 'race.intro';
export type CutsceneRefId = `cut.${string}`;   // cut.story.<missionId>.<beat> · cut.fight.walkin.<char>.<stage> · cut.fight.faceoff.<a>.<b>
                                               // cut.fight.<special|super|shutdown>.<char>.<move> · cut.fight.ending.<char> · cut.race.intro.<raceId>
export interface CueSpec { line: LineId; speaker?: string /* soul id */; startMs: number; endMs: number; kind: 'dialogue' | 'sdh' }
export interface CutsceneRef {
  id: CutsceneRefId; hook: CutsceneHook;
  template: `${string}@${number}`;             // content/prompts/genai/<name>@<n>.md
  cast: string[];                              // soul ids, sorted; never the player avatar or a user NPC
  stage: string | null;                        // `<stageId|beat.<refId>|race.<raceId>>@<ver>`
  move: string | null;                         // `<moveId>@<ver>` (fighter hooks)
  slots: Record<string, string>;               // authored slot text (§D4), versioned by the beat revision
  fallback: string;                            // DirectorScript id; required
  cues: CueSpec[];                             // shared by video and fallback
  audio: 'engine' | 'generated-ambient';       // §D7
  prefetch: 'onTrigger' | 'onObjective' | 'onSelect' | 'none';
  priority: 1 | 2 | 3 | 4;                     // prewarm order (§D9)
  skippable: true;
}
export interface CutsceneKeyInput {             // A-03, exactly these eight properties
  template: `${string}@${number}`;
  characters: { id: string; soulVersion: number; likenessTier: LikenessTier }[];  // sorted by id, unique
  move: string | null; stage: string | null;
  style: `${string}@${number}`;                // style bible, e.g. 'bay-cel@1'
  endpoint: `${string}@${string}`;             // endpointId@pinnedUpdatedAt from config/genai-endpoints.json
  seed: number;                                // u32
  inputHashes: string[];                       // sorted lowercase SHA-256 of input files, never URLs
}
/** sha256Hex(canonicalize(normalizeKeyInput(i))) — packages/shared/src/genai/cutscene-key.ts; pure and synchronous. */
export declare function cutsceneKey(i: CutsceneKeyInput): string;
export declare function normalizeKeyInput(i: CutsceneKeyInput): CutsceneKeyInput;   // sorts, dedupes, lowercases; throws on bad input

export interface CutsceneIndexEntry {
  ref: CutsceneRefId; key: string; keyInput: CutsceneKeyInput; provider: string /* registry provider key */;
  characters: { id: string; soulVersion: number; tier: LikenessTier }[];
  durationMs: number; fallback: string; cues: CueSpec[]; audio: CutsceneRef['audio']; stale?: true;
}
export interface CutsceneIndex {                // shipped as C07 asset data/cutscene-index; rows also feed S09's cutscene_catalog
  schema: 'cutscene-index/1'; release: string; builtAt: number; entries: CutsceneIndexEntry[];
}
export interface ShotPlan {                     // private; S05's keyframe + video steps consume it
  shotId: string; durationS: 6 | 7 | 8 | 9 | 10; prompt: string; keyframePrompt: string;
  inputs: { role: 'style' | 'sheet' | 'plate' | 'keyframe'; sha256: string; subject?: string }[];
  camera: 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit' | 'tracking'; subjects: string[];
}
export interface CutsceneRequest {               // private build artifact cutscene-requests.json → prewarm → GenJob(kind 'cutscene_shot')
  schema: 'cutscene-request/1'; key: string; keyInput: CutsceneKeyInput; ref: CutsceneRefId; hook: CutsceneHook;
  templateSha256: string; shots: ShotPlan[]; cues: CueSpec[]; audio: CutsceneRef['audio'];
  characters: CutsceneIndexEntry['characters']; priority: CutsceneRef['priority']; budgetUsdMicros: number;
}
export interface Rendition { file: string /* relative to cutscenes/<key>/ */; bytes: number; sha256: string; codecs: string; kbps: number }
export interface CutsceneManifest {              // R2 cutscenes/<key>/manifest.json, written last (06 §4.4 fixed)
  schema: 'cutscene-asset/1'; key: string; recipe: 'cut@1';
  fps: 24; frames: number; width: number; height: number;
  renditions: Partial<Record<'v540' | 'v768' | 'v1080' | 'p720', Rendition>>;  // p720 only with degraded: true
  audio?: { file: 'a.m4a'; lufs: number; speechDetected: boolean; approvedBy?: string };   // optional: absent when the ref's audio is 'engine' (06 v1.1 C09 line, DL-082)
  poster: 'poster.webp'; last: 'last.webp'; subs: Record<string /* BCP 47 */, string /* subs.<lang>.vtt */>;
  shots: { shotId: string; startFrame: number; frames: number }[];
  characters: { id: string; soulVersion: number; tier: LikenessTier }[];
  licence: { gate: 'ADR-GENAI-01'; provider: string; status: 'cleared' | 'pending'; termsSnapshotSha256: string[];
    clearedBy?: string; clearedAt?: number; uiCredit?: string };
  provenance: { endpoint: string; pinnedUpdatedAt: string; requestIds: string[]; origSha256: string;
    c2pa: 'valid' | 'valid-untrusted' | 'absent' | 'invalid'; resigned: boolean; aiGenerated: true };
  degraded?: true;
}
// HTMLVideoElement below resolves through the type-only shim packages/shared/src/contracts/dom-media.d.ts (no DOM lib in @dv/shared; DL-232)
export interface PreparedClip {                 // 06 §4.4 fixed minimum (DL-061) + S03 fields
  key: string;
  source: { kind: 'element'; video: HTMLVideoElement } | { kind: 'decoder'; url: string; codec: string };
  width: number; height: number; durationMs: number;
  cues: { startMs: number; endMs: number; text: string }[];
  degraded: boolean;
  aiGenerated: true; uiCredit?: string; posterUrl: string; lastUrl: string;
}
export type CutsceneHostKind = 'dom-overlay' | 'xr-media-layer' | 'xr-texture' | 'webcodecs-texture';
export type FallbackTrigger = 'not_ready' | 'not_permitted' | 'media_error' | 'start_stall' | 'mid_stall'
  | 'codec' | 'budget' | 'policy' | 'offline' | 'degraded_sequence' | 'setting_off';
export type CutsceneOutcome = { path: 'video' | 'fallback' | 'instant'; skipped: boolean; trigger?: FallbackTrigger };
export interface CutscenePlayer {               // packages/engine/src/client/cutscene/ (S03, main thread)
  /** Resolve refs via the index, roster flags and route 27; fetch manifests; pick host and rendition; never throws. */
  prepare(playId: string, refs: CutsceneRefId[]): Promise<{ clips: PreparedClip[] } | { fallback: FallbackTrigger }>;
  play(playId: string, clips: PreparedClip[]): Promise<CutsceneOutcome>;
  /** Mixed sequences (fight intros, DL-081): items play back to back; an item whose ref is null, suppressed or not ready plays its
   *  DirectorScript in-engine; the sim is told per item through UiCommand {t:'cutscene.state', playId, item, state}. Never throws. */
  playSequence(playId: string, items: { ref: CutsceneRefId | null; fallback: string /* DirectorScript id */ }[]): Promise<CutsceneOutcome[]>;
  skip(playId: string): void;
  prefetch(refs: CutsceneRefId[]): void;        // manifest, poster, audio; ≤ 2 ahead on mobile tiers
}

export interface DirectorScript {               // content/missions/<id>/director/<beat>.ts → data/director.<id>; also S06/S07 sequences
  schema: 'director/1'; id: string; durationSec: number; seed: number;
  marks: Record<string, { at: LatLngTuple | { landmark: LandmarkId } | { local: [number, number, number] }; yawDeg: number }>;
  actors: { who: CastName | 'player' | `soul:${string}`; start: string; end: string; prefab?: string }[];
  shots: DirectorShot[];                        // sorted by atSec; first shot at 0
  actions: { atSec: number; who: string; do: 'moveTo' | 'runTo' | 'driveTo' | 'anim' | 'look' | 'enter' | 'exit'; arg: string }[];
  cues: CueSpec[];
  xrVantage: { mark: string; yawDeg: number };  // XR: fixed vantage, no cuts (C04 rule 5)
  letterbox: boolean; music?: AssetRef; frame?: 'world' | 'stage2d';  // stage2d = fighter side view
}
export interface DirectorShot {
  atSec: number; preset: 'establish' | 'two-shot' | 'over-shoulder' | 'single' | 'insert' | 'reaction' | 'tracking' | 'orbit' | 'auto';
  subject: string; secondary?: string; from?: string /* mark */; lens: 'wide' | 'normal' | 'tele';
  move?: 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit';
}
