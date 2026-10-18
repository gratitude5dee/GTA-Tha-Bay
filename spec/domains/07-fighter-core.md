# 07 — Fighter (S07), part B: fighting core

> S07, Wave 3, 2026-10-18. Part of `spec/domains/07-fighter.md` (hub: §1 scope and checklist, §2 design, §3 components, §6–§10). This part holds §4 Data (core types) and §5 Runtime (core rules, CPU, tools, rollback notes). Other parts: `07-fighter-content.md` (roster, stages, cutscenes, assets), `07-fighter-pose.md` (pose mode). Honors `prompt-pack/06-SHARED-CONTEXT.md` v1.0 (C01, C02, C03, C04, C05, C06, C07, C09, C10, C13), `spec/03` D-12, D-13, D-29, D-30. Section ids `FC1…FC12` are cited by the other parts. Design values marked † are S07 starting values to tune (FC11); none is an external fact.

## FC1 Conventions (binding on every fighter module)

1. **Units.** The fight plane is 2D. `u` = 1/1000 fight-metre, `+x` right on screen, `+y` up, ground `y = 0`. All state in the fight buffer is `i32`. Stage half-width 6,000 u; maximum fighter separation 7,000 u; round-start positions ±1,500 u [`config/fighter.tuning.json`].
2. **Frames.** One sim tick = one frame (60 Hz, C02 `SIM_DT`). Frame 1 is the first frame of a move. `startup` S is the number of the first active frame (S counts it, the convention [research/gamedesign-decomposition.md §4.2] asks the spec to state). Active frames are `S … S+A−1`; `recovery` R frames follow; total `T = S − 1 + A + R`; the fighter is actionable on frame `T + 1`. Advantage assumes contact on the first active frame, hitstop equal for both sides:
   `advHit = hitstun − (A + R − 1)`, `advBlock = blockstun − (A + R − 1)`.
   `onHit` and `onBlock` are therefore **derived**, never authored; `fighter:lint` recomputes them and the training-mode frame meter prints the derived value.
3. **Notation.** Numpad, facing-relative: 5 neutral, 6 toward opponent, 4 away, 8 up, 2 down. `236` quarter-circle forward, `214` quarter-circle back, `623` forward-down-forward, `[4]6` charge back then forward. Buttons: `L M H` per limb (`LP MP HP LK MK HK`), `SP` special, `AS` assist, `HY` hype, `TA` taunt, `BL` block, `DA` dash.
4. **Math.** Code under `packages/shared/src/fight/**` and `packages/modes/fighter/src/sim/**` is sim code under the C02 lint. Only `+ − × ÷`, `abs min max floor ceil round trunc sign imul` are used. Capsule tests compare squared distances (no `sqrt`). Sine paths read a 64-entry integer table `SINE64`. The fight core needs no `detmath` transcendental (D-12 "fighter on detmath frame data" is met by integer frame data under the same lint). Percent maths is `trunc(value × pct / 100)`; all intermediates stay below 2^53, so doubles are exact [C02 determinism rules 1–2; research/gamedesign-decomposition.md §0, MDN claim in hub §7].
5. **Profile.** The fighter uses no physics, so its descriptor declares `simProfile: 'any'`. This lets story embed it under a `local` parent without `SimHost.restart` (C06 ModeHost rule 2). Determinism comes from FC1.4, not from Rapier (D-12).
6. **RNG.** The match owns two xoshiro128** states in the buffer (`fight`, `cpu`), seeded `splitmix32(seed ^ fnv32(name))` per C02 rule 3. No module keeps a private generator.

## FC2 Data (TypeScript, normative)

