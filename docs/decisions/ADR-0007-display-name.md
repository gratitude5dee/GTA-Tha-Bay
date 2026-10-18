# ADR-0007 — Display name

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-07; R-IP-01; owner question Q-01

## Context
The project codename carries a franchise abbreviation that is a live registered mark for game software (Take-Two, Reg. 3439237) [F-067]. Shipping it would invite a trademark claim and a store or hosting takedown. The owner's working title is "Dee-Verse: Tha Bay", and the owner may rename after counsel review.

## Options considered
1. **Ship the codename.** Direct conflict with a live mark [F-067].
2. **Hard-code a new name in strings.** Makes a later rename a repository-wide edit and invites drift between UI, manifest and legal pages.
3. **One configuration value, enforced by CI** (chosen).

## Decision
- The display name exists once: `config/brand.ts` exports `DISPLAY_NAME`, default **"Dee-Verse: Tha Bay"**. The web manifest `name`, page titles, credits and legal pages read it; i18n catalogs use a `{brand}` placeholder and never contain the literal (M00 acceptance checks both).
- The franchise abbreviation appears nowhere shipped: not in code, file names, package names, UI strings, builds or marketing. Planning files (`spec/`, `research/`, `prompt-pack/`) may name the codename; shipped output may not.
- Enforcement: `pnpm ip:strings` scans source and dist against `config/ip-denylist.json` (spec and research folders excluded); `pnpm names:lint` fails when the `DISPLAY_NAME` literal appears outside `config/brand.ts` (the same tool also checks NPC display names against the real-side name list in the CI-only `DV_NAMES_REAL_JSON`). Both run from M00b on every pull request.
- The repository is renamed before it becomes public (research constraint 1).
- The owner may override `DISPLAY_NAME` after counsel review (Q-01); the change is a one-file commit plus regenerated icons and legal snapshots.
- Fictional vehicle makes, venues and transit operators follow the same rule: names pass `names:lint`, and a counsel knock-out (Q-23a) precedes launch; renaming is a data commit.

## Consequences
- (+) A rename needs no code change; CI blocks regressions.
- (−) Spec files cannot be linted for the codename, so reviewers must watch for it in copied text.
- (−) Search discoverability tied to the codename is lost by design.

## Affected contracts and milestones
No contract shape. M00 (manifest from `DISPLAY_NAME`, i18n placeholder), M00b (`ip:strings`, `names:lint`), M14b (knock-out applied, DN-S06-02), every milestone that adds UI text.

## Links
`spec/03-decisions-and-facts.md` A-07; `research/legal-ip-likeness.md`; `research/INDEX.md` §4 rules 1–2, 6; `spec/99-open-questions.md` Q-23; `spec/00-plan.md` Q-01.
