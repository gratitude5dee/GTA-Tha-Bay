# M13b2 — forum-ugc-links

## Goal
Forum threads and published UGC point at each other.
- A published experience or mod gets one discussion thread, created idempotently in the creator's name. Votes on an experience change its C17 `rating`, and route 37 cards show the new value under a new ETag. Route 35 mod items carry their thread summary, and forum thread DTOs carry a compact card of the linked experience or mod.
- The S02 share of this scope also lands. The bake writes the private `anchor-mask.v1` (8 m cells, 2-bit public-land classes), and the Worker can read it for the publish validator that M13c2 builds. The offline `world.describe` export feeds `thabay-mcp`. `pnpm map:webtiles` plans the SF web-tile archive for web surfaces.

## Requirements
- R-MOD-03: experience and mod discussion threads, and votes that rank experiences.
- R-MOD-04: the map pin's card shows a live rating. The anchor mask is the data behind "experiences sit on public land".
- R-MAP-03: `map:webtiles` and the `world.describe` export are the map-data pieces for web surfaces and creator agents (`02-world-maps.md` §1, §7).

## Depends on
- **M13b1**: forum tables, the vote trigger (which updates `experiences.rating_sum`/`rating_count`), routes 38–40, forum DTOs, `FORUM_BOARDS`.
- **M13a3**: route 37 GET (`ExperienceCard`, ETag, 5-minute cache), `ExperienceIndex`, `ExperienceMode`.
- **M02c2**: map bake outputs (`sf-map.v1`, `sf-geocode.v1`, `data/district-grid.v1`) and `tools/map` bake stages.
- Contracts: C17 1.0.0, C14 1.0.0 (`ModId`), C12 1.1.0 (routes 35, 37–40), C08 1.0.0 (`chunkKeyOf`, `DistrictId`, `LatLng`), C07 1.1.0 (`data` asset `data/anchor-mask.v1`).

## Scope in
- `services/edge/src/forum/links.ts`:
  - `ensureLinkedThread({kind: 'experience' | 'mod', id})` creates one thread on board `experiences` (with `experience_id`) or `mods` (with `mod_id`). The opening system post is in the creator's name and shows title and summary from the pinned version. A second call returns the same thread. The target must be `published`. M13c2 calls this function at approval.
  - A staff backfill `POST /api/v1/_test/forum/link-backfill` (non-prod only, `S:ops`) for rows already published on staging.
- Thread DTO enrichment: `ForumThreadDto.linked` = `{kind: 'experience', id, title, nhood, rating}` or `{kind: 'mod', id: ModId, name, latest}`, read from the pinned version. The field is optional and additive in the M13b1 DTO.
- Route 35 (`services/edge/src/mods`, M13a2): `ModListItem.thread = {id, score, posts}` when a `mods` thread exists. `installs30d` is unchanged.
- Route 37 GET: `rating` comes from `rating_sum`/`rating_count`. A rating change invalidates the per-chunk cache entry, and the ETag is a hash over the listed descriptors including `rating`.
- Experience votes (route 40, `targetKind: 'experience'`) need a `published ∧ public` experience. Otherwise the answer is `not_found`.
- **Anchor mask (S02 tool):**
  - `tools/map/src/stages/anchormask.ts` adds the bake stage `anchormask`. It rasterizes 8 m cells over `config/world.bounds.json` with classes 0 (water or outside the SF land polygon), 1 (right-of-way: street centrelines buffered by class width), 2 (Recreation and Parks property) and 3 (other land).
  - The header is `DVAM`, version 1, `bakeId`, grid origin and size, and a `layers` bitfield with only `classes` set. The residential-parcel layer is reserved and absent until its source attribute is confirmed (Q-MAP-07; default polygon-only rule plus human check).
  - The format is row-wise RLE, written as C07 asset `data/anchor-mask.v1` to PRIVATE (never to `media`).
