# M05b2 — cutscene-player-index

## Goal
After this session a story beat can ask for a cutscene and always get one. `cutsceneKey` and `normalizeKeyInput` (A-03 v1) are pure functions with test vectors; `pnpm assets:cutscene-index` builds the public `data/cutscene-index`, the private `cutscene-requests.json` and the catalog keys with the carry-over rule; story prompt templates exist and `tools/ci/prompt-lint.ts` enforces prompt hygiene; the `CutscenePlayer` resolves refs through the index, roster flags and route 27, picks host and rendition, plays single clips and mixed sequences on the flat DOM host, and falls back to the in-engine DirectorScript on every trigger. The sim's `beat` op emits `cut.request`, arms the DirectorScript and resumes on `cutscene.state`, so the video path and the fallback path leave identical mission state.

## Requirements
- R-CUT-01: deterministic cache keys, the shipped index, AI-generated labelling and playback.
- R-CUT-02: story-beat hooks and templates (`story.establish@1`, `story.beat@1`); fight and race templates follow in M08b2 and M07b2.
- R-CUT-03: eleven fallback triggers; the mission never waits on generation.

## Depends on
- M05b1 (route 27, catalog file, `CutsceneJobDO`, mock pipeline, `assets:gen prewarm`), M04c (C09 cutscene types, video pool, DOM host, overlay, fixtures), M05a1 (VM, `beat` op, compiler). Through M05a1's chain the director of M05a2 is available in run order; if it is not, the fallback holds a single shot (M05a1 behaviour).
- Contracts: C09 1.0 (§D2–§D4, §D7), C13 1.1 (`FirstGestureUnlock.acquireVideo`, `PlatformSettings.dataSaver`, `MemoryBudget`), C06 1.1 (`UiCommand 'cutscene.state'`, `SimEvent`), C12 1.1 (`CutsceneStatus`, `RosterFlags`), C16 1.1 (`cutscene.play` props, DL-193), C05 1.1 (`ProfileSettings.cutscenes`).

## Scope in
- `packages/shared/src/genai/cutscene-key.ts`: `normalizeKeyInput` (sort `characters` by `id`, reject duplicates, sort and lowercase `inputHashes`, require integer `seed` in 0…2³²−1, reject any property outside the eight) and `cutsceneKey = sha256Hex(canonicalize(normalizeKeyInput(i)))` with M01a1's `json.ts` and `hash.ts`; vectors in `packages/shared/test/cutscene-key.vectors.json` (§D3.6, at least seven).
- Index builder `tools/assets/cutscene-index/` (S03 code, root script `assets:cutscene-index`):
  - inputs: CutsceneRefs (`content/story/**/cutscene-refs.ts` and fixtures), compiled soul facts (`id`, `soulVersion`, likeness tier via C10 `assetTier`) read from soul frontmatter through a `SoulFactsPort` (M06a2 replaces the reader with its compiler), the registry selection rule and `pinnedUpdatedAt`, template frontmatter (`style`), seeds (`content/cutscenes/seeds.json` or `parseInt(sha256Hex(refId).slice(0, 8), 16)`), input hashes (style bible, sheet crops, stage plates from `content/cutscenes/plates.lock.json`, authored keyframes);
  - outputs: `assets/src/data/cutscene-index/{asset.json, index.json}` (`CutsceneIndex`, public: no prompts, no URLs), `.private/cutscene-requests.json` (git-ignored, `CutsceneRequest[]` with `ShotPlan`s and `budgetUsdMicros`), and the key list for `services/edge/src/generated/cutscene-catalog.json`;
  - carry-over: desired key if ready (manifest `HEAD` through a `ReadyPort`; offline = not ready); else the previous release's key for the same ref when the same characters, `soulVersion` and tier, no kill and a non-delisted provider hold, marked `stale: true`; else the desired key (fallback until prewarm);
  - fails when any entry references `previs/`, lacks a fallback DirectorScript, or a beat's slots or cues changed without a `rev` bump in `content/cutscenes/beats.lock.json`.
