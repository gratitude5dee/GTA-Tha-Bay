# Runbook: roster batch and the live canary

The character pipeline of `spec/domains/05-assets-pipeline.md` section 12 as commands. M10a1 ships the tools and the two-character canary; M10a2 adds the Coast set, the fighter-clip fallbacks and the batch report, and the operator runs the batch with them. **Only the operator or the art lead runs anything with `--live`.** CI never does (`FAL_MODE: mock` in every workflow, `run --live` refuses while `CI` is set). The hard cap for all fal spend is USD 100 (DL-OWN-01); the character line is USD 42 (`config/guardrails.yaml` `genai.lines`).

## Before the first live command

1. **Keys.** `FAL_KEY` in your shell (Q-17; never in a repository, a workflow or a Worker). Optional: `ANTHROPIC_API_KEY` is not used by the CLI today (vision QA is held for the human gate, BD-M10a1-06); `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID` for `assets:publish`.
2. **fal balance.** Prepaid credit at least the `plan` estimate, topped up in tranches that keep the cumulative total at or below the remaining cap, auto-recharge off. Two concurrent requests (F-047); the executor runs two jobs at a time.
3. **Liveness and snapshots.** `pnpm genai:liveness` green. `tripo3d/h3.1/multiview-to-3d` and `fal-ai/meshy/rigging` are `pending` constants in `services/pipeline/src/steps/character.ts` (`LEAN_PENDING_ENDPOINTS`, BD-M10a1-02), not rows of `config/genai-endpoints.json`: record their liveness fixtures (`pnpm genai:liveness -- --record tools/assets/test/fixtures/liveness`, no key, after adding the two rows to the registry file) and open a reviewed PR that moves them into the registry file as `active`. Until then a Lean character shows `blocked:ENDPOINT_NOT_CLEARED` in `plan` and the Lean canary cannot start.
4. **Tools.** `ktx` (KTX-Software 4.4.2) on the PATH, or the textures stay PNG and `assets:optimize` prints `SKIP ktx`. `rclone` for publish.
5. **Seed the ledger once.** `pnpm assets:gen -- ledger --seed`, and `pnpm assets:gen -- ledger --import <export.json>` for spend booked elsewhere (for example the M05c3 rows from the M05d ledger export, `{ "rows": [{ "line": "cutscenes", "usdMicros": 5000000, "ref": "m05c3:run-1" }] }`). `pnpm assets:gen -- ledger` prints the totals and the 50, 80 and 100 % alarms.
6. **Style bible (H0).** Put the approved image at `.genai/style-bible/bay-cel@1.png` and record `pnpm assets:gen -- gate --run <runId> --gate H0 --choose 1 --by <profile>`. The CLI does not generate it.
7. **Rig aliases.** `packages/shared/src/rig/bay_rig_v1.json` has no vendor aliases (the M00c spike was skipped, U-AST-1). After the first rig, `pnpm assets:verify -- --slug canary-mc --probe-bones` reads the rigged output, proposes the aliases and writes them with `probed: true`; review them in the PR. Gate A4 never passes on a guessed table.

## Plan (zero vendor calls)

```
pnpm assets:gen -- plan --roster content/npcs/roster.json --tier standard
pnpm assets:gen -- plan --roster content/npcs/roster.json --tier all
```

Every matching `active` entry prints its stages, registry prices, plan keys and gate verdict. A `research: pending` entry, a non-`ok` verdict, a missing soul or the premium preset is `blocked:<reason>` with its estimate still reserved. A Standard estimate above 3,730,000 micros is refused (DL-172). A batch is refused when the ledger plus the estimate passes the characters line or the programme cap. Refuse any slug whose verdict is not `ok`.

### What `plan --tier all` lists (M10a2)

- **Eligible:** every `active` roster entry with a Standard or Lean pipeline, plus the subject card `pc-coast` (below). A published slug prints `done (published): zero outstanding jobs`; a slug with cached stages lists only the stages without a cached result under `.genai/work/` (the run record names the job keys).
- **Reserved:** a `draft` entry with `research: pending`, and every v1 fighter slot of `content/fighter/roster.json` whose fighter has no runnable roster entry yet, print `blocked:research` with one Standard estimate each. Those slots keep their share of the line until Q-19 and Q-25 answer; run `plan` and `run` with the same commands then.
- The last lines give the room left on the characters line after the batch and what it buys in Lean models. With the eight fighter slots, Coast and the canary the line holds 9 Standard characters (34.05 USD with the Lean one), which leaves room for 7 more Lean models, not 12: the R7 caps (8 Standard, 12 Lean) count roster entries and the card is not one, but the USD 42 line is the binding limit.

## Coast first (M10a2, DL-OWN-05, DL-737)

`content/characters/pc-coast/subject.json` is a subject card: the protagonist as a Standard, hero-class character with no soul, no dialogue route and no `data/npc-roster` row. `plan`, `run` and `gate` take it like a roster slug.

```
pnpm assets:gen -- run --slug pc-coast --until sheet --live      # style bible H0 first; the owner sheet (WebP) is ref-1 beside the style bible
pnpm assets:gen -- gate --run pc-coast-<id> --gate H1 --choose <n> --checklist --by owner     # H1 and H3 take only --by owner
```

The sheet `content/characters/pc-coast/sheet.webp` (BD-COAST-SHEET-01) is a first-party reference only; it is never a video reference. After H5, `assets:lock`, then the split into the six creator rows:

```
pnpm assets:coast -- split --by <profile>     # character/pc-<slot>-coast x 3 fidelities + portrait/pc-<slot>-coast, specs, derived records
pnpm assets:lock -- --approved-by <handle>    # review the lock diff
pnpm assets:coast -- link                     # sets model and portrait on the six Coast catalog rows from the lock
pnpm assets:coast -- check
```

