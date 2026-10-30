# Third-party art vetting checklist (M10d0, DL-OWN-06)

Every third-party file enters the repository through this list. A file that fails any rule is dropped, not patched. When the origin is unclear the answer is no.

The tool `pnpm assets:import -- vet <dir>` reads intake records (`assets/intake/<pack>/<item>.json`, schema `config/schemas/art-intake.schema.json`) and applies the rules marked **auto**. The reviewer answers the rules marked **reviewer** in the record's `answers` block; a question left `null` rejects. The gate `pnpm provenance:check` then refuses a `licensed` provenance record that has no `{gate: 'art-vetting', decision: 'approve'}` review.

## 1. Admit the pack first

| Step | Rule | Id |
|---|---|---|
| 1.1 | The source host is in `docs/legal/licenses/packs.json`. A pack is added only with a dated snapshot of its licence text, the snapshot's SHA-256 and a `spec/03` section 7 row. | V-PACK, **auto** (`art-host-unknown` in the gate) |
| 1.2 | The licence is the pack's licence and is CC0-1.0 or CC-BY-4.0. NC, ND, SA and editorial-only terms are refused. | V-LICENCE, **auto** (`art-licence-mismatch`, `art-licence-restricted`) |
| 1.3 | The snapshot file still has the recorded hash. | **auto** (`art-snapshot-altered`) |
| 1.4 | A CC-BY file carries an attribution `"<title>" by <author> (<source url>), licensed under CC BY 4.0 (<licence url>). Changes: <what changed>.` | **auto** (`art-attribution-incomplete`) |

A CC0 pack gets a courtesy line in Credits (`courtesy` in the register); CC0 asks for nothing and the line is a thank-you.

## 2. Origin

| Step | Rule | Id |
|---|---|---|
| 2.1 | The author is named on the source page, and there is evidence the author made the file: a portfolio, work-in-progress images, a wireframe, the vendor page or the source files. No evidence rejects. | V-EVIDENCE, **auto** |
| 2.2 | The origin is clear to the reviewer. An item that looks lifted from a game, a film or a scan of someone else's work is rejected. | V-ORIGIN, **reviewer** |
| 2.3 | The uploader is not franchise-heavy: no denylisted term in the name and under 25 % of their items are franchise material. | V-UPLOADER, **auto** |
| 2.4 | No franchise tags and no franchise string in the title or file names. | V-TAG, V-DENYLIST, **auto** (the terms are in `config/ip-denylist.json`) |
| 2.5 | No game-style names: `_lod0`, `vehshare`, a `_hi` token, or a game-format extension (`.yft`, `.ytd` and the rest of the denylist). | V-NAME-LOD0, V-NAME-VEHSHARE, V-NAME-HI, V-NAME-EXT, **auto** |

## 3. Content

| Step | Rule | Id |
|---|---|---|
| 3.1 | No real make or model names in titles, file names or tags. | V-MAKE, **auto** (`config/art-vetting.json`) |
| 3.2 | No real badges, grilles or logos on a vehicle. | V-LOGO, **reviewer** |
| 3.3 | **Silhouette, every vehicle item.** The reviewer puts the side and the three-quarter profile next to the denylisted makes. On a match the item is remodelled or dropped. Low-poly packs such as OpenGameArt and Quaternius often follow real cars; they get no exemption. | V-SIL, **reviewer** (`answers["V-SIL"]` is `pass` or `fail`; unanswered rejects) |
| 3.4 | No storefront or brand logos. | V-LOGO, **reviewer** |
| 3.5 | No people and no scans of people (face, body, likeness). | V-PERSON, **reviewer** |
| 3.6 | No murals and no public art. | V-MURAL, **reviewer** |
| 3.7 | San Francisco landmarks: geometry in the world only, never a logo or key art (`research/legal-ip-likeness.md`, landmark marks). | **reviewer** |

## 4. Special sources

- **Sketchfab and OpenGameArt:** handled alike. Take a snapshot of the item page (title, author, licence text, date) beside the pack licence snapshot. `SKETCHFAB_API_TOKEN` access is UNVERIFIED, so the owner downloads by hand into the git-ignored `content-incoming/`; nothing in that folder is committed or published before it has an intake record and a review.
- **Poly Haven:** its API asks for a unique User-Agent; the importer sends one that names the project and a contact.
- **Freesound:** its terms are still open (U-AST-10); no audio is admitted yet.
- **Generated art:** not this list. It follows the generation gates and the fal line budget in `config/guardrails.yaml`.

## 5. After approval

1. Write the `licensed` provenance record of each source file (`source.url`, the pack's SPDX id, the author, the `art-vetting` review).
2. Derived files (a KTX2 encode, a remodel, an atlas) get `derived` records whose `derived_from` reaches the licensed root.
3. Run `pnpm provenance:check`, `pnpm license:scan`, `pnpm ip:signatures`, `pnpm ip:strings` and `pnpm names:lint`.
4. The credits page picks the attribution up from `credits.json` (`art[]`).