```ts
// packages/shared/src/fight/types.ts — pure; C02 lint applies; FIGHT_DATA_VERSION bumps on any layout change
export const FIGHT_DATA_VERSION = 1 as const;
export type U = number;                                         // i32 fight unit (1/1000 fm)
export interface Capsule2 { x1: U; y1: U; x2: U; y2: U; r: U }  // fighter-local, +x toward the opponent, mirrored by facing
export interface Aabb2 { x: U; y: U; w: U; h: U }
export type Guard = 'high' | 'mid' | 'low' | 'overhead' | 'unblockable' | 'throw';
export type SchemeId = 'classic' | 'simple' | 'pose';
export type MoveKind = 'normal' | 'command' | 'air' | 'special' | 'super' | 'throw' | 'auto' | 'shutdown' | 'taunt';
export type SlotId = 'RAP_HYPHY_ELDER' | 'RAP_LYRICIST' | 'RAP_NEW_WAVE' | 'RAP_COLLECTIVE' | 'TECH_VISIONARY' | 'TECH_HACKER'
  | 'TECH_VC' | 'ATH_SHOOTER' | 'ATH_POWER_BACK' | 'INFLUENCER' | 'PLAYER_FIGHTER';   // USER_NPC uses template kits (FX1)
export type FighterId = string;                                 // soul id = C07 asset slug; PLAYER_FIGHTER = 'player'

export interface HitDef {
  boxes: Capsule2[];                                            // active hit capsules, local space
  group: number;                                                // u8: one connect per group per move instance unless `multi`
  multi?: { every: number; max: number };                      // re-hit every N frames, at most `max` times
  damage: number; chipPermille: number;                         // chip = trunc(damage × chipPermille / 1000), 0 for normals unless Rattled
  hitstun: number; blockstun: number; hitstop: number;          // frames
  pushHit: U; pushBlock: U;                                     // total distance, applied over PUSH_FRAMES
  guard: Guard;
  launch?: { vx: U; vy: U; kd: 'soft' | 'hard' };               // u per frame; absent = grounded hit reaction
  juggle: { cost: number; limit: number };
  hype: { hit: number; block: number; whiff: number };         // gains in Hype points (1,000 = one stock)
  fx: { spark: 'light' | 'medium' | 'heavy' | 'special' | 'super'; cue: string };   // presentation only, not hashed
}
export interface BoxTrack {                                     // per-frame-range boxes; omitted ranges use the state default
  from: number; to: number;                                     // inclusive move frames
  hurt?: Capsule2[]; push?: Aabb2; throw?: Aabb2;
}
export interface MoveDef {
  id: string;                                                   // unique within the kit; clip name in anim/<slug>.moves = id
  nameKey: string; kind: MoveKind;                              // LocKey; shipped names are original (FX2)
  input: InputPattern; schemes: SchemeId[];
  startup: number; active: number; recovery: number;
  hits: { from: number; hit: HitDef }[];                        // `from` = first move frame this HitDef is live
  tracks: BoxTrack[];
  invuln: { from: number; to: number; kind: 'strike' | 'projectile' | 'throw' | 'all' }[];
  armor?: { from: number; to: number; hits: number };           // absorbs N strike hits without hitstun
  motion?: { frame: number; vx: U; vy: U }[];                   // data-driven root motion, u per frame from that frame on
  cancels: { into: 'chain' | 'special' | 'super' | 'jump' | 'dash'; on: ('hit' | 'block' | 'whiff')[]; from: number; to: number }[];
  hypeCost?: 0 | 1000 | 2000 | 3000;                            // EX 1,000; L2 super 2,000; Showstopper 3,000
  ex?: Partial<HitDef> & { startup?: number };                  // EX overrides (damage ×EX_DMG_PCT unless set)
  spawn?: ProjectileSpawn[];
  tags: string[];                                               // checked against config/fame-domains.json (FX4)
  cutscene?: { hook: 'special' | 'super' | 'shutdown'; template: string };
  gesture?: PoseGestureId;                                      // pose-mode trigger (FP3)
  lockFrames?: number;                                          // presentation: frames the clip is frame-locked
}
export interface ProjectileSpawn {
  frame: number; def: string; ox: U; oy: U;                     // spawn frame in the move, offset from the fighter
}
export interface ProjectileDef {
  id: string; behavior: 'linear' | 'sine' | 'arc' | 'trap' | 'orbit' | 'summon';
  speed: U; life: number; hits: number;                         // speed u/frame; life frames; max connects
  hit: HitDef; power: number;                                   // clash: higher power wins, equal destroys both
  sine?: { amp: U; period: number };                            // 'sine' path via SINE64
  arc?: { vy: U; gravity: U };
  summon?: { moveSet: string; hypeCost: number };               // 'summon' (crew assist): scripted move list
}
export interface FighterDef {                                   // a KIT: frame data bound to a slot, not to a person
  slot: SlotId; kit: string; archetype: string;
  health: number;                                               // default 10,000
  walk: { f: U; b: U }; dash: { f: { frames: number; dist: U }; b: { frames: number; dist: U } };
  jump: { pre: number; v0: U; gravity: U; vxF: U; vxB: U; land: number };
  push: { stand: Aabb2; crouch: Aabb2; air: Aabb2 };
  hurtDefault: Record<'stand' | 'crouch' | 'air' | 'down', Capsule2[]>;
  moves: MoveDef[]; supers: MoveDef[]; shutdown: MoveDef; taunt: MoveDef;
  autoCombo: string[];                                          // Simple-scheme AS routine, move ids in order
  projectiles: ProjectileDef[];
  gimmick?: { id: string; params: Record<string, number> };     // FX2 table; state lives in gimmick words 0–3
  ai: AiProfile;                                                // FC10
}
export interface AiProfile {
  aggression: number; zoning: number; antiAir: number; throwRate: number; blockRate: number; shutdownRate: number;   // 0..100
  reaction: [number, number];                                   // frames, min and max before difficulty scaling
  habits: string[];                                             // named habit ids from content/fighter/ai/habits.json
}
export type PoseGestureId = 'jab' | 'cross' | 'hook' | 'uppercut' | 'frontKick' | 'lowKick' | 'guard' | 'crouch' | 'jump' | 'push';
export type InputPattern =                                      // parsed once at load into a transition table
  | { t: 'button'; buttons: number; dir?: 5 | 2 | 6 | 4 | 8 | 3 | 1 | 9 }
  | { t: 'motion'; seq: ('236' | '214' | '623' | '41236' | '63214' | '22' | '66' | '44' | '360') ; buttons: number }
  | { t: 'charge'; hold: 4 | 2 | 1; release: 6 | 8 | 9; frames: number; buttons: number }
  | { t: 'chord'; buttons: number };

/** Content-compiled, immutable per build: its SHA-256 (canonicalize + sha256Hex, C09 helpers) is `frameDataHash`. */
export interface FrameDataPack { v: typeof FIGHT_DATA_VERSION; kits: Record<SlotId, FighterDef>; tuning: FightTuning; hash: string }
```

