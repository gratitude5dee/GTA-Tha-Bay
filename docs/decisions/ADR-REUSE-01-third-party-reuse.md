# ADR-REUSE-01 — Third-party reuse register

**Status:** accepted · **Date:** 2026-10-19 · **Decides:** spec/03 D-31; DL-OWN-03 as narrowed; DL-501…DL-509, DL-607, DL-614…DL-617, DL-629…DL-634, DL-646…DL-648

## Context
On 2026-10-19 the owner wrote "we can reuse assets from the given repos" for nine sources (DL-OWN-03). Until then every example repository was clean-room only [research/legal-ip-likeness.md §2.2; research/INDEX.md §4 rules 2, 3, 5]. The owner cannot license someone else's IP, so reuse is possible only where the licence allows it and no other publisher's material is inside. Licences checked 2026-10-18 [research/legal-ip-likeness.md §2.1; research/repos-world.md §2, §4; research/repos-modding.md §2; F-056]; no upstream file list is verified.

## Options considered
1. **Keep the blanket ban.** Ignores two usable MIT sources.
2. **Reuse everything listed.** Imports material derived from another publisher's game, GPL and all-rights-reserved code [research/legal-ip-likeness.md §2.1; research/repos-webport.md].
3. **Licence-based register with vendored allowlists** (chosen).

## Decision
- **Register.** `docs/legal/third-party-reuse.json` holds one entry per source (licences, verdict, reason, uses, the `name` of its `third_party/<name>/` directory, the `noticeLine` format; DL-617). It is on the `ip:strings` path allowlist (`docs/legal/`). It replaces the blanket clean-room rule. Verdicts: `REUSE-WITH-ATTRIBUTION` (files in `allowedPaths` may be vendored and used): Atlas and a universal-modder subset; `PATTERNS-ONLY` (existing `research/` pattern cards only): San-Francisco; `EXCLUDED` (nothing copied, no new patterns): SK8V, muguet, playgta5, Grand-V, gta-sa-earth; `DEV-TOOL-ONLY` (operator or Architect machine only; nothing committed): Mapbox CLI.
- **Per-path licences.** Gates check each `allowedPaths` item (`{path, spdx, kind, fields?, modified}`), never the entry; the root `REUSE.toml` gives each path its SPDX id.
- **How reuse happens (DL-502).** Only the operator or the Architect vendors, at a pinned SHA, with the entry's `licenceFiles` (DL-630) and a `third_party/NOTICE` line, into `main`, after M00f `third-party-reuse-gates` has merged; M00f's checks, required on `main` by branch protection, are the mechanical stop (DL-607, DL-633). Vendoring is pending (2026-10-19: the Architect could not clone the upstreams). A file with an excluded field (the register's `excludedFieldPatterns`; DL-523, DL-648) enters only as a `.subset.json` written by `pnpm reuse:subset` from an explicit field allowlist and marked modified. Company and person names never enter `third_party/` or `content-private/`; they go only to the real side of the NameRegistry (`DV_NAMES_REAL_JSON`), each with a D-29 tier (DL-615). A file that trips `ip:*` is dropped, never exempted. Builders read only `allowedPaths` and `licenceFiles` files, never vendor or edit the register, and never open, fetch or search an upstream.
- **Ported code** carries an `SPDX-License-Identifier` line, the upstream copyright line verbatim and a "Portions from `third_party/<name>/<path>`" header. Atlas renderer ports take algorithms only (no string, URL or coordinate literal); universal-modder ports may keep secret-pattern regex literals and layout or template text, with the MIT text, but never a URL, another publisher's game name or a product string other than the secret-prefix tokens (DL-646). **Reused data** gets a C07 provenance record (`origin: open_data`, `derived_from` the vendored hash).
- **Uses (first consumer).**
  - Atlas `app/render.js`: optional starting point for the in-engine Canvas 2D maps (**M02c2**). Atlas geometry is not vendored.
  - Atlas company dataset: categorical fields only (CC BY 4.0) as tycoon `ai-tooling` seed data (**M09b1**). Its locations and building links are Nominatim and OSM derived [research/repos-world.md §2.3], so ODbL and never vendored.
  - universal-modder: secret-scan pattern classes, knowledge-base and skills layout, and the publish-check idea (**M13a6**, DL-505).
  - Mapbox: **default pending Q-44**: D-25 stands (no Mapbox runtime, nothing baked or cached, never in a Builder session; Product Terms §1.6, research/repos-world.md §4); M00f's Mapbox scan checks it (DL-616); a live layer needs a later ADR.
- **Attribution (DL-507).** `pnpm build` emits `apps/web/dist/third-party-licenses.txt` (each entry's `licenceFiles` verbatim), and each distributable package holding a ported file a generated `THIRD_PARTY_LICENSES.txt`. `provenance:check --emit-credits` writes each `third_party/NOTICE` line into `credits.json`, which the credits page renders (DL-631); CC BY lines name the creator, the licence URL and "modified" when changed.
- **Gates (DL-508, DL-614).** Code items MIT or Apache-2.0; data items CC-BY-4.0. GPL, AGPL, LGPL and `NONE`: never, not even with an ADR, and never as a `license:scan` exception or a `services/*` dependency (DL-634). Any other copyleft licence (MPL, EPL, CC BY-SA), ODbL-1.0 or other licence: its own ADR first. `ip:*` denylists and path allowlist unchanged; `third_party/` is never allowlisted, linted, tested, imported outside `tools/{map,assets,ci,soul}` or bundled. M00f implements these gates, with `reuse:clones` and the Mapbox scan (DL-616). M14b3's `ip:similarity` accepts a match only when its upstream path equals the file's "Portions from" header and is allowlisted at `pinnedSha` (DL-523). The PR template carries Builder and vendoring attestations (DL-632, DL-647).

## Consequences
- (+) Two permissive sources usable, with an audit trail.
- (−) Atlas's renderer uses its own perspective projection; porting may cost more than writing from `02-world-maps.md` §2.

## Affected contracts and milestones
No contract change. M00f (gates, before the first vendoring); M02c2, M09b1, M13a6 (optional input); M04b1 credits page; M14b3 `ip:similarity`.

## Links
`docs/legal/third-party-reuse.json`; `spec/11-decision-log-5b.md`, `-5c.md` and `-5d.md` (the DL ids above); ADR-0013; ADR-0021; `research/legal-ip-likeness.md` §2; `research/repos-world.md` §2, §4; `research/repos-modding.md` §2.