The split groups triangles by the bone they are weighted to and splits the head into hair and face at a hairline; both live in `content/characters/pc-coast/split.json`, which the art lead tunes at the H4 review. Every part file keeps the whole character's texture (BD-M10a2-06). A hand-split set published as the same six refs replaces the output with no other change. A row without a model keeps the mannequin path, so a skipped split is safe.

## Fighter clips (M10a2)

No signature clips exist until the art lead delivers them (Q-24). Every move plays the library clip listed in `content/fighter/clip-fallbacks.json` (`pnpm --filter @dv/mode-fighter fighter:gen-clip-fallbacks`, checked by `check:fighter`). To bake authored clips: give the mannequin clip file a provenance record (`provenance:new`, origin authored), then

```
pnpm assets:retarget -- --rig bay_rig_v1 --clips assets/src/anim/mannequin/<file>.glb --to <slug> --fps 60 --spec --by <profile>
```

`--spec` writes `retarget.json` (the A5 result per clip), `asset.json` and the derived provenance record beside `anim/<slug>.moves`; `check:fighter` then holds the file to the kit: clip names equal the move ids and each `extras.frames` is the move's total frames at the declared fps.

## Batch report

`pnpm assets:gen -- batch-report` writes `docs/runbooks/reports/M10a2-batch.md` (slugs, gates, cost per slug from the ledger, fallback moves, Coast rows); a unit test fails when the committed file is stale. After comparing the ledger with the fal dashboard, record `assets/ledger/reconcile.json` as `{ "dashboardMicros": <n>, "note": "<difference and why>" }` and regenerate the report (AC-8).

## Canary (M10a1): `canary-mc` (Standard) and `ro-batista` (Lean)

Two originals while Q-19 is open. Expected spend about USD 4.72 (3,666,590 + 1,052,000 micros); the milestone allows 7,300,000 micros.

```
pnpm assets:gen -- run --slug canary-mc --until sheet            # dry run: the estimate, no vendor call
pnpm assets:gen -- run --slug canary-mc --until sheet --live     # tier check, sheet x3, gates A1 and A2, stops at H1
pnpm assets:gen -- gate --run <runId> --gate H1 --choose 2 --by <profile>
pnpm assets:gen -- run --slug canary-mc --until mesh --live      # crops, portraits, mouth atlases, two meshes, A3; stops at H2 then H3
pnpm assets:gen -- gate --run <runId> --gate H2 --choose 1 --atlas 2 --by <profile>
pnpm assets:gen -- run --slug canary-mc --until mesh --live
pnpm assets:gen -- gate --run <runId> --gate H3 --choose 1 --by <profile>
pnpm assets:gen -- run --slug canary-mc --until rig --live       # rig, A4; a 422 falls to the other mesh; stops at H4
pnpm assets:gen -- gate --run <runId> --gate H4 --choose 1 --anchor 0,1.55,0.09 --jaw --by <profile>
pnpm assets:gen -- run --slug canary-mc --until publish --live   # optimize (A6, A7), specs and provenance (A8); stops at H5
```

The same eight commands run `ro-batista` with `--tier lean`: no H0, no portrait or mouth atlas, no H2. Each `gate` command records into `.genai/work/character/<slug>/run.json`; a human gate is never crossed without a recorded decision. H1 for a `parody` or `fictionalized` design prints the legal L1 checklist and needs `--checklist`. The H1 to H5 meanings are in `05-assets-pipeline.md` section 2; A1 and A2 are held for you because no vision model is wired (the report in `.genai/work/character/<slug>/reports/` says `held`).

A rejected candidate is kept in `.genai/work/` for audit. To redo a stage with a new seed, record a rejection (`gate ... --reject`) and re-run the stage with `--retake <stage> --attempt <n> --owner-signoff "<who, when, why>"` (a new seed); a retake is a new job key and costs again. It is booked on the `buffer` line (USD 2, DL-OWN-07), never on the characters line, and the command refuses without the owner's sign-off (Q-26), which the ledger row keeps in its `note` (M10a2, BD-M10a2-10).

## Optimize, verify, publish

`run --until publish` already optimizes and writes `assets/src/character/<slug>/`, `assets/src/anim/<slug>.base/`, the portrait, the atlas and the provenance records. By hand:

```
pnpm assets:optimize -- --slug canary-mc            # three fidelities, A6 and A7
pnpm assets:retarget -- --rig bay_rig_v1 --clips <mannequin-clips.glb> --to canary-mc   # M10a2: authored fighter moves
pnpm assets:lock -- --approved-by <handle>          # after the H5 review of the lock diff
pnpm assets:verify -- --slug canary-mc              # A4, A6, A7, A8, likeness, lock
pnpm assets:publish -- --env staging --slug canary-mc
pnpm provenance:check && pnpm likeness:gate         # on the publish PR
```

## Close-out

`pnpm assets:gen -- ledger --line characters` shows at most 7,300,000 micros added by the canary. Reconcile with the fal dashboard (the ledger holds the reserved estimate, BD-M10a1-10) and record the cost per slug from the ledger rows (`ref` is the job key). Re-run `plan`: the finished slugs have nothing outstanding, and `run` makes zero `FalPort` calls for them (every stage is a cache hit by job key).

## Rollback

A rejected character is killed through the kill-switch procedure of section 10 in staging, then re-run from the sheet stage with a new seed; the old candidates stay in `.genai/work/` and in `PRIVATE work/` when R2 keys exist.
