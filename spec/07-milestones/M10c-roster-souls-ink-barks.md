# M10c — roster-souls-ink-barks

## Goal
After this session the NPC content layer of v1 is complete for everything the repository is allowed to hold. It covers four areas.

**Act 1 cast souls.** Every fictional Act 1 cast member of `03-story-narrative.md` §B2 gets a finished `soul.md`. The cast is:
- `odessa_calloway`, `tavi_okafor`, `x_ramos`;
- `corwin_hale`, `dana_voss`;
- `patch`, `whitney_arlo`;
- `saint_static`, `chorus_sparrer`;
- `imani_hart` and residents `res_tran`, `res_moss`, `res_kai`;
- `sgt_bell`.

Each soul has its ink and covers every `mission_<missionId>_<talkId>` knot that Act 1 needs. Each is assigned a t1 voice in `config/voice-catalog.json`, and the barks are named-NPC bark pools.

**Stand-ins.** The stand-in souls for the Act 1 roster slots get the same treatment: `INFLUENCER`, `RAP_HYPHY_ELDER`, `RAP_NEW_WAVE` and `ATH_SHOOTER`.

**Research layer.** The research normalizer (`npc:normalize`) turns supplied research into soul drafts that need a human review record before they become active. It runs on the canary fixture while Q-19 and Q-25 are open, and on `content-private/` when that folder is mounted.

**Consent index.** `config/consent-index.json` is exported for `likeness:gate`.

Act 1 still passes the mission autoplayer with AI dialogue off.

## Requirements
- R-NPC-01: the roster's souls (`soul.md` plus voice and backstory summary) for the Act 1 cast, stand-ins and, when supplied, the real-derived research layer.
- R-IP-02: consent records feed the likeness gate. Real-derived souls stay in `content-private/`. Every real-derived entry has an active original stand-in.
- R-NPC-05 (support): offline ink lines and baked barks keep every NPC usable without the LLM.

## Depends on
- **M10a2**: published character assets and `assets.*` refs for the Act 1 cast (Lean bodies) and fighters.
- **M06a4**: `TtsPlayer`, `LipSyncDriver`, `config/voice-catalog.json`, t1 Workers AI Aura, `npc:eval`. The run order also places M06a2 (`tools/soul`, `npc:lint/build/consent-index`, ink scaffolds), M06c (`BarkSystem`, archetype pools) and M05c2 (Act 1 missions, `check:missions -- --act 1`) before this milestone.
- Contracts: C10 1.0 (`soul/1.0` frontmatter, compiled outputs, ink knots, voice tiers, roster manifest), C07 1.1 (`data/ink.<id>`, `data/barks.<id>`, `audio_bark` with `cues`, provenance `voice_mode: synthetic`).

## Scope in
- **Act 1 cast souls** in `content/npcs/<id>/soul.md`, all `basis: original`, `fictionalized`:
  - Sections per B3: Identity, Voice, Personality, Knowledge, Relationships, Places and schedule, Rails, Example lines with ≥ 8 tagged lines.
  - Schedules cover 00:00–24:00 on all seven days (L1).
  - Places resolve against the C08 POI table (L2).
  - `assets.*` refs come from M10a2: Lean bodies, or creator-kit bodies for those without one.
  - `roles` reflect the story: `whitney_arlo` gets `tycoonActor: false`, because the pitch is the VC souls' job.
  - Create a soul where none exists yet; finish it where an earlier milestone left a scaffold.
- **Stand-in souls** for the four Act 1 roster slots (`content/story/cast.json` targets), `original` tier.
- **Ink.** Every Act 1 NPC's `content/npcs/<id>/<id>.ink` defines:
  - `greeting`, `smalltalk`, `busy`, `deflect`, `farewell`;
  - one `mission_<missionId>_<talkId>` knot (with `.` and `-` replaced by `_`) for each Act 1 talk objective that names the NPC (DL-085).
  - A unit test reads the compiled Act 1 mission IR and asserts that every such knot exists.
- **Voices.**
  - Every Act 1 cast member and stand-in gets a `voice.voiceRef` to a Workers AI Aura entry in `config/voice-catalog.json`, `tier: t1` (Q-20 default; DL-OWN-01, so no fal voice design).
  - A `design_prompt` text is kept for later, and it passes `lintPrompt` (L12): no real person, accent imitation or "sounds like".
  - Heroes stay t1 while `ks:tts:elevenlabs` is on.
