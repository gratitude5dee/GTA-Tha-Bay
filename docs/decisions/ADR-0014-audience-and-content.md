# ADR-0014 — Audience and content

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-30; DL-139, DL-140; owner questions Q-02, Q-06

## Context
The game is a crime-flavoured open world with AI characters. Its vendors set age floors: fal requires customer-solution End Users to be 18+ [F-042]; Anthropic's acceptable-use policy defines minors as under 18 [F-038]; ElevenLabs bars apps directed at under-18s without approval [F-051]; Google bars services likely accessed by under-18s [F-049]. US children's privacy law blocks under-13 data collection. California AB 1043 turns OS age signals into "actual knowledge" from 2027-01-01 [research/legal-ip-likeness.md §5.3].

## Options considered
1. **17+ with a teen path** (chat off, no premium voices, reviewed publishing). Lower vendor risk than open access but needs consent flows and moderation tuned for minors in every feature.
2. **13+.** Conflicts with the vendor terms above and with the content.
3. **18+ terms of service with 17+ content, every under-18 bracket blocked in v1** (chosen). Research recommended 17+; the trust-and-safety report recommended 18+ eligibility because of the vendor terms; the owner default is 18+ (Q-02).

## Decision
- **Eligibility.** Terms of service require 18+. Content is rated for 17+ (`TEEN_MODE=false`). A neutral age screen (free entry of day, month and year in locale order, no threshold text, no retry prompt) runs before play; 18 or older → bracket `18p`; younger → a single neutral `BlockedPage` on every launch, with no network call and no telemetry from that session. Clearing site data bypasses it, which is accepted.
- **Why blocked, not limited (DL-139).** The `AgeBracket` type (`u13`, `13_15`, `16_17`, `18p`) stays so a later `TEEN_MODE` needs no migration; v1 treats all under-18 brackets as blocked. NPC memory, premium voice and publishing are therefore adult-only by construction; the 30-day transcript and 180-day memory retention rules still apply (ADR-0023).
- **OS age signals.** An `AgeSignalProvider` stub returns `null` in v1 (API shape UNVERIFIED); M14b wires it, and a signal under 18 overrides the typed date.
- **Content line (Q-06).** No firearms, gore or real-person crimes; sideshows and drift stay; mission content in the Bayview–Hunters Point and Tenderloin districts passes a community sensitivity read before release (Q-21). NPCs stay game-topic characters with a safety card and an "AI character" badge.
- **Player-triggered media.** Generation of images, video or custom 3D from player input and premium voice require an 18+ attestation and identity tier P2 or higher (D-30). Under DL-OWN-01 no player-triggered fal generation exists in v1, so this clause is a precondition for any later enablement, not a v1 feature; text-only builder drafts (`builder_text`) are allowed from P0 (DL-119).
- **Telemetry.** Both consent toggles default on with a first-run card and one-tap off, device-scoped, US only in v1 (DL-140); counsel reviews before any EU/UK launch (Q-23d).

## Consequences
- (+) One consistent rule across every vendor contract; no minors' data paths to build or defend.
- (+) Moderation tuning, voice vendors and the Gemini fallback (ADR-GENAI-01) stay available.
- (−) A smaller audience; teens are turned away rather than served a reduced game.
- (−) Self-declared age is weak evidence; AB 1043 signals and counsel sign-off at M14b are the strengthening steps.
- (−) A blocked session shows no reason by design, which can confuse an adult who mistypes a date; the screen allows a retry only for an invalid date.

## Affected contracts and milestones
C12 (`AgeBracket`, `attestAge`, play token `age: '18p'`), C05 (`ProfileSettings.privacy`), C16 (consent). M04b1 (age gate, terms), M06a1 and M06b1 (quota and builder rules), M12a2 (age register), M14b (signals, counsel).

## Links
`research/legal-ip-likeness.md` §5.3, P3–P4; `research/gap-trust-safety-tooling.md`; `spec/domains/10-ui-pages.md` §age gate; `spec/00-plan.md` Q-02, Q-06; `spec/11-decision-log.md` DL-119, DL-139, DL-140, DL-205; ADR-0009, ADR-0013, ADR-0015.