- Templates `content/prompts/genai/{story.establish@1, story.beat@1}.md` (frontmatter per §D4: `recipe: K`, `style: bay-cel@1`, `keyframePin`, `shots`, `aspect: '16:9'`, `resolution: 768P`, `audio`, `slots`), `content/cutscenes/{places.json, seeds.json, beats.lock.json}`, `config/prompt-banned.json`.
- `tools/ci/prompt-lint.ts` (rules 1–5 of §D4: names and denylist, banned vocabulary, realism tokens with non-consented cast, closed slot sources and 1,200-character cap, the "no text, no logos" clause; template `keyframePin` equal to the registry pin); called by `missions:build`, `check:assets` and the index builder; replaces M05b1's stub prompt check in the pipeline gate.
- `CutscenePlayer` (`packages/engine/src/client/cutscene/`, path per C09 §D2; story-side glue in `packages/modes/story/src/cutscene/`):
  - `prepare`: index entry (suppressed by `RosterFlags` scope `cutscene`/`all`, by `ProfileSettings.cutscenes.generated === false` or boot flag `cutscene.generated` off) → route 27 → `manifest.json` → host `dom-overlay` with a pooled element → rendition (`v768`; `v1080` on screens ≥ 1440 px tall when present; `v540` on `dataSaver` or measured throughput < 4 Mbps; first rendition whose `codecs` passes `canPlayType`); poster (or the armed in-engine frame) covers the screen meanwhile; never throws;
  - `play`, `playSequence` (MSE `sequence` mode, `ManagedMediaSource` + `disableRemotePlayback` on iOS, ping-pong fallback; per-item `cutscene.state`, an item with `ref: null` or not ready plays its DirectorScript), `skip`, `prefetch` (≤ 2 refs ahead on mobile tiers; story refs `onTrigger`);
  - triggers per §D7 table: `not_ready`, `policy`, `setting_off`, `offline`, `not_permitted` (mobile: "Tap to play" 3 s, then fallback), `media_error`/`codec` (next host, then fallback), `start_stall` (2.5 s, 1.5 s prefetched), `mid_stall` (hold `last.webp`, finish in-engine from the matching cue), `budget` (> 85 % mobile media budget → `v540`, then fallback), `degraded_sequence`; thresholds in `config/cutscene.json`;
  - audio: video always muted; `engine` audio plays the cues' lines on the `cutscene` bus; `generated-ambient` plays `a.m4a` only when `speechDetected` is false or approved; sync with `requestVideoFrameCallback` against `getOutputTimestamp()`, nudge beyond ±45 ms;
  - telemetry `cutscene.play {key8, cached, fallback, path, trigger?}` (C16 1.1, DL-193; never `reason`); the AI chip through the M04c overlay.
- Sim protocol (`03-story-cutscenes.md` §D7, DL-160): the `beat` op with a cutscene ref emits `{t: 'cut.request', s: <refIds comma-joined>, n: <u32 play counter>}`, arms the fallback DirectorScript (actors at start marks, first shot, mission clock paused, input context `cutscene`, `lockPlayerToggle`); the main thread answers `UiCommand {t: 'cutscene.state', playId: String(n), item?, state, trigger?}` within 2.5 s; `video` pauses the sim through the DOM host, `fallback` runs the script, `done` applies end marks and resumes the clock; `?beats=video|fallback|instant|plate` honoured in QA builds; CI uses `instant`.
- Fixture refs `cut.story.m.dev.sample.intro` (fallback = the M05a2 sample DirectorScript) with a mock manifest from the M04c clips.

## Scope out
- Act 1 refs, plates and the release index: M05c1–M05c2 (`assets:plates` lands in M05c2). Fight and race templates and refs: M08b2, M07b2. XR hosts: M11b2. Generation spend: M05c3.

## Deliverables
- `packages/shared/src/genai/cutscene-key.ts`, `packages/shared/test/{cutscene-key.test.ts, cutscene-key.vectors.json}`.
- `tools/assets/cutscene-index/{cli.ts, build.ts, carry-over.ts, soul-facts.ts}`, `tools/assets/test/cutscene-index.test.ts`, root script `assets:cutscene-index`.
- `tools/ci/prompt-lint.ts`, `tools/ci/test/prompt-lint.test.ts`, `config/prompt-banned.json`, `config/cutscene.json`, `content/prompts/genai/{story.establish@1.md, story.beat@1.md}`, `content/cutscenes/{places.json, seeds.json, beats.lock.json}`.
- `packages/engine/src/client/cutscene/{player.ts, resolve.ts, hosts.ts, sequence.ts, triggers.ts, audio-sync.ts}`, `packages/engine/test/cutscene/{player-triggers.test.ts, sequence.test.ts}`.
- `packages/modes/story/src/cutscene/{beat.ts, protocol.ts}`, `packages/modes/story/test/cutscene-protocol.test.ts`.
- `tests/e2e/cutscene-player.spec.ts` (tag `@cutscene`), fixture ref and manifest under `tests/fixtures/cutscenes/`.

## Interfaces
- C09 1.0: `cutsceneKey`, `normalizeKeyInput`, `CutsceneIndex`, `CutsceneRequest`, `CutscenePlayer`, `PreparedClip` implemented as declared; C06 1.1 `cutscene.state`; C16 1.1 `cutscene.play`. No shape change.

