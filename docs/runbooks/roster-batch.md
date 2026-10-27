# Runbook: roster batch and the live canary

The character pipeline of `spec/domains/05-assets-pipeline.md` section 12 as commands. M10a1 ships the tools and the two-character canary; M10a2 runs the batch. **Only the operator or the art lead runs anything with `--live`.** CI never does (`FAL_MODE: mock` in every workflow, `run --live` refuses while `CI` is set). The hard cap for all fal spend is USD 100 (DL-OWN-01); the character line is USD 42 (`config/guardrails.yaml` `genai.lines`).

## Before the first live command

1. **Keys.** `FAL_KEY` in your shell (Q-17; never in a repository, a workflow or a Worker). Optional: `ANTHROPIC_API_KEY` is not used by the CLI today (vision QA is held for the human gate, BD-M10a1-06); `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID` for `assets:publish`.
2. **fal balance.** Prepaid credit at least the `plan` estimate, topped up in tranches that keep the cumulative total at or below the remaining cap, auto-recharge off. Two concurrent requests (F-047); the executor runs two jobs at a time.
3. **Liveness and snapshots.** `pnpm genai:liveness` green. `tripo3d/h3.1/multiview-to-3d` and `fal-ai/meshy/rigging` are registry rows with `status: pending` (BD-M10a1-02): after liveness has confirmed both ids, open a reviewed PR that sets them to `active`. Until then a Lean character shows `blocked:ENDPOINT_NOT_CLEARED` in `plan` and the Lean canary cannot start.
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

A rejected candidate is kept in `.genai/work/` for audit. To redo a stage with a new seed, record a rejection (`gate ... --reject`) and re-run the stage with `--retake <stage> --attempt <n>` (a new seed); a retake is a new job key and costs again, from the $2 buffer only with owner sign-off (Q-26).

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