- **Barks.**
  - Named pools for the 11 named cast members in one file, `content/npcs/barks/named-act1.json`, keyed by `NpcId`. Each pool has 30–60 lines tagged by `BarkTag`.
  - `npc:bake-barks` (Part C §C9) drafts the lines through the Anthropic Batch API with `ANTHROPIC_API_KEY`. Without the key it prints `SKIP … ANTHROPIC_API_KEY not set`, and the hand-written lines stand.
  - A human sample of at least 10 % per pool is recorded in `content/npcs/reviews/act1.json`.
  - `--render` pre-renders t1 audio through Workers AI Aura with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus Rhubarb cues, into `audio/barks/<sha256(voiceId|model|text)>.<ext>` assets. The container is the one M00c recorded for U14, with AAC as the fallback. Provenance is `synthetic`.
  - Without those credentials it prints `SKIP`, and barks play as subtitles only.
- **Normalizer.**
  - `npc:normalize -- --slug <s> [--fixture]` reads `research/characters/<slug>/` or `content-private/research/<slug>/` and produces a draft soul with `research: normalized` and `status: draft`.
  - It uses Sonnet structured output with `ANTHROPIC_API_KEY`. `--fixture` replays `tools/soul/fixtures/normalize/canary-mc.fixture.json` (research text and recorded response in one file).
  - `npc:build` refuses `status: active` for a normalized soul without a review entry (reviewer, date, checklist) in `content/npcs/reviews/`. Real-derived souls are reviewed under `content-private/`.
  - The canary runs on the original fixture research of `canary-mc`.
- **Private mount.**
  - `npc:build` merges `content-private/npcs/roster.json` when it is mounted and prints `SKIP content-private not mounted` otherwise.
  - Public builds use `content/prompts/npc/rules@<n>.example.md`.
- **Consent index.** `npc:consent-index` exports ids, scopes and `term_end` from `consent_record`.
  - It uses `SUPABASE_SECRET_KEY` against staging when present.
  - Otherwise it uses the in-memory `DataPort`, giving a valid file with zero records and `SKIP … SUPABASE_SECRET_KEY not set`.
- **Evals.** Add the Act 1 cast to the replay eval set (`npc:eval -- --replay`).

## Scope out
- Real-derived souls content: waits for Q-19 and Q-25. The tools and gates are ready, and only canary and fixture runs happen here.
- t2 (ElevenLabs) hero voices: Q-20 default no.
- Acts 2–3 cast and ink: M05e1–M05f2.
- Generated voices of any kind via fal: none in v1 (DL-OWN-01).
- New Lean or Standard models: M10a2 (finished).

## Deliverables
- `content/npcs/{odessa_calloway, tavi_okafor, x_ramos, corwin_hale, dana_voss, patch, whitney_arlo, saint_static, chorus_sparrer, imani_hart, sgt_bell}/{soul.md, <id>.ink}`.
- `content/npcs/residents/{res_tran,res_moss,res_kai}.soul.md` with one shared `residents.ink`, if the compiler accepts a shared ink path. Otherwise use three folders as above.
- `content/npcs/standins/<slot>/soul.md` for the four slots, with one shared `standin.ink`.
- `content/npcs/barks/named-act1.json`.
- `content/npcs/reviews/act1.json`.
- `content/npcs/roster.json` (`rosterVersion` bump), `config/voice-catalog.json`, `config/consent-index.json`.
- `tools/soul/src/{normalize.ts, bake-barks.ts}`: complete or extend the M06a2 and M06c versions without changing flags. Also `tools/soul/fixtures/normalize/canary-mc.fixture.json`.
- `tools/soul/test/{act1-knots.spec.ts, normalize-barks.spec.ts}`.
- Root scripts: **`npc:normalize`** and **`npc:bake-barks`**, both in the `npc:*` family. Add them only if M06a2 or M06c did not.
- About 40 hand-written files. Soul and ink pairs dominate. If the count runs over, the audio-render half of `npc:bake-barks` moves to a follow-up commit on the same branch; the CI-provable content does not.

## Interfaces
- C10 1.0: the frontmatter schema, compiled outputs, the ink knot naming of DL-085, roster rules R1–R7, voice tiers. `soulVersion` changes only per L14.
- C07 1.1: `data/ink.<id>`, `data/barks.<id>`, `audio_bark` + `cues` assets with provenance.
- C12 1.1 `DataPort` is read-only for the consent export.
- No contract shape changes.