## Acceptance criteria
- AC-1 Given the key vectors When the tests run Then reordered `characters` and reordered `inputHashes` give equal keys; `soulVersion` + 1, a tier change, an endpoint re-pin and a new seed each give a new key; an extra property, a duplicate character and seed 2³² are rejected — proof: `pnpm check:unit -- packages/shared/test/cutscene-key.test.ts`
- AC-2 Given fixture refs, souls and a previous index When the index builder runs twice Then the outputs are byte-identical; a not-ready desired key with a still-valid previous key yields the previous key with `stale: true`; a `soulVersion` change yields the desired key; a killed character's entry is suppressed; a delisted provider's keys are dropped; a ref without fallback or with a `previs/` input fails — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given a beat whose cue text changed without a `rev` bump in `beats.lock.json` When `missions:build` runs Then it fails naming the ref — proof: `pnpm check:unit -- packages/modes/story`
- AC-4 Given one fixture per prompt-lint rule and the two story templates When the linter runs Then each fixture fails with its rule number, both templates pass, and a template whose `keyframePin` differs from the registry fails — proof: `pnpm check:unit -- tools/ci`
- AC-5 Given fake media for each trigger (status `absent`, roster kill, setting off, offline, `play()` rejection, decode error, no first frame in 2.5 s, `waiting` > 1.5 s, media budget at 90 %, a `degraded` item in a sequence) When `prepare`/`play` run Then each produces its §D7 action and outcome, nothing throws, and each emits `cutscene.play` with `path` and `trigger` and no `reason` — proof: `pnpm check:unit -- packages/engine/test/cutscene`
- AC-6 Given a `playSequence` of `[null, ready, absent]` When it plays Then three `cutscene.state` commands carry `item` 0, 1, 2 with `fallback`, `video`, `fallback`, and the returned outcomes match — proof: `pnpm check:unit -- packages/engine/test/cutscene`
- AC-7 Given a mission with one cutscene beat When it runs headless twice, once answering `video` then `done` and once `fallback` then `done` Then `cut.request` carried `n` and the ref id, the DirectorScript was armed on the request tick, the mission clock did not advance during the beat, and both runs end with the same `stateHash` — proof: `pnpm check:unit -- packages/modes/story`
- AC-8 Given a QA build with route 27 mocked `absent` When the sample beat triggers Then the fallback starts within 2.5 s, subtitles show, no AI chip renders, and the mission resumes with end marks applied; with route 27 `ready` and the fixture manifest the clip plays with the AI chip and subtitles and Escape skips it; with a stall injected after 1 s the overlay holds `last.webp` and the fallback finishes the beat — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene`
- AC-9 Given the same build When the `@cutscene` tag runs on WebKit Then the M04c spike tests and the absent-to-fallback test pass — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @cutscene`
- AC-10 Given the branch When the asset gate, production build and preview deploy run Then the index and templates pass `check:assets` (prompt lint included) and the app deploys — proof: `pnpm check:assets && pnpm build && pnpm deploy:preview`

## Test plan
- Unit: `shared/cutscene-key`, `tools/assets/cutscene-index`, `tools/ci/prompt-lint`, `engine/cutscene.player-triggers`, `engine/cutscene.sequence`, `story/cutscene-protocol`, `story/beats-lock`. `pnpm check:unit -- packages/shared packages/engine packages/modes/story tools/assets tools/ci`.
- E2E: `@cutscene` on `chromium-webgl2` and `webkit-webgl2` (route mocks through Playwright; assertions on bridge state and DOM).
- Static: `pnpm check:assets`.

## Demo script
1. `pnpm assets:cutscene-index -- --release dev`: prints refs, keys and which are `stale`.
2. `pnpm dev`, open `/?mission=m.dev.sample&beats=video`, click the title, reach the intro beat: the fixture clip plays with the AI chip.
3. Reload with `&beats=fallback`: the DirectorScript plays the same cues; mission state afterwards is identical.
4. Settings › Generated cutscenes: Off → the next beat falls back with trigger `setting_off`.

## Effort
1 session; ≈ 38 files; risk medium (MSE `sequence` on WebKit, U-S03-4, recorded by M04c; ping-pong is the fallback).

## Risks & fallbacks
- `ManagedMediaSource` behaves differently in Playwright WebKit: the WebKit AC covers single clips and fallbacks only; sequence behaviour is unit-tested with fake media and checked on the device in M05c2.
- Soul frontmatter for Act 1 cast does not exist yet: the index builder reads fixture souls here; M05c1 adds the cast and M06a2's compiler replaces the reader behind `SoulFactsPort`.
- File budget: drop `audio-sync.ts` nudging to a constant offset and record it; the e2e does not assert audio.

## Notes for the Builder
- Read first: `03-story-cutscenes.md` §D1–§D4, §D7; `03-story.md` §5 (beats and the clock), §6; `11-platform-pwa.md` §7; [research/gap-cutscene-delivery-playback.md §7].
- Order: key and vectors → prompt lint and templates → index builder → player resolve and hosts → triggers → sequences → sim protocol → e2e.
- The player runs on the main thread; the sim learns everything through `cutscene.state` commands, recorded in the timeline. Never let the mission wait on a network answer: the 2.5 s answer deadline is enforced by the player, which sends `fallback` itself.
- No secrets; route 27 is public. Branch `m05b2-cutscene-player-index`.
