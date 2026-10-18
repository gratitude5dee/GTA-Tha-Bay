# ADR-0013 — Likeness tiers and kill-switch

**Status:** accepted (gated decision G2, default applied 2026-10-18) · **Date:** 2026-10-18 · **Decides:** spec/03 D-29; R-NPC-04, R-IP-02

## Context
The roster is modelled on Bay Area tech and culture figures. Real faces, voices and names carry publicity, defamation and platform-policy risk. No generation provider offers a parody exception for real people [research/legal-ip-likeness.md §3.4]. ElevenLabs allows professional voice clones of the speaker's own voice only [F-051]. Anything that is live must be removable fast, and the game must never block when it is removed.

## Options considered
1. **Consent for everyone.** Not achievable for the roster in time; consent outreach is ordered but slow (research/INDEX.md §7).
2. **Parody for everyone.** Deceased people and founders of real companies carry higher risk than living public figures, so they get a stricter tier.
3. **Three tiers with a per-stage gate and a live kill-switch** (chosen). A face-similarity check to police `fictionalized` was rejected: it is biometric processing and contradicts R-IP-04 (DN-S05-3).

## Decision
- **Tiers.** `consented` (needs a scoped `consent_record`; the only tier that may use real photos or a voice clone), `parody` (living people), `fictionalized` (deceased people and founders of real companies, including Mac Dre). C07 adds `original` for invented characters; cutscene keys and asset tiers use C10 `assetTier()`. Minors are never in the roster.
- **Rules for non-consented tiers.** Appearance comes from the soul's text `visual_brief`; photographs never reach a generator; `parody` is renamed (normalised edit distance ≥ 0.4), caricatured in text only, free of real tattoos, jerseys, logos and catchphrases, outside the person's fame domain, never criminal, sexual, drug-related or gory, carries a disclaimer and never appears in marketing; no photoreal presets (`toon-pbr` only); no voice cloning (`voice_design` or presets).
- **Gate.** `assertStageAllowed` runs at the entry of every pipeline stage and again before `record` (unknown tier or `soul.minor` → refuse; face reference → `FACE_REF_FORBIDDEN`; clone without a live consent → `CLONE_FORBIDDEN`; prompt lint → `NAME_IN_PROMPT`; expired consent → `CONSENT_EXPIRED`; kill switch or budget → refuse, cache hits still served). `pnpm likeness:gate` checks records and source (no `FaceLandmarker`) in CI from M00b. Rendered sheets also pass a vision-model check for apparent minors, nudity, logos and readable names.
- **Kill-switch.** A `roster_flag` write (admin route) takes effect live in ≤ 60 s (KV `roster:flags` with a 30 s Worker cache, `EncounterDO` broadcast, client `WorldPackStore.evictByTag('char:<id>')`); `KillPurgeWorkflow` quarantines and deletes objects, purges `media.<domain>/characters/<slug>/` and affected `cutscenes/<key>/`, and writes a new catalog within 24 h. A quarterly drill (M10b `@kill-drill`) proves absence from spawn tables, roster and cutscene index and a 404 on the prefix.
- **Stand-ins.** Every real-derived character has a `standIn` so missions and saves never block; stand-ins are authored original bodies with a palette variant, not fal output (DL-180). Cutscenes fall back to the in-engine director (R-CUT-03).
- **Gate defaults (G2).** Consent outreach order: Ray Fernando and Adil Mania, then P-Lo, Jay Anthony and 1 Umbrella, then the Mac Dre estate. Real-derived souls and research live only in `content-private/` (DL-118, Q-25).

## Consequences
- (+) A takedown is a flag, not a redeploy; the story and saves survive any single removal.
- (+) Non-consented characters carry no photo-derived data, shrinking legal exposure.
- (−) Stand-ins and the toon-only rule limit visual fidelity of real-derived characters.
- (−) The tier assignment per person is a legal judgement; counsel review (Q-23) precedes public launch.

## Affected contracts and milestones
C10 (soul tier, `standIn`, `ugcCameo`), C07 (`LikenessSummary`, `GateCode`), C09 (cutscene keys), C12 (`RosterFlags`, kill route 46). M00b (`likeness:gate`), M06a2–M06a4, M08b1–M08b2 (roster gates, kill remap), M10a–M10c (batch, drill, souls), M13d1.

## Links
`research/legal-ip-likeness.md`; `research/INDEX.md` §4 rules 6–10, §7 G2; `spec/domains/05-assets.md` §5.4–5.5; `04-npc-contracts.md`; `spec/11-decision-log.md` DL-088, DL-118, DL-180; ADR-0014, ADR-0023.
