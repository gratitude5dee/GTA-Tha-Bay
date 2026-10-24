import type { MissionCheckpointV1, MissionId, MissionIR, ObjectiveDef, StorySlice } from '@dv/shared';
import type { CutsceneOutcome, DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import type { ResolvedMission } from '../compiler/resolve.ts';

/** Commands from outside the sim tick (C09 section 3, `StoryCommand`); applied at the start of the next Script stage and recorded. */
export type StoryCommand =
  | { name: 'mission.start'; id: MissionId }
  | { name: 'mission.retry' }
  | { name: 'mission.quit' }
  | { name: 'talk.result'; talkId: string; outcome: string; turns: number; path: 'llm' | 'ink' | 'scripted' }
  | { name: 'cut.state'; playId: string; state: 'video' | 'fallback' | 'done'; item?: number; trigger?: string; outcome?: CutsceneOutcome }
  // QA debugger (never sent by a production page)
  | { name: 'debug.jump'; stage: number }
  | { name: 'debug.pass' }
  | { name: 'debug.fail' }
  | { name: 'debug.flag'; key: string; value: boolean | number | string };

/** How a QA build forces the paths that need a network, a device or another mode (`?hooks`, `?talk`, `?beats`). */
export interface RuntimeFlags {
  /** `stub`: mode hooks always run their stub; `real`: the child mode is tried first; `bot`: as real (the bot is M05a2). */
  hooks: 'real' | 'stub' | 'bot';
  /** `scripted`: a talk objective applies `TalkDef.default` at once with path `scripted`. */
  talk: 'live' | 'scripted';
  /** `instant`: a beat completes in one tick; `normal`: the director's shot holds for the script's duration. */
  beats: 'normal' | 'instant';
}
export const DEFAULT_FLAGS: RuntimeFlags = { hooks: 'real', talk: 'live', beats: 'normal' };

export interface RuntimeOptions {
  flags?: Partial<RuntimeFlags>;
  /** DirectorScripts by id, for `beat` ops and the intro/outro. */
  directors?: ReadonlyMap<string, DirectorScript>;
  /** CutsceneRefs by id (M05b2): the fallback DirectorScript a `{cutscene}` beat arms. A ref that is not here plays as an instant beat. */
  cutscenes?: ReadonlyMap<string, { fallback: string }>;
  /** The next u32 play counter of the session (`cut.request` `n`); the story mode shares one across missions. Default: one per runtime. */
  playCounter?(): number;
  /** The live story slice (flags, wallet, missions, relations, `activeMission`). */
  story(): StorySlice;
  /** `ProfileSettings.accessibility.timerScale` (1, 1.25, 1.5 or 2). */
  timerScale?(): number;
  /** Comfort settings for the director: reduced motion (`ProfileSettings.accessibility`) and the XR camera mode. Default: both off. */
  comfort?(): { reducedMotion: boolean; xr: boolean };
  /** The story seed (`StorySlice.world.seed`); part of the mission RNG seed. */
  storySeed?(): number;
  /** The display text of a line id, for the duration of a `say` (the length of the text decides how long it holds). Default: the id. */
  lineText?(id: string): string;
  /** A `text` op ran (a phone message from a soul, M05c2): the story mode keeps the session's threads for the Messages app. */
  onText?(from: string, line: string, tick: number): void;
  log?(line: string): void;
}

/** What a retry carries over from the failed run: the mission's own changes that the checkpoint restore has to take back. */
export interface Carry {
  walletDelta: number;
  revokeGen: number;
  touchedFlags: Set<string>;
  first: MissionCheckpointV1 | null;
}

export interface StartOptions {
  attempt: number;
  seed: number;
  from?: MissionCheckpointV1;
  /** Set by a retry only. */
  carry?: Carry;
}

/** A mission the runtime can run: the resolved IR plus the DirectorScripts it names. */
export interface Loaded {
  rm: ResolvedMission;
  ir: MissionIR;
}

export type ObjState = 'pending' | 'active' | 'done' | 'failed';

export interface ObjRt {
  def: ObjectiveDef;
  state: ObjState;
  /** Mission clock tick at which the objective became active. */
  since: number;
  threadId: string;
  /** Free state of the objective kind (hold timers, counters). */
  data: Record<string, number>;
}

export interface CastRt {
  name: string;
  key: `mis:${string}:${string}`;
  /** True after a `spawn` (or the start spawn) and until a `despawn`. */
  live: boolean;
  /** Collected into the player's hands (`collect`): the entity is gone but the cast entry counts as carried. */
  carried: boolean;
  /** True once the entity was seen in the world (a spawn takes effect one stage later). */
  seen: boolean;
}

export type EndRequest = { k: 'pass' } | { k: 'fail'; reason: string };

