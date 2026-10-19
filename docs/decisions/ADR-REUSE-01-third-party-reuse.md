# ADR-REUSE-01 — Third-party reuse register

**Status:** accepted · **Date:** 2026-10-19 · **Decides:** spec/03 D-31; DL-OWN-03 as narrowed; DL-501…DL-509

## Context
On 2026-10-19 the owner wrote "we can reuse assets from the given repos" for nine sources (DL-OWN-03). Until then every example repository was clean-room only: only prose pattern cards crossed [research/legal-ip-likeness.md §2.2; research/INDEX.md §4 rules 2, 3, 5]. The owner's permission cannot license someone else's IP, so reuse is possible only where the licence allows it and no other publisher's material is inside. Licences checked 2026-10-18 [research/legal-ip-likeness.md §2.1; research/repos-world.md §2, §4; research/repos-modding.md §2; F-056]; no upstream file list is verified yet.

## Options considered
1. **Keep the blanket ban.** Ignores two usable MIT sources.
2. **Reuse everything listed.** Imports material derived from another publisher's game, GPL and all-rights-reserved code [research/legal-ip-likeness.md §2.1; research/repos-webport.md].
3. **Licence-based register with vendored allowlists** (chosen).

## Decision
- **Register.** `docs/legal/third-party-reuse.json` holds one entry per source (licences, verdict, reason, uses). It sits under `docs/legal/`, already on the `ip:strings` path allowlist, because it must name excluded sources. It replaces the blanket clean-room rule. Verdicts: `REUSE-WITH-ATTRIBUTION` (files in `allowedPaths` may be vendored and used): Atlas and a universal-modder subset; `PATTERNS-ONLY` (existing `research/` pattern cards only): San-Francisco; `EXCLUDED` (nothing copied, no new patterns): SK8V, muguet, playgta5, Grand-V, gta-sa-earth; `DEV-TOOL-ONLY` (operator or Architect machine only; no result sets, checks or corrects committed data): Mapbox CLI.
- **Per-path licences.** Each `allowedPaths` item is `{path, spdx, kind: 'code' | 'data', fields?, modified}`; gates check each item, never the entry, and the root `REUSE.toml` annotates each path with its own SPDX id (Atlas `app/render.js` MIT; the dataset subset CC-BY-4.0).
- **How reuse happens (DL-502).** Only the operator or the Architect vendors, at a pinned SHA, with the upstream `LICENSE` and a `third_party/NOTICE` entry, into the code branch, after the gates session `spec/followups/reuse-gates.md` has merged. A file with any excluded field (name, description, tagline, URL, logo, person, coordinate, or an address, city, neighbourhood or district, location, OSM id, building id, footprint-link or other geocoded field; DL-523) enters only as a `.subset.json` written by the gates session's extraction tool from an explicit field allowlist (each field with a reviewer note that it is authored upstream, not OSM- or Nominatim-derived) and marked modified. Company and person names never enter `third_party/`; they go to `DV_NAMES_REAL_JSON` or `content-private/`. A file that trips `ip:*` is dropped, never exempted. Builders read only allowlisted `third_party/` files; they never vendor, edit the register, or open, fetch or search an upstream. Until vendored, milestones proceed without it.
- **Ported code** carries an `SPDX-License-Identifier` line, the upstream copyright line verbatim and a "Portions from `third_party/<name>/<path>`" header, porting algorithms only (no string, URL or coordinate literal); **reused data** gets a C07 provenance record (`origin: open_data`, licence, attribution, `derived_from` the vendored hash).
- **Uses (first consumer).**
  - Atlas `app/render.js`: optional starting point for the in-engine Canvas 2D maps (**M02c2**). Atlas geometry is not vendored; our OSM bake replaces it.
  - Atlas company dataset: categorical fields only (CC BY 4.0) as seed data for the Business Tycoon `ai-tooling` sector (**M09b1**). Its locations and building links come from Nominatim and OSM [research/repos-world.md §2.3], so they are ODbL and never vendored. Shipped text uses invented names (D-29); no logos.
  - universal-modder: secret-scan pattern classes, knowledge-base and skills layout, and the publish-check idea for the mod kit (**M13a6**, DL-505).
  - Mapbox: **default pending Q-44**: D-25 stands (no Mapbox runtime; nothing baked or cached). Never in a Builder session (Product Terms §1.6, research/repos-world.md §4). A live Mapbox layer needs a later ADR.
- **Attribution (DL-507).** `pnpm build` emits `apps/web/dist/third-party-licenses.txt` with each vendored upstream `LICENSE` verbatim; every distributable package holding a ported file (`tools/cli`, `packages/mod-sdk`, the `dv init` kit) ships a generated `THIRD_PARTY_LICENSES.txt`, and ported kit files carry the MIT permission text or a pointer to it. The credits page lists each `third_party/NOTICE` entry. CC BY lines name the creator, the licence URL and "modified" when changed.
- **Gates (DL-508).** Code items MIT or Apache-2.0; data items CC-BY-4.0. No GPL, AGPL or LGPL; copyleft, ODbL-1.0 or any other licence needs its own ADR. `ip:*` denylists and path allowlist unchanged; `third_party/` is never allowlisted, is ESLint- and Vitest-ignored, and is never imported outside `tools/{map,assets,ci,soul}`; `check:bundle` fails on a module id under it; `license:scan`, `provenance:check` and `names:lint` apply. M14b3's `ip:similarity` reports a match as `expected` only when the Zone R report's matched upstream (repository and path) equals the file's "Portions from `third_party/<name>/<path>`" header and that path is in `allowedPaths` at `pinnedSha`; a clone against any other upstream or path fails, even in a file with a valid header (DL-523). The PR template attests that no upstream example repository was opened, fetched or searched and nothing was consulted or copied except allowlisted `third_party/` files. `license:scan` also gates the CC BY attribution: a data item's `NOTICE` line must carry the licence URL and "modified" when modified, the licences file header repeats it, and `credits.json` must hold the `NOTICE` line of every used item (DL-523).

## Consequences
- (+) Two permissive sources become usable with an audit trail; no milestone waits on vendoring.
- (−) The Atlas renderer uses its own perspective projection; porting may cost more than writing from `02-world-maps.md` §2.

## Affected contracts and milestones
No contract change. `spec/followups/reuse-gates.md` (gate tooling, before the first vendoring); M02c2, M09b1, M13a6 (optional input); M00b unchanged (frozen); M04b1 credits page; M14b3 `ip:similarity` (DL-508).

## Links
`docs/legal/third-party-reuse.json`; `spec/11-decision-log-5.md`; ADR-0013; ADR-0021; `research/legal-ip-likeness.md` §2; `research/repos-world.md` §2, §4; `research/repos-modding.md` §2.