```ts
// packages/shared/src/fight/input.ts
export const enum FB {                       // FighterInput bits (u16); the only input the fight core reads
  Up = 1 << 0, Down = 1 << 1, Left = 1 << 2, Right = 1 << 3,       // screen-absolute; facing applied inside the core
  LP = 1 << 4, MP = 1 << 5, HP = 1 << 6, LK = 1 << 7, MK = 1 << 8, HK = 1 << 9,
  SP = 1 << 10, AS = 1 << 11, HY = 1 << 12, TA = 1 << 13, BL = 1 << 14, DA = 1 << 15,
}
export type FighterInput = number;           // u16
/** The sim boundary maps C03 InputFrame → FighterInput in 'fighter' context (FC5.1). Pure. */
export declare function fromInputFrame(f: import('../contracts/c03-input').InputFrame): FighterInput;
```

```ts
// packages/shared/src/fight/buffer.ts — authoritative match state; Int32Array, no per-tick allocation
export const FIGHTER_WORDS = 64, PROJ_WORDS = 16, PROJ_MAX = 16, RING = 32;
export const enum FF {                       // per-fighter word index (offset = FighterBase[slot] + FF.x); 0..47 defined, 48..63 reserved
  X, Y, VX, VY, Facing, State, StateFrame, Move, MoveFrame, Hp, Hype, Composure, Rattled, Hitstun, Blockstun, Hitstop,
  ComboHits, JuggleLeft, Knockdown, Invuln, ArmorLeft, CancelMask, MoveResult, GroupsDone, ViaSimple, Ex, ChargeBack, ChargeDown,
  DashFrames, WakeFrames, TechTimer, BufMove, BufAge, ProjActive, Gimmick0, Gimmick1, Gimmick2, Gimmick3, CheckTimer,
  ClearUsed, TauntTimer, ComboDamage, LastHitBy, CounterFlag, AiGoal, AiTimer, AiMacro, AiMacroStep,
}
export const enum FM {                       // match header words
  Tick, Phase, PhaseFrame, Round, RoundsWon0, RoundsWon1, Timer, Winner, SlowDiv, CinematicLeft, ShutdownWho,
  Seed, FrameDataHashLo, FrameDataHashHi, RulesFlags, Reserved,
}
// layout: header(16) · fighter0(64) · fighter1(64) · projectiles(16×16) · rng fight(4) · rng cpu(4) · ring0(32) · ring1(32) · aiPerception ring(2×16)
// total ≈ 1,000 words ≈ 4 KB; snapshot() = one Int32Array.slice(); restore() = set(). Target ≤ 0.05 ms.
export interface FightSim {
  init(pack: FrameDataPack, rules: FightRules, seed: number, lineup: [FighterLoadout, FighterLoadout]): Int32Array;
  step(buf: Int32Array, in0: FighterInput, in1: FighterInput, ev: FightEventSink): void;   // one tick; pure given inputs
  hash(buf: Int32Array): [number, number];                      // FNV-1a-64 lanes via Math.imul over every word except presentation counters
  snapshot(buf: Int32Array): Int32Array; restore(buf: Int32Array, snap: Int32Array): void;
}
export interface FighterLoadout { slot: SlotId; fighterId: FighterId; scheme: SchemeId; autoBlock?: boolean; costume: number }
export interface FightRules {
  roundsToWin: 1 | 2 | 3; timerFrames: number | 0;             // 0 = infinite (Versus, Training)
  simpleDmgPct: number;                                         // 80 default
  leniencyX100: number;                                         // 100 default; 150 on 30 fps render tiers; 200 pose (FP5); 100 forced online
  cpuLevel: [0 | 1 | 2 | 3 | null, 0 | 1 | 2 | 3 | null];         // per slot; null = human
  training: boolean; shutdowns: boolean; cinematics: 'off' | 'first' | 'always';
}
/** Presentation events: derived each tick, never hashed, de-duplicated by (tick, kind, slot) so rollback can re-emit. */
export interface FightEventSink { push(e: { tick: number; kind: 'hit' | 'block' | 'check' | 'whiff' | 'ko' | 'super' | 'round' | 'cue'; slot: 0 | 1; x: U; y: U; a: number; b: number }): void }
```

**ECS mirror (C01 ids 1280–1535, owner S07).** The authoritative state is the buffer; ECS carries a projection for render and the engine hash.

| Id | Component | Fields | hashed | snapshot |
|---|---|---|---|---|
| 1280 | `FighterView` | slot u8, state u16, move u16, frame f32, facing i8, hitFlash u8 | no | render+net |
| 1281 | `FightDigest` (singleton) | lo u32, hi u32, tick u32 | **yes** | none |
| 1282 | `ProjectileView` | kind u8, owner u8, frame u16 | no | render |
| 1283 | `StageProp` | prop u16, phase f32 | no | render |
| 1284–1535 | reserved | | | |

`FightDigest` is rewritten every tick from `FightSim.hash`, so the C02 `stateHash` covers the match without a new engine hook. Fighters are entities with `StableKey` `npc:<fighterId>` (the player: `player:0`); projectiles are `pfb:fx:<serial>`.

**Fighter slice (C05 slot `mode:fighter`, schema 1).**

