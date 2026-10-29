# Roster batch report (M10a2)

Written by `pnpm assets:gen -- batch-report`. Do not edit by hand: regenerate after every ledger or lock change (`docs/runbooks/roster-batch.md`).

- Slugs in the plan: 10 (2 eligible, 8 blocked with their estimate reserved, 0 refused)
- Published (in `assets/assets.lock.json`): 0
- Characters line: $0.00 spent of $42.00; reserved and eligible estimates not yet spent leave $7.95 (7,948,690 micros), room for 7 more Lean models at $1.05
- Reconcile with the fal dashboard: not done yet (the operator records `assets/ledger/reconcile.json` after comparing the ledger with the dashboard; AC-8)
- Live batch: not run: the build container holds no FAL_KEY and no R2 keys, so no stage called fal and nothing was published (the operator runs the commands of `docs/runbooks/roster-batch.md`, Q-17)

## Slugs

| Slug | Tier | Plan | Estimate | Spent | Gates recorded | Published |
|---|---|---|---|---|---|---|
| pc-coast | standard | ok | $3.67 | $0.00 | none | no |
| ro-batista | lean | blocked:ENDPOINT_NOT_CLEARED | $1.05 | $0.00 | none | no |
| canary-mc | standard | ok | $3.67 | $0.00 | none | no |
| rap-hyphy-elder | standard | blocked:research | $3.67 | $0.00 | none | no |
| rap-lyricist | standard | blocked:research | $3.67 | $0.00 | none | no |
| tech-visionary | standard | blocked:research | $3.67 | $0.00 | none | no |
| tech-hacker | standard | blocked:research | $3.67 | $0.00 | none | no |
| ath-shooter | standard | blocked:research | $3.67 | $0.00 | none | no |
| ath-power-back | standard | blocked:research | $3.67 | $0.00 | none | no |
| influencer | standard | blocked:research | $3.67 | $0.00 | none | no |

## Gate decisions

No human gate has a recorded decision. H1 and H3 of `pc-coast` are signed by `owner` only (the subject card).

## Blocked and reserved

- ro-batista [lean]: blocked:ENDPOINT_NOT_CLEARED (tripo3d/h3.1/multiview-to-3d is not cleared (ADR-GENAI-01); dev calls are refused) ($1.05 reserved)
- rap-hyphy-elder [standard]: blocked:research (RAP_HYPHY_ELDER: soul dev_hyphy_elder is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- rap-lyricist [standard]: blocked:research (RAP_LYRICIST: soul dev_lyricist is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- tech-visionary [standard]: blocked:research (TECH_VISIONARY: soul dev_visionary is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- tech-hacker [standard]: blocked:research (TECH_HACKER: soul dev_hacker is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- ath-shooter [standard]: blocked:research (ATH_SHOOTER: soul dev_shooter is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- ath-power-back [standard]: blocked:research (ATH_POWER_BACK: soul dev_power_back is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)
- influencer [standard]: blocked:research (INFLUENCER: soul dev_influencer is not eligible, real-derived souls wait for Q-19 and Q-25; one Standard estimate stays reserved) ($3.67 reserved)

## Cost per slug (ledger rows by stage)

The ledger has no row for any slug of the batch.

## Planned stages

- pc-coast: sheet 3 x openai/gpt-image-2.5/sunburst/edit; portrait 2 x openai/gpt-image-2.5/sunburst/edit; mouth_atlas 2 x openai/gpt-image-2.5/sunburst/edit; mesh 2 x meshy/v7.1/multi-image-to-3d; rig 1 x fal-ai/meshy/rigging/multi-animation
- canary-mc: sheet 3 x openai/gpt-image-2.5/sunburst/edit; portrait 2 x openai/gpt-image-2.5/sunburst/edit; mouth_atlas 2 x openai/gpt-image-2.5/sunburst/edit; mesh 2 x meshy/v7.1/multi-image-to-3d; rig 1 x fal-ai/meshy/rigging/multi-animation

## Moves that play library clips

Until the art lead's signature clips are baked (Q-24) every move of a kit plays the procedural library clip below; frame data is unchanged (`content/fighter/clip-fallbacks.json`).

| Kit | Moves on a library clip | Moves on an authored clip | Library clips (move id to clip) |
|---|---|---|---|
| ath_power_back | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, shoulderCharge cast.2, collarToss cast.2, brace cast.2, wreckingRun super.2, fullClearance super.2, shutdown taunt.0, taunt taunt.0 |
| ath_shooter | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, arcShot cast.2, backstepFade slide.2, lobCover cast.2, tripleArc super.2, gumballVolley super.2, shutdown taunt.0, taunt taunt.0 |
| influencer | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, hotTake cast.2, swapPlaces slide.2, pollPop cast.2, viralMoment super.2, trending super.2, shutdown taunt.0, taunt taunt.0 |
| rap_hyphy_elder | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, slangWave cast.2, skidDash slide.2, frenzy cast.2, turfRush super.2, overdrive super.2, shutdown taunt.0, taunt taunt.0 |
| rap_lyricist | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, wordSalvo cast.2, rewind cast.2, hardStop rising.2, wallOfWords super.2, finalDraft super.2, shutdown taunt.0, taunt taunt.0 |
| rap_new_wave | 17 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, pulseNear cast.0, stepDash slide.2, detonate cast.2, pulseMid cast.1, pulseFar cast.2, markerChain super.2, floorTakeover super.2, shutdown taunt.0, taunt taunt.0 |
| tech_hacker | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, patch cast.2, glitchStep slide.2, echo rising.2, hotfixBarrage super.2, rollback super.2, shutdown taunt.0, taunt taunt.0 |
| tech_visionary | 15 | 0 | 5L jab.0, 5M cross.1, 5H haymaker.2, 2L lowJab.0, 2M lowCross.1, 2H sweep.2, jM airKick.1, throw throw.0, dispatchAgent cast.2, pivot slide.2, recall rising.2, roadmapRush super.2, hardPivot super.2, shutdown taunt.0, taunt taunt.0 |

## Coast rows

The protagonist model is split into six creator rows (`content/characters/pc-coast/subject.json`). A row without a model keeps the mannequin path (DL-737); `assets:coast -- link` sets `model` and `portrait` from the lock once the parts are published.

| Row | Slot | Model | Portrait |
|---|---|---|---|
| body-coast | body | none (mannequin) | none |
| face-coast | face | none (mannequin) | none |
| hair-coast | hair | none (mannequin) | none |
| top-coast-hoodie | top | none (mannequin) | none |
| bottom-coast-jeans | bottom | none (mannequin) | none |
| shoes-coast-sneakers | shoes | none (mannequin) | none |