## Acceptance criteria
- AC-1 Given every Act 1 cast soul, stand-in soul and the roster When the soul lint runs Then L1–L14 pass: schedules cover every day, places resolve, compiled block B is within budget (L4 runs where `ANTHROPIC_API_KEY` exists, else SKIP), example lines meet the tag rule, every voice ref is t1 and allowed for the tier, and ink compiles with the five base knots — proof: `pnpm npc:lint`
- AC-2 Given the compiled Act 1 mission IR When the knot test runs Then every talk objective naming an NPC has a `mission_<missionId>_<talkId>` knot in that NPC's ink, and every NPC the IR names exists in the roster — proof: `pnpm check:unit -- tools/soul`
- AC-3 Given the new souls and ink When the Act 1 autoplayer runs with `npc.dialogue` off on 3 seeds Then all 12 Act 1 missions pass with equal end hashes per seed — proof: `pnpm check:missions -- --act 1`
- AC-4 Given the canary research fixture When the normalizer runs in fixture mode Then it writes a draft soul with `research: normalized` and `status: draft` that passes the schema; `npc:build` refuses to activate it without a review record and accepts it with one — proof: `pnpm check:unit -- tools/soul`
- AC-5 Given no `content-private/` mount When the roster builds Then it prints `SKIP content-private not mounted`, builds `data/npc-roster` from public entries only, and rules R1–R7 pass — proof: `pnpm npc:build`
- AC-6 Given the exported consent index (zero or more records) and every soul When the likeness gate runs Then it passes: no `consented` tier without an unexpired scope, every real-derived entry has a stand-in, no face-detector reference exists — proof: `pnpm npc:consent-index && pnpm likeness:gate`
- AC-7 Given the bark pools When the bark tool runs in dry-run mode Then every line passes `lintPrompt` and the NameRegistry check, each pool has 30–60 lines and a review record covering at least 10 % of its lines, and the printed estimate lists Batch and TTS units; any rendered `audio_bark` asset has a `synthetic` provenance record — proof: `pnpm check:unit -- tools/soul && pnpm provenance:check`
- AC-8 Given network blocked in a QA build When the player talks to `odessa_calloway` and runs `m.a1.01` Then ink lines play with subtitles and the mission completes — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-offline`
- AC-9 Given the replay eval set with the Act 1 cast added When the deterministic evals run Then they pass — proof: `pnpm npc:eval -- --replay`
- AC-10 Given the soul texts, ink and barks When the IP gates run Then no real name, alias, franchise or catchphrase appears in public content — proof: `pnpm names:lint && pnpm ip:strings`

## Test plan
- **Static:** `npc:lint`, `npc:build`, `likeness:gate`, `names:lint`, `ip:strings`, `provenance:check`.
- **Unit:** Act 1 knot coverage, normalizer fixture, review gate, bark lint (`pnpm check:unit -- tools/soul`).
- **Bot-run:** `pnpm check:missions -- --act 1`.
- **E2E:** `@npc-offline`; `@npc` (M06a5) stays green.
- **Evals:** `pnpm npc:eval -- --replay`. The weekly `--live` run picks up the new souls automatically (`ci-evals` workspace).

## Demo script
1. `pnpm npc:lint && pnpm npc:build`: every soul passes, and the build prints the private-mount SKIP.
2. `pnpm npc:normalize -- --slug canary-mc --fixture`: inspect the draft soul and its `draft` status.
3. `VITE_DV_QA=1 pnpm dev`, walk to the Yard and talk to Odessa with the network blocked: the ink lines play.
4. With AI dialogue on and a staging key, talk again: the same character speaks through the proxy.
5. `pnpm check:missions -- --act 1`.

## Effort
1 Builder session; about 40 files; risk **medium**. Content volume (14 souls with ink) is the time sink. Bark baking and audio rendering depend on keys and can land as a follow-up commit.

## Risks & fallbacks
- **L4 token budgets** need `messages.count_tokens` (`ANTHROPIC_API_KEY`). Without the key L4 SKIPs locally, and CI with the key is the gate.
- **The Opus container on iOS** (U14) uses the M00c recorded result, with AAC as the fallback. The key rule is unchanged.
- **Rhubarb licence** (U9, believed MIT): if M06a4 did not clear it, ship barks without cues. The lip-sync falls back to the RMS envelope.
- **Q-19 and Q-25 open:** only originals and the canary fixture. The milestone is complete on that basis, and real-roster content is a later data PR using the same commands.

## Notes for the Builder
- Read first: `04-npc-contracts.md` B2.2, B3, B5, B6, B8; `04-npc.md` §5.5, §5.7, §5.10; `04-npc-builder.md` §C9; `03-story-narrative.md` §B2–§B4.
- Write original characters only. The cast are invented. Roster slots are filled by stand-ins until consented or parody souls arrive through the private repo.
- **Secrets.**
  - `ANTHROPIC_API_KEY`: normalize, Batch drafts, L4.
  - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: Workers AI rendering.
  - `SUPABASE_SECRET_KEY`: consent export.
  - Each absent secret gives SKIP plus a stub, as above.
- **Owner gates.** Q-19 and Q-25 (canary only while open); Q-20 (t1 voices).
- **Facts.** F-025 (Workers AI Aura price), F-046 (MiniMax speech prices, unused while no fal voice is bought) and F-051 (ElevenLabs terms, t2 stays off) are cost context only, and no AC asserts a price.