```ts
// packages/modes/fighter/src/sim/slice.ts
export interface FighterSlice {
  schema: 1;
  unlockedFighters: FighterId[];                                // mirrors UnlockDef.grants.fighters
  fighterXp: Record<FighterId, number>;                         // cosmetic unlocks only, never stats
  cosmetics: string[];
  arcade: Record<FighterId, { cleared: boolean; bestTimeSec?: number; bestDifficulty?: 0 | 1 | 2 | 3 }>;
  settings: { scheme: 'classic' | 'simple'; inputDisplay: boolean; difficulty: 0 | 1 | 2 | 3; cinematics: 'off' | 'first' | 'always';
              seenReveal: Record<FighterId, boolean>; hybridPose: boolean };
  lastLoadout: { slot: SlotId; costume: number } | null;
}
```
Pose calibration is **not** in this slice (FP4: device-local store).

**Replay (`.dvfight`, JSON, produced by the QA bridge and CI).** `{ v:1, build, frameDataHash, fightDataVersion:1, seed, rules, lineup, stage, inputs: [base64 RLE of u16 per tick] × 2, checkpoints: { every: 60, hashes: [lo,hi][] }, final: {winner, rounds} }`. Verification re-simulates and compares every checkpoint.

**Starting constants (`config/fighter.tuning.json`, †).**

| Group | Values |
|---|---|
| Input | `RING 32`, `MOTION_WINDOW 12`, `BUTTON_LEEWAY 4`, `BUFFER_NORMAL 4`, `BUFFER_SPECIAL 4`, `DASH_TAP_WINDOW 10`, `CHARGE_FRAMES 45`, `CHARGE_GAP 3`, `THROW_TECH 7`, `SIMPLE_DMG_PCT 80` |
| Movement | `PUSH_FRAMES 8`, `GRAVITY 9`, `JUMP_V0 200`, `PREJUMP 4`, `LAND 3`, `WAKEUP 24`, `QUICKRISE 18`, `WAKE_THROW_INVULN 6` |
| Combo | scale % by hit `[100,100,80,70,60,50,40,30]` (floor 30), `L2_MIN 40`, `L3_MIN 50`, `HITSTUN_DECAY 1` per hit (floor 50 % of base), `MAX_COMBO_HITS 40`, `COUNTER_HITSTUN +2`, `COUNTER_DMG_PCT 110` |
| Meters | `HEALTH 10000`, `HYPE_MAX 3000`, `STOCK 1000`, `COMPOSURE_MAX 6000`, `COMP_REGEN 6/frame after 30 idle frames`, `CHECK_COST 600`, `CLEAR_COST 2000`, `RATTLED_EXIT 3000`, `HYPE_ON_DAMAGE_PCT 10`, `TAUNT_HYPE 300`, `EX_DMG_PCT 120`, `CHIP_KILLS true` |
| Rounds | `TIMER 5940` (99 s), `READY 60`, `KO_SLOW 30` at 1/3 speed, `SHUTDOWN_WINDOW 90`, `CINEMATIC_HOLD 300`, `SUDDEN 1800`, `INTRO_INGAME 300` |
| Hitstop | `L 8`, `M 10`, `H 12`, special 12, super freeze 45 |

## FC3 Tick order and match phases

`FightSim.step` runs once per sim tick inside `GameModeSim.tick` (SimStage.Script, C02). The mode then mirrors the buffer to ECS in the same tick and publishes the camera directive (FC8). One tick, in this order:

1. **Phase gate.** `FM.Phase` decides which of the steps below run (table below). `FM.SlowDiv` = 3 during KO slow-motion: the fight steps on every third tick (deterministic sub-stepping; real-time scaling is not allowed outside sandbox, C02 rule 4).
2. **Input ingest.** Both `FighterInput`s enter the 32-entry rings with the facing-relative numpad direction computed at that frame; rising edges are derived from the previous entry.
3. **Hitstop.** A fighter with `Hitstop > 0` skips steps 4–6, still ingests input and buffers, and decrements. Both sides of a connect receive the same hitstop.
4. **Intent.** Per fighter, slot order 0 then 1, but each decision reads only the state at the start of the tick: buffered input, cancel windows and the motion parser pick a transition (FC4, FC5).
5. **Advance.** Apply the transition, advance `StateFrame`/`MoveFrame`, apply `motion`/gravity, step projectiles (FC9).
6. **Boxes, detect, resolve, apply** (FC6), then pushbox separation, wall clamp, facing swap, timers, meters, KO check.
7. **Publish.** Events to the sink; `hash()` into `FightDigest`; mirror to `FighterView`/`ProjectileView`; `CameraDirective` (FC8).

| Phase | Frames | Sim runs | Input | Exits |
|---|---|---|---|---|
| `Load` | — | no | menu | assets ready (`ctx.assets.ready`) |
| `Intro` | in-engine 300, or the composed cutscene (FX6) | no | any attack button skips | end or skip |
| `Ready` | 60 | positions reset, no hits | locked | → `Fight` |
| `Fight` | ≤ `TIMER` | full | full | KO, time-out |
| `Ko` | 30 at 1/3 speed | winner/loser resolve, no new hits | locked | final round → `Shutdown`, else `RoundEnd` |
| `TimeUp` | 60 | freeze, compare health | locked | `RoundEnd` |
| `Shutdown` | 90 window, then the finisher | victim slumped | winner: `HY` | finisher (through `Cinematic` when eligible) or window end → `MatchEnd` |
| `Cinematic` | `CINEMATIC_HOLD` 300 fixed | counters tick only | any attack button skips | frames elapse or skip (an input, so replays match) |
| `RoundEnd` | 120 | no | locked | next `Ready` or `MatchEnd` |
| `MatchEnd` | 180 | no | menu | `ModeResult` |