- `packages/shared/src/world/anchor-mask.ts` (pure): `decodeAnchorMask(bytes)`, `classAt(mask, lat, lng)`, `discFraction(mask, lat, lng, radiusM, cls)`. Used by the Worker here and by M13c2's stage 14.
- `services/edge/src/mods/anchor-data.ts`: loads the mask from the PRIVATE binding once per isolate, keyed by `bakeId`. `publicLandVerdict(lat, lng)` returns `outside | right_of_way | park | other`.
- **`world.describe` export:** `tools/map/src/describe/{export,describe}.ts`. `pnpm map:build -- --stage describe` writes `world-describe.v1.bin` (district grid, street-name index near cells, landmark and POI pins, 32 m ground-height grid, the class layer; never a residential layer). `describe(lat, lng)` returns neighbourhood slug, up to three nearest street names, landmarks within 250 m, ground height and the public-land class. If `tools/cli/src/mcp` (M13a6) has a `world.describe` tool, it reads this export.
- **`pnpm map:webtiles`** (`tools/map/src/webtiles/`):
  - `--plan` computes the SF bbox tile ranges z0–14 from `config/world.bounds.json` and the pinned Protomaps build from `config/world/sources.json`, then prints counts and the output path `dist/web/sf.pmtiles`. No network is used.
  - Without `--plan`, it extracts the archive with the writer chosen in Risks and writes its provenance record (attribution id `protomaps`).
  - An ESLint `no-restricted-imports` rule bans `maplibre-gl` in `packages/engine`, `packages/world` and `apps/web` game code.

## Scope out
- Calling `ensureLinkedThread` at approval, and stage 14 anchor rules (`anchor.*` codes, `anchor_residential`) → M13c2.
- Forum pages, the experience card inside a thread, "Show on map" → M13b4.
- Hosting `sf.pmtiles` and any MapLibre page: no v1 page needs it (`10-ui-pages.md` §2.12 keeps maps in-engine). Hosting follows the first web surface that does.
- Residential-parcel layer: waits for Q-MAP-07.

## Deliverables
- `services/edge/src/forum/links.ts`, `services/edge/src/forum/dto.ts` (enrichment); edits to `services/edge/src/mods/{list,experiences}.ts` (thread field, rating, ETag) and `services/edge/src/forum/votes.ts` (experience rule); `services/edge/src/mods/anchor-data.ts`; `services/edge/src/routes/test.ts` (backfill, non-prod).
- `services/edge/test/{exp-rating,forum-links,anchor-rules}.test.ts`; fixture `services/edge/test/fixtures/anchor-mask.fixture.bin` (built from the committed 1 km² excerpt).
- `packages/shared/src/world/anchor-mask.ts` with `anchor-mask.test.ts`.
- `tools/map/src/stages/anchormask.ts`, `tools/map/src/describe/{export,describe}.ts`, `tools/map/src/webtiles/{plan,extract,cli}.ts`; tests `tools/map/test/{anchormask,describe,webtiles-plan}.test.ts`; expected fixtures under `tools/map/test/fixtures/`.
- `config/world/sources.json` (pinned Protomaps build entry); `eslint.config.js` (maplibre restriction); `tools/ci/test/eslint-maplibre.test.ts` with a violating fixture.
- Root script `map:webtiles` (`tsx tools/ci/run.ts tools/map/src/webtiles/cli.ts`); `map:build` gains stages `anchormask` and `describe`.
- Secrets: none.

## Interfaces
- C17 1.0: `rating` values only; moderation and visibility stay server-owned. C14 1.0: `ModId` in DTOs; database UUIDs never leave the server. C12 1.1: route behaviour as tabled. The `linked` and `thread` fields are DTO members that M13b1 and M13a2 own: `linked` is optional and new, and `thread` already exists in `ModListItem`.
- C08 1.0: `chunkKeyOf`, `LatLng` and `DistrictId` are imported, never redeclared. C07 1.1: `data/anchor-mask.v1` is a private `data` asset with a provenance record (`derived_from` the DataSF and OSM source stamps).
- No contract change.

