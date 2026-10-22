import type { LandmarkId, MissionIR, StringMatcher } from '@dv/shared';

export type CompileErrorCode =
  | 'E_SCHEMA' | 'E_REF_CAST' | 'E_REF_ZONE' | 'E_REF_LINE' | 'E_REF_LANDMARK' | 'E_OUT_OF_BOUNDS' | 'E_ROUTE_UNSNAPPABLE'
  | 'E_DEPICTION' | 'E_NAME' | 'E_NO_FALLBACK' | 'E_HOOK_STUB' | 'E_UNREACHABLE_STAGE' | 'E_BUDGET';

/** A compiler error: a code, the JSON Pointer of the offending node in the IR, and a message for the author. */
export interface CompileError {
  code: CompileErrorCode;
  pointer: string;
  message: string;
}

export interface EnuBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** What the compiler checks the IR against. The build tool fills it from `lines.<lang>.json`, `config/` and `content/`; tests pass small ones. */
export interface CompileEnv {
  /** `story` is the full IR; `mod` adds the restrictions of C09 section C12 item 2. */
  profile: 'story' | 'mod';
  /** The C08 play bounds in ENU metres (`config/world.bounds.json`); a lat/lng outside them is `E_OUT_OF_BOUNDS`. */
  bounds: EnuBounds;
  /** The bake id the IR is compiled for; written into `worldBake`. */
  worldBake: string;
  /** Keys of `lines.en.json`: line ids and the mission's own LocKeys. */
  lines: ReadonlySet<string>;
  /** Text of each key, for the names lint. */
  lineText?: Readonly<Record<string, string>>;
  /** Further LocKeys known to the UI catalogue (`packages/ui` en.json). */
  i18n?: ReadonlySet<string>;
  landmarks: ReadonlySet<LandmarkId | string>;
  /** DirectorScript ids a `beat` may name. */
  directors: ReadonlySet<string>;
  /** CutsceneRef ids and whether each has an in-engine fallback. */
  cutscenes?: ReadonlyMap<string, { fallback: boolean }>;
  /** The names lint: compiled real-side names (M00b) and the ip-denylist string matcher. */
  names?: readonly { id: string; re: RegExp }[];
  strings?: StringMatcher | null;
  /** True when the cast entry stands for a real person (a roster slot, or a soul whose likeness basis is `real_person`). */
  realDerived?(who: { soul: string } | { slot: string }): boolean;
  /** Compile-time route check (needs a resolver); absent in builds without a world. */
  routable?(via: readonly [number, number][]): boolean;
}

export interface CompileResult {
  ir: MissionIR;
  errors: CompileError[];
  /** Every line a `say` or `text` op speaks, with the speaker (soul id, `player` or `radio`). */
  audioNeeds: { line: string; speaker: string }[];
}