`Cinematic` is entered only for clips the player may see (FX6.5). Its length is a constant, so the sim never depends on video playback: the presentation holds the last frame (`last.webp`) if the clip is shorter and cuts if longer.

## FC4 Fighter states

State ids are the sim's; each maps to a presentation `AnimStateId` in the S07 block 160–207 (FX7). A transition table is generated from this list at load; data cannot add states.

| Group | States (enumerated in `states.ts`) | Notes |
|---|---|---|
| Ground neutral | `Idle`, `WalkF`, `WalkB`, `Crouch`, `CrouchDown`/`StandUp` (3 f each), `DashF`, `DashB`, `Taunt` | actionable except dash frames and taunt |
| Air | `PreJump` (4 f, throwable), `JumpN/F/B`, `Fall`, `Land` (3 f), `AirAttack` | air blocking does not exist |
| Attack | `Attack` (normals, commands, air), `Special`, `Super` (45-frame freeze then move), `Throw`, `Auto` | the move id lives in `FF.Move`, the clock in `FF.MoveFrame` |
| Defence | `BlockStand`, `BlockCrouch`, `Check` (parry), `CheckSuccess`, `Clear` (burst) | `Check`: startup 1, active window 8, whiff recovery 20, success recovery 8 |
| Reaction | `HitStand`, `HitCrouch`, `HitAir` (launched), `Thrown`, `TechThrow`, `Knockdown` (soft or hard), `Wakeup`, `QuickRise`, `Rattled` | `Rattled` is a flag over any actionable state |
| Match | `RoundWin`, `RoundLose`, `Ko`, `Slumped` (Shutdown victim), `Shutdown`, `Victory`, `Defeat`, `Intro` | presentation-driven, no hurtbox in `Slumped` |

Cancel rules (data in `MoveDef.cancels`): `chain` = into a **stronger** normal of the same stance (L→M→H) on hit or block; `special`/`super` = into any special or super whose input completes inside the window on hit, block or whiff per `on`; `jump`/`dash` only where the move lists them. Recovery of any move is never cancellable by default. Actionable-state buffering: a button or motion pressed during the last `BUFFER_NORMAL` frames of hitstun/blockstun/recovery executes on the first actionable frame.

Facing swaps only while both fighters are grounded in an actionable or reaction state (no cross-up flip mid-move); jump-ins decide facing at the next landing. Throw invulnerability: `PreJump` is throwable, airborne is not, `Wakeup` has `WAKE_THROW_INVULN` frames.

## FC5 Input, schemes and the motion parser

**FC5.1 InputFrame → FighterInput** (`context = 'fighter'`). The core reads no other device state.

| FB bit | From C03 | Classic default | Simple default |
|---|---|---|---|
| Up / Down | `moveY > +48` (stick up) or `sim.Jump` / `moveY < −48` or `sim.Crouch` | stick, d-pad, W/S | same |
| Left / Right | `moveX` beyond ±48 (i8 range ±127) | stick, d-pad, A/D | same |
| LP, MP, HP | `sim.Attack`, `sim.Ability`, `sim.FightHeavy` | U I O (kbm), pad face + shoulders | **L = LP slot, H = HP slot** (J, K / pad X, Y) |
| LK, MK, HK | `sim.Sprint`, `sim.Nitro`, `sim.Horn` | J K L (kbm) | unused |
| SP | `sim.Special` | unused | L key / pad B |
| AS | `sim.FightAssist` | unused | `;` key / pad A |
| HY | `sim.Handbrake` | space (kbm) / pad shoulder | same; on-screen Hype button on touch |
| TA | `sim.Emote` (bit 17, local; packed by the fight codec) | T | T |
| BL | `sim.Block` | optional; holding back also blocks | optional |
| DA | `sim.Interact` | optional dash macro | touch Dash button |

`config/input/defaults.<device>.fighter-classic.json` and `…fighter-simple.json` hold the two binding sets; `ControlsSettings.fighterScheme` picks the file (assumption on S01/S10, hub §10). Settings shows fighter-context labels from `config/input/labels.fighter.json` (the same `ActionId` carries a different label per context; S10). Default keyboard and pad glyphs for Simple are the gamedesign §6 matrix (J K L ; and pad X Y B A) [research/gamedesign-decomposition.md §6].

**FC5.2 Ring and edges.** `RING = 32` entries per player, each `{dir9, buttons, tick}` packed in one i32. SOCD: left+right → neutral; up+down → up. Edges derive from consecutive entries; a press shorter than a tick is already latched by C03 rule 2.