## Acceptance criteria
- AC-1 Given a published, public experience with a linked thread and three profiles When they vote +1, +1 and −1 through route 40 Then route 37 GET for its chunk returns `rating {sum: 1, count: 3}` with an ETag different from the one before the votes, and a vote on an unpublished experience is `not_found` — proof: `pnpm check:workers -- exp-rating`
- AC-2 Given a published experience and a published mod When `ensureLinkedThread` runs twice for each Then each has exactly one thread (board `experiences` with `experience_id`, board `mods` with `mod_id`), the opening post's author is the creator, and a call for an experience in `needs_review` is refused — proof: `pnpm check:workers -- forum-links`
- AC-3 Given a mod with a discussion thread and one without When route 35 lists both Then the first item has `thread {id, score, posts}` equal to the thread row and the second has no `thread`; route 38 for board `experiences` returns `linked.kind = 'experience'` with the experience's title, `nhood` and `rating` — proof: `pnpm check:workers -- forum-links`
- AC-4 Given the committed 1 km² excerpt When the `anchormask` stage runs twice Then both outputs have one SHA-256, decoding and re-encoding is byte-identical, and the class at each of the excerpt's labelled check points (street centreline, park interior, bay water, building interior) equals the fixture label — proof: `pnpm check:unit -- tools/map packages/shared/src/world`
- AC-5 Given the fixture mask in the Worker's PRIVATE stub When `publicLandVerdict` is asked for the labelled points and for a point outside `config/world.bounds.json` Then it returns `right_of_way`, `park`, `outside` (water), `other` and `outside` respectively, and the mask is fetched once per isolate — proof: `pnpm check:workers -- anchor-rules`
- AC-6 Given the excerpt's `world.describe` export When `describe` is called for the excerpt's five reference points Then each result equals the committed expected JSON (neighbourhood slug, street names, landmark ids, ground height within 0.5 m, class), and the export holds no residential layer — proof: `pnpm check:unit -- tools/map`
- AC-7 Given no network When `map:webtiles` runs with `--plan` Then it prints per-zoom tile counts for z0–14 that equal the unit-test values for the SF bbox, names the pinned source build and `dist/web/sf.pmtiles`, and exits 0; ESLint (run through its Node API in a unit test) reports a fixture file under `packages/engine` that imports `maplibre-gl`, and the real tree passes lint — proof: `pnpm map:webtiles -- --plan && pnpm check:unit -- tools/map tools/ci && pnpm lint`
- AC-8 Given this branch's PR When `preview.yml` deploys the Preview Then smoke passes and `GET /api/v1/forum/threads?board=experiences` answers JSON — proof: manual: desktop browser, open the Preview URL plus that path; then `pnpm check:smoke -- <preview-url>`

## Test plan
- Workers: `exp-rating`, `forum-links`, `anchor-rules` (InMemoryDataPort with seeded mods, versions and experiences; PRIVATE bucket stub); `pnpm check:workers -- exp-rating`, `pnpm check:workers -- forum-links`, `pnpm check:workers -- anchor-rules`.
- Unit: `tools/map/anchormask.deterministic`, `anchormask.classes`, `describe.reference-points`, `webtiles.plan-ranges`; `shared/world.anchor-mask` (decode, `classAt`, `discFraction`); `pnpm check:unit -- tools/map packages/shared/src/world`.
- Static: `pnpm lint` (maplibre restriction), `pnpm check:prod-routes` (the backfill route is absent in prod).
- Nightly (existing): `pnpm map:verify` gains the gate "anchor mask ≤ 400 KB" on the full bake.

## Demo script
1. `pnpm check:workers -- exp-rating`; read the rating and ETag assertions.
2. `pnpm map:build -- --area sf --stage anchormask` on the cached snapshot; note the mask size in the output (≤ 400 KB).
3. `pnpm map:webtiles -- --plan`; read the tile counts and the source pin.
4. `pnpm dev`. Vote on a seeded experience through the QA API helper, then open the phone Map app; the experience card shows the new rating.

## Effort
0.8 session; ≈ 28 files; risk **low-medium**. The mask rasterizer and its fixture labels take the most care.

## Risks & fallbacks
- **PMTiles writer.** The writer library for `map:webtiles` is not in the ledger (`02-world-maps.md` §7). Write the archive with the library pnpm resolves, record its version in `spec/03`, and keep it out of ACs. If no writer works, the non-`--plan` path prints `SKIP map:webtiles: no verified writer` and exits 0, and the Builder reports it. No v1 page needs the archive.
- **Whether Workers static assets serve `Range` on `.pmtiles`** is unknown. It matters only when a page hosts the archive, so it is not touched here.
- **Mask over budget (> 400 KB):** use 16 m cells for class 3 runs only (RLE gets longer runs), keep 8 m for classes 1 and 2, bump the header version and log a Builder decision.
- **Street buffer widths.** Take them per class from the bake's road classes (M02a2). If a class has no width, use 8 m and list it in the bake report.

## Notes for the Builder
- Read first: `12-modding-publish.md` C§4 (anchor rules and markers), C§5 (boards), C§6 (store detail); `02-world-maps.md` §1 (mask row), §6 (attribution), §7; `02-world-bake.md` (stage layout and outputs); `12-modding-contracts.md` B§6–B§7.
- The mask is private. It never goes to `media.` and never into the `world.describe` export.
- Order of work: anchor-mask codec → bake stage → Worker loader → links and DTO enrichment → route 35/37 edits → describe export → webtiles plan → tests.
- Branch `m13b2-forum-ugc-links`.