**FC5.3 Motion parser** (runs when the fighter is actionable or in a cancel window):
1. A special triggers on tick `t`, the later of the button press and the motion completion, if the button set has a rising edge at `p`, the direction sequence completed at frame `m`, `|p − m| ≤ BUTTON_LEEWAY`, and all directions fall inside `MOTION_WINDOW` frames of each other (†12 frames, generous for a quarter-circle on a pad).
2. Sequences accept the cheaper adjacent diagonal (236 matches 2-3-6 and 2-6; 623 matches 6-2-3 and 6-3-2-3, and the first 6 is implied when the fighter dashed forward within the last 8 frames). `41236`, `63214`, `360` require every step; `22` and double-tap `66`/`44` use `DASH_TAP_WINDOW`.
3. Charge `[4]6`/`[2]8`: back (or down) held `CHARGE_FRAMES` (45) with at most `CHARGE_GAP` (3) non-charge frames since, then the release direction with the button inside the leeway.
4. Priority when several patterns match: super > special > command normal > normal; ties inside a class go to the more complex pattern. `LP+LK` pressed on the same frame is a throw, not two normals.
5. **EX**: a special whose input carries two attack buttons of the same type (any two for Simple's `AS+SP`) and `Hype ≥ 1000`; spends 1 stock; `ex` overrides apply.
6. `leniencyX100` scales `MOTION_WINDOW`, `BUTTON_LEEWAY`, both buffers and `DASH_TAP_WINDOW` (200 in pose mode, 150 on 30 fps render tiers, forced 100 online).

**FC5.4 Schemes.** Classic and Simple share one rule set; Simple only changes which input creates which action. Pose is Simple plus FP5.

| Action | Classic | Simple |
|---|---|---|
| Normals | 6 buttons × stance (5, 2, 6-command, air) | `L`/`H` × stance |
| Special 1/2/3 | motions on any attack button | `SP` + neutral / 6 / 2; damage × `SIMPLE_DMG_PCT` (80 %) |
| EX | two same-type buttons | `AS + SP` |
| Auto-combo | — | `AS` tap; `AS + L` and `AS + H` pick the first and second routine (`FighterDef.autoCombo`) at 80 % damage and no meter gain bonus |
| Super (2,000) / Showstopper (3,000) | 236236 / 214214 + any attack button | `HY`: spends 3,000 when available, otherwise 2,000 |
| Throw | `LP+LK` | `L+H` |
| Check (parry) | `MP+MK` | `L+H` when no throw is possible (below) |
| Clear the Air (burst) | `HP+HK` in hitstun or blockstun | `H+SP` in hitstun or blockstun |

Simple conflicts resolve by context: `L+H` is a throw when the opponent is grounded within throw range, otherwise a Check. A Simple special deals `trunc(damage × 80 / 100)`; Simple normals are full damage. Crouch/air normals use the held direction as in Classic. Taunt is `TA` in both.

## FC6 Boxes and hit resolution

1. **Boxes.** World capsules are the local capsules mirrored by facing and translated by `(X, Y)`. Hurt capsules come from the active `BoxTrack` or `hurtDefault[stance]`; one pushbox (AABB) per fighter; throw box only on throw startup/active frames. Projectiles carry their own hit capsules.
2. **Overlap.** Capsule–capsule: closest points of two segments (division is exact IEEE for these integer magnitudes), compare squared distance with `(r1 + r2)²`. Pushbox overlap is separated by half each; a fighter at a wall moves the other fully.
3. **Detect.** All candidates are collected against the start-of-step state, then sorted by `(attacker slot, hit index)` and resolved in that order, so trades are symmetric: if both fighters connect on the same tick both take the hit and both get hitstop. Strike beats throw on the same tick. Two throws within `THROW_TECH` (7) frames tech: both are pushed apart, no damage.
4. **Guard.** A grounded actionable defender blocks if holding back (4, 1, 7) or `BL`/auto-block: standing block stops `high`, `mid`, `overhead`; crouching block stops `high`, `mid`, `low`; `unblockable` and `throw` never. Airborne defenders cannot block. An active Check turns a strike into a parry (FC7).
5. **Counter.** A strike that lands during the defender's own startup or recovery (not stun) is a **counter**: hitstun +`COUNTER_HITSTUN`, damage × `COUNTER_DMG_PCT`.
6. **Damage.** `dmg = trunc(base × scale% / 100)` then, in order: counter, EX (`EX_DMG_PCT`), Simple (`simpleDmgPct`, specials and auto-combos only). `scale%` comes from the victim's `ComboHits` (table in FC2), floored at 30 and at the move's `minScale` (supers 40 or 50). Chip on block is `trunc(base × chipPermille / 1000)` (0 for normals unless the defender is `Rattled`: then 100 ‰ for normals, ×1.5 for specials). `CHIP_KILLS` is true; a KO by chip cannot trigger Shutdown (FC8).
7. **Stun.** `hitstun = base + counter − min(HITSTUN_DECAY × (ComboHits − 1), 50 % of base)`; blockstun is fixed (×1.25 when `Rattled`). The combo ends when the victim becomes actionable. After `MAX_COMBO_HITS` (40) the next hit forces a hard knockdown with no damage (safety net; `fighter:lint` also searches for loops, FC11).
8. **Juggle.** A launcher sets `JuggleLeft = juggle.limit`; each further hit on an airborne victim needs `juggle.cost ≤ JuggleLeft` and subtracts it; otherwise the hit whiffs the victim (no OTG).
9. **Pushback.** `pushHit`/`pushBlock` is applied evenly over `PUSH_FRAMES` (remainder in the first frames) to the defender; if the defender is at a wall the attacker takes it. Projectile hits push the defender only.
10. **Knockdown.** `soft`: quick rise (`dir + 2 buttons` within 5 frames) saves 6 frames; `hard`: none. Wakeup is `WAKEUP` (24) frames.
11. **Armor.** `armor.hits` strike hits are absorbed: damage taken at 50 %, no stun, hitstop applies; throws and `unblockable` ignore armor.
12. **Invulnerability** is per type (`strike`, `projectile`, `throw`, `all`) and frame range; it is data, shown in training mode (FC11).

## FC7 Meters

- **Health** 10,000 (kit may set 9,500 to 10,500). KO at 0.
- **Hype** 0–3,000 (stocks of 1,000). Gains: `hype.hit`/`block`/`whiff` of the move; `HYPE_ON_DAMAGE_PCT` (10 %) of damage taken; `TAUNT_HYPE` for a completed taunt. Spends: EX 1,000, Super 2,000, Showstopper 3,000. Hype persists across rounds in a match.
- **Composure** 0–6,000 (six segments). Spent by **Check** (`CHECK_COST` 600 on activation; a successful parry refunds 300) and **Clear the Air** (`CLEAR_COST` 2,000). Regenerates `COMP_REGEN` per frame after 30 frames without spending. At 0 the fighter is **Rattled** until Composure ≥ `RATTLED_EXIT` (3,000): normals chip, blockstun ×1.25, Check and Clear disabled. This mirrors the *shape* of a risk-reward defensive gauge with burnout (SF6 Drive Gauge) with different rules and names [research/gamedesign-decomposition.md §4.2, verified-facts rows on the Drive Gauge].
- **Check** parries one strike or projectile hit: no damage, no chip, attacker hitstop, defender recovery 8 frames (advantage in the defender's favour), attacker blockstun-equivalent 12 frames; it does not parry throws or `unblockable`.
- **Clear the Air** (burst): from hitstun or blockstun, 2,000 Composure; startup 6, all-invuln 1–10, pushes both apart, ends the combo; usable once per round.

## FC8 Rounds, finishers, camera

1. **Match.** Best of three by default (`roundsToWin 2`); Versus/Training allow other values and an infinite timer; Story/Arcade use the bout definition. Timer 99 s (5,940 frames). Time-out compares health integers; equal → both score a round; if that makes both reach the target, a **sudden round** follows (`SUDDEN` 1,800 frames, both at 1,000 health; first hit wins, else health compare, else more Hype, else slot 0). A double KO scores both.
2. **KO.** `Ko` phase runs at 1/3 speed for 30 frames. If it was the **final** KO of the match, the winner scored it with a non-chip hit and `rules.shutdowns` is on, the `Shutdown` window opens for 90 frames.
3. **Shutdown (finisher).** Winner taps `HY` inside the window. The kit's `shutdown` move runs against the `Slumped` victim: 150–200 frames of comedic, non-gore spectacle (speech-bubble sigils, a term-sheet blizzard, a cartoon cushion avalanche; kit-specific, FX2). No blood, no dismemberment, no weapons, no real-person-crime imagery (D-30; research §4.2 "no gore"; hub §2). The CPU taps with probability `ai.shutdownRate` from its `cpu` stream.
4. **Camera.** Fixed side view, auto-zoom: target x = midpoint, distance = `clamp(minD, maxD, a + b·|x0 − x1|)` with integer coefficients in the stage definition (FX5), published each tick as `CameraDirective {mode:'cinematic', shot:{kind:'side', damping, fovDeg}, reason:'mode', lockPlayerToggle:true}` (C04). Dynamic pans only for supers (45-frame freeze: dolly-in 20 frames). Reduced motion: no shake, no dolly; fades replace pans (C04 rule 6). XR: the rig exposes only the arena dolly (C04 rule 5).

## FC9 Projectiles and summons

A pool of 16 entities (`PROJ_WORDS = 16`: owner, def index, x, y, vx, vy, life, hitsLeft, frame, state words). At most 4 per owner (`ProjActive`). Behaviours: `linear`, `sine` (`y = oy + SINE64[(frame × 64 / period) & 63] × amp / 127`), `arc` (parabola), `trap` (stationary zone with a lifetime and optional trigger), `orbit` (drone circling the owner on a 64-entry table, fires `child` defs), `summon` (a scripted crew member that plays a move list for N frames; costs Hype). Clash: `power` higher wins, equal destroys both. Projectiles hit once per defender per `hits`; hitstop does not freeze projectiles that did not connect. All state is in the buffer, so snapshot/restore covers it.

## FC10 CPU opponent

The CPU produces a `FighterInput` per tick, so it obeys the same motion, buffer and scheme rules as a human (no "direct move" shortcut except the training dummy's recorded stream).

1. **Perception.** The CPU does not read the opponent's buttons. It reads a delayed copy of the opponent's public state (state, move frame, distance, airborne, projectile list) from a 16-entry ring, delayed by `reaction` frames (kit range, scaled by level and by ×1.5 against pose, FP5).
2. **Decision** every 4–8 frames, scheduled on even ticks only (the C02 30 Hz AI rate, `AI_DIVISOR 2`). Candidate actions: approach, retreat, hold ground, block, jump in, anti-air, poke by range band, whiff punish, throw, projectile, special, Check, Clear, EX/super, taunt (when safe). Score = Σ weight × feature; features: distance band, opponent state (startup, active, recovery, blockstun), frame advantage from move data (**punish when `advBlock ≤ −4` and a move with `startup ≤ −advBlock` exists**), corner, own meters, projectile threat, round situation; weights come from `AiProfile` and the level.
3. **Macro executor.** The chosen action expands to an input script (e.g. `236 + L` = `2`, `3`, `6`, then `LP` over 4 frames) with an execution-error chance that drops or delays a step.
4. **Levels.** Easy / Normal / Hard / Brutal: reaction ×1.6 / ×1.0 / ×0.7 / ×0.45, execution error 20 / 10 / 4 / 0 %, habit variety 3 / 5 / 8 / 12 named habits, block rate −20 / 0 / +10 / +20 points. Story bouts name a level. Personality comes from `AiProfile`, seeded from soul tags by S04's compiler (no LLM in the fight loop).
5. **Trash talk.** Pre- and post-fight lines are authored ink lines by archetype pair class; an LLM line is optional through C10 route 31 with `context.mode: 'fighter'` and `turn.intent` `fight_pre` or `fight_post` (C10 1.0.0, DL-086), quota-limited, available under the same eligibility as any NPC turn (C12: no token for an under-18 or offline player means the ink line), never required, with in-memory caching per `(pair, soulVersions)`. Offline fallback is the ink line (R-NPC-05). The LLM never affects a decision.

## FC11 Tuning and verification tools

| Tool | Command or path | What it does |
|---|---|---|
| Training mode | `Training` menu entry; ships in release | box overlay (hit red, hurt blue, push yellow, throw green), frame meter (startup/active/recovery per move with derived advantage), input display with buffer age, record/playback dummy, dummy states (stand, crouch, block all, block after first hit, jump, CPU), reset position, meter refill, damage and scaling readout, combo counter, invuln display |
| Move timeline editor | `tools/fighter/editor` (dev only, `VITE_DV_QA`) | edits `content/fighter/kits/<slot>.json`: frame scrubber over the retargeted clip with capsule gizmos, cancels, invuln; writes JSON, never TS |
| Frame-data lint | `pnpm --filter @dv/mode-fighter fighter:lint` (in `check:fighter`) | JSON Schema; recomputes derived advantage; rejects `startup < 3`, `recovery < 1`, boxes outside ±4,000 u, a hit with no hurtbox overlap on any frame of its move, moves with unreachable inputs, kit name collisions; fame-domain tags (FX4); loop search: BFS over cancel graphs for combos beyond 40 hits or > 70 % health on one touch |
| Replay verify | `pnpm --filter @dv/mode-fighter fighter:replay -- <file>` | re-simulates a `.dvfight`, compares all checkpoints; runs the golden replays in CI |
| Balance runner | `pnpm --filter @dv/mode-fighter fighter:balance -- --bouts 1000` | CPU vs CPU for every pair and both sides, worker threads, seeded; writes `balance/<build>.json`: win-rate matrix, mean match length, KO/time-out split, Check/Clear/Shutdown rates; flags pairs outside 35–65 % (M08b gate), target 40–60 % by M10 |
| Frame-data diff | `pnpm --filter @dv/mode-fighter fighter:diff -- <rev>` | table of changed numbers between commits for the changelog |
| QA bridge | `window.__dvBridge.fighter` (QA builds) | `start`, `step(n)`, `setInputs`, `state`, `hash`, `exportReplay`, `reloadTuning` |

Budgets (design targets, measured in M08a): `step` p99 ≤ 0.10 ms in Node and ≤ 0.30 ms on `mobile-low` in `sim.worker`; snapshot+restore ≤ 0.1 ms; zero allocations per tick (a test counts `Array`/`Object` creation under a hook). A 28-pair × 100-bout run completes in ≤ 3 minutes on a 4-core CI runner; the 1,000-bout run is a milestone gate, not a PR gate.

## FC12 Rollback netcode: notes for after M12b (not built in v1)

R-MODE-03 does not require online play; the design only keeps the door open [research/gamedesign-decomposition.md §4.8].
1. **Why feasible:** state is one ~4 KB `Int32Array`; `step` is a pure function of `(state, inputs)`; presentation events are re-derived and de-duplicated; cinematic skip is an input; no physics.
2. **Plan:** input delay 2 frames, rollback up to 7 frames, 8-snapshot ring, per-10-frame hash exchange (a per-frame hash locally), spectators by input relay. Leniency forced to 100 %, pose disabled online, both clients verify `frameDataHash` and `FIGHT_DATA_VERSION` at join; mismatch → no match.
3. **Transport gap (proposal to S09):** C11 `EV Activity` is reliable JSON ≤ 1 KiB and `IN` is 20 Hz, so neither carries 60 Hz fight input. Proposal: an additive `ActKind.FightInput` carrying the last 8 frames × 2 B per player redundantly each tick over the same WebSocket to a `DirectoryDO`-assigned fight instance; the DO relays and arbitrates final hashes, it does not simulate. Latency over a Durable Object relay is `UNVERIFIED`; the M12c load test measures it, and an ADR decides relay versus WebRTC (Realtime TURN pricing F-026).
4. **Not GGPO:** GGPO is MIT but its build targets Windows only; the loop is written in TypeScript [research/gamedesign-decomposition.md §4.8, GGPO row].
5. **No ranked mode in v1.** If ranked arrives, Classic and Simple queues are separate (research §4.11) and pose never enters ranked.
