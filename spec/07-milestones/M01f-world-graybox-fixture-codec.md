# M01f — world-graybox-fixture-codec

## Goal
After this half-session the C08 world contract exists as code, and a small hand-authored world slice exists as real `DVWP` v1 packs. Engine and world tests can run on it long before the SF bake (M02a1). The slice is the gray-box Civic Center block: four 256 m chunks around City Hall, a 2 % slope, 12 boxes, one signalized four-way junction and sidewalks.
- `packages/shared/src/world/` holds the C08 types and pure functions, the C08 service interfaces, a bilinear terrain sampler, and the pure decoders `decodeP0` and `decodeL0` plus `toStaticShapeSet`.
- `tools/map` holds the encoder and `pnpm map:fixture graybox [--check]`, which writes `tests/fixtures/world/civic-graybox/{p0-64-64,l0-64-64}.pack` byte-for-byte reproducibly.
- `config/world.bounds.json` is committed.
M01b2 consumes the fixture (it runs after this milestone), and M01d catalogs it.

## Requirements
- R-MAP-01: the ENU frame (origin at City Hall), the `z/x/y` grid and the pack format that the accurate SF bake will fill are fixed and tested now.
- R-PLAT-03 (support): `toStaticShapeSet` feeds the Rapier statics path of M01a2 with real heightfield and prism data.
- R-ROLL-02 (support): `p0` decoding is pure and deterministic (C02 lint), so later `canonical` hashes agree across Node, browsers and the Worker.
- R-IP-01: original hand-authored data with provenance records.

## Depends on
- **M01a1:** `@dv/shared` with `detmath`, `canonicalize`, `sha256Hex`, the C02 determinism lint and the `preserveConstEnums` setup.
- **M00b:** provenance schema, `pnpm provenance:new`, `check:assets` record validation.
- Contracts: C08 1.0.0 (`02-world-contracts.md` §1–§5), C07 1.1 (`AssetRef`, `world_pack`), C13 1.1 (`QualityTierId` import only), C01 (`StaticShapeSet` shape from `01-engine-contracts.md`).

## Scope in
- **`c08.ts`:** `02-world-contracts.md` §2, verbatim. One permitted edit: inside `ancestorKey`, write `2 ** (p.z - z)` as `1 << (p.z - z)` (same value for 0–6), because the C02 lint bans `**`. Record it as a Builder decision; no shape changes.
- **`c08-api.ts`:** §3 verbatim (interfaces only; `packages/world` implements them from M02c1).
- **`terrain.ts`:** `postIndex(col, row)`, and `sampleHeight(h: HeightGrid, x, z): number`, a bilinear sample in metres that throws `RangeError` outside the chunk. Pure.
- **`pack-codec.ts`** (§4), pure and synchronous:
  - `readHeader`, `decodeP0(buf): SimChunk[]`, and `decodeL0(buf, p0: SimChunk[]): RenderChunk[]`;
  - `toStaticShapeSet(c)` per rule 7 (`heights = dm × 0.1` as `Float32Array`, `at = [originX, 0, originZ]`, prisms = `prisms ‖ slabs ‖ hoods`);
  - `PackDecodeError {reason: 'magic' | 'version' | 'family' | 'bounds' | 'section'}`; a decode never returns a partial result.
  `RoadSegment.lengthM` is derived: the sum of 3D point distances, computed with `detmath.hypot`.
- **Layout choices §4 leaves open.** Write each as a comment at the top of `pack-codec.ts`, and list them in the PR as C08 clarification proposals:
  1. The directory follows the 64 B header (`dirOffset = 64`). Chunks are ordered by `cy`, then `cx`. Each chunk's sections are ordered by ascending id. No padding; all offsets are absolute; reserved bytes are 0.
  2. EDGE flags bit 15 set means `dir = -1`.
  3. TAGS record: `u16 idStr, i16 dx, i16 dz, i16 yDm`, then the type's remaining fields in interface order, encoded as:
     - metres → `u16` dm;
     - angles → `u8` 1/256 turn;
     - string unions → `u8` index in declaration order;
     - strings → `u16` string index (`0xFFFF` = null);
     - booleans → `u8`;
     - `edge` → `u32`; `edges` → `u8 n` + `u32[n]`;
     - `nx`, `nz` → `i8` /127.
     Tag type codes follow `ChunkTags` order (hidingSpots 0 … teleportNodes 6).
  4. `l0` holds no HEIGHT and no GROUND ("l0 reuses it"). `decodeL0` takes both from the matching `p0` chunk.
  5. JUNCTION carries no `SignalProgram.id`, `pedWalkTicks` or `Junction.x/z`. Decode sets `program.id` = junction id, `x/z` = the mean of the member nodes, `pedWalkTicks` = 0. None of them is encoded, so the round trip holds.
- **Encoder** `tools/map/src/pack/encode.ts`: `encodeP0(chunks, header)` and `encodeL0(chunks, header)`, the exact inverse of the decoder. Inputs must already be quantized; the encoder throws on out-of-range values (i16 overflow, more than 255 vertices) rather than clamping.
- **Fixture** `tools/map/src/fixtures/graybox.ts` (data in code, no network, no randomness):
  - **Chunks:** `9/256/256`, `9/257/256`, `9/256/257`, `9/257/257` (directory `cx, cy` 0–1), host tile `7/64/64`, `bakeId` = `sha256Hex(canonicalize({sourceHashes: {}, toolVersion: 'graybox@1', configHashes: {}}))`.
  - **Terrain:** `dm(z) = 176 − Math.round(z / 5)`, which is 17.6 m at City Hall, rising 2 % to the north (−Z). Posts use global coordinates, so edge posts match exactly. No ties occur because `z` is a multiple of 4.
  - **Roads:**
    - E–W street on `z = 100` from `x = −120` to `x = 376`, and N–S street on `x = 100` from `z = −120` to `z = 376`, meeting at node J (100, 100), which is `Signal`-controlled;
    - four `DeadEnd` end nodes and four segments (one per arm, points ≤ 20 m apart, `y` = terrain), giving 8 directed edges;
    - every edge: `Arterial`, 2 lanes each way, `laneWidthM` 3.5, `speedMps` 13.5, `medianM` 0, `parkingSides` 2 (`widthM` 18.6), `nhood` 255, `maxGradePct` 2 on N–S and 0 on E–W;
    - ids per rule 8; cross-chunk ownership per rule 9.
  - **Junction 0:** 12 movements (4 approaches × straight, left, right, no U-turns). Two movements conflict when their paths through the box intersect or share an out-edge.
  - **Signal program:** `cycleTicks` 3,600, offset 0. Phase A (N–S movements) starts at 0; phase B (E–W) starts at 1,800. Each phase is green 1,500, amber 240, clear 60 ticks. These are the domain row's "2 signals" (one junction, two phases).
  - **Sidewalks:** 3 m wide, centred 10.8 m from each street centreline on both sides, split at chunk edges with duplicate boundary nodes at identical positions. Four 4 m crosswalks sit at the junction; each crosswalk's `movement` is the id of the parallel straight movement.
  - **Boxes:** 12 prisms, 3 per chunk, vertex order NW → SW → SE → NE (counter-clockwise in map view). `baseDm` is the ground at the footprint's southern (lowest) edge. Centre (x, z), size (m), height (m):
    - `256/256`: (40, 40) 20×20, 12 · (−60, 40) 30×16, 24 · (40, −60) 16×30, 6.
    - `257/256`: (200, 40) 24×24, 30 · (300, −60) 20×40, 9 · (300, 50) 12×12, 1.
    - `256/257`: (40, 200) 20×20, 15 · (−60, 300) 30×30, 4.5 · (40, 300) 10×10, 3.
    - `257/257`: (200, 200) 30×20, 18 · (300, 300) 40×40, 27 · (220, 320) 8×8, 2.
  - **GROUND:** `Asphalt` under carriageways, `Sidewalk` under sidewalks, `Grass` elsewhere.
  - **TAGS:** one `teleportNodes` entry `tp.graybox.spawn` (kind `spawn`) at (89, ground, 60), yaw 0.
  - **SPAWN:** profile 0, `trafficSlots` 8, `pedSlots` 16. Chunks `256/256` and `257/256` each get parked slots 512–515 on the E–W street at s = 30, 50, 70, 90 m, alternating sides; the other two chunks get none.
  - **l0:** one BUILDING per box (kinds cycling `Commercial`, `ResMid`, `Civic`; roof 0; palette and seed = box index; `proxyOf` 0), 8 trees on the sidewalks, 8 lamps 30 m apart along both streets, no landuse, no landmarks.
- **CLI** `tools/map/src/cli.ts`: `map:fixture graybox [--check]`. Without `--check` it writes the two packs plus `hashes.json` (`{file: sha256}`). With `--check` it builds into a temp dir, compares with the committed `hashes.json`, prints any differing file, and exits 1 on a difference.
- **`config/world.bounds.json`**: exactly the C08 §5 values, with schema `tools/map/schemas/world-bounds.schema.json`.
- **Provenance:** one record per pack via `pnpm provenance:new`. These use `origin: 'authored'`, not the `derived` chain of C07 §14, because the fixture reads no source data. `kind: 'world_pack'`, `LicenseRef-DeeVerse-Owned`, `authors: ['studio:dee-verse']`, `ai_generated: false`. When the fixture changes, replace the records.

## Scope out
- Real sources, bake stages, `WorldIndex` and `world-index.schema.json`: M02a1/M02a2. l1/l2 packs, MASSING and ROADLINE decode: M02b1.
- `packages/world` services (`RoadGraphQuery`, `WorldQuery` and the rest): M02c1. Ambient spawning from SPAWN: M03b1.
- Loading the fixture in the app and meshing: M01b2. Cataloging and publishing: M01d.

## Deliverables
- `packages/shared/src/world/{c08.ts, c08-api.ts, terrain.ts, pack-codec.ts, index.ts}`; export from `packages/shared/src/index.ts`.
- `packages/shared/test/{world.grid.spec.ts, world.codec.spec.ts, world.terrain.spec.ts}`.
- `tools/map/{package.json, tsconfig.json}`. Package name: follow the existing `tools/*` pattern from M00/M00b; if there is none, use `@dv/tools-map`, with Node 22 per `.nvmrc` (02-world §3 says Node 24 for `tools/map`; this milestone follows the repo pin).
- `tools/map/src/{cli.ts, pack/encode.ts, fixtures/graybox.ts}`, `tools/map/schemas/world-bounds.schema.json`, `tools/map/test/{pack.roundtrip.spec.ts, fixture.spec.ts, bounds.spec.ts}`.
- `tests/fixtures/world/civic-graybox/{p0-64-64.pack, l0-64-64.pack, hashes.json, README.md}` (the README holds the layout table above and a regenerate note).
- `config/world.bounds.json`; two provenance records under `assets/provenance/`.
- Only if M01d is already merged (`assets/assets.lock.json` exists without `world_pack` entries): `assets/src/world_pack/{p0-64-64,l0-64-64}/asset.json` (M01d's `AssetSpec` format, variant `default`, pointing at the fixture), the two lock entries from `pnpm assets:lock -- --approved-by <handle>`, and the two committed pointer copies refreshed with `pnpm assets:publish -- --env staging --target dir:dist/media-tmp`. If M01d is not merged yet, M01d adds them (its Depends on, M01f soft) (DL-290).
- Root script **`map:fixture`** (= `pnpm --filter <tools/map package> exec tsx src/cli.ts fixture`). `check:unit` covers `tools/map/test`.
- ≈ 22 files.

## Interfaces
- C08 1.0.0: types, constants, functions and interfaces of §2–§3 created verbatim, except the `**` → `<<` rewrite. Binary layout per §4 with the five clarifications above, reported as proposals. No shape change.
- C01: `toStaticShapeSet` returns exactly the `StaticShapeSet` that `PhysicsBackend.addChunkStatics` takes (M01a2).
- C07: refs `world_pack/p0-64-64` and `world_pack/l0-64-64`, variant `default` (§14).

## Acceptance criteria
- AC-1 Given a clean clone after M01a1 When the standard gates run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given the grid functions When the world tests run Then:
  - `chunkKeyAt(9, 0, 0)` and `chunkKeyOf(37.7793, -122.4193)` are `'9/256/256'`, and `chunkBounds('9/256/256')` is `{minX: −128, minZ: −128, maxX: 128, maxZ: 128}`;
  - `packRefOf('9/257/257', 'p0')` is `'world_pack/p0-64-64'` and `packRefOf('9/257/257', 'l1')` is `'world_pack/l1-16-16'`;
  - `parseChunkKey('9/1000/1')` and `parseChunkKey('8/1/1')` are `null`;
  - `latLngFromEnu ∘ enuFromLatLng` round-trips within 1e-9°;
  - `signalAspect` gives green, amber, red and dark at the expected ticks;
  - `activeSlots` never grows as `tierFactor` falls.
  — proof: `pnpm --filter @dv/shared test -- world`
- AC-3 Given the committed fixture When `decodeP0` runs Then:
  - it returns 4 chunks with the listed keys and the computed `bakeId`;
  - posts on shared edges are equal (column 64 of `256/256` equals column 0 of `257/256`, and row 64 of `256/256` equals row 0 of `256/257`);
  - `sampleHeight` gives 17.6 ± 0.05 m at (0, 0) and 15.6 ± 0.05 m at (0, 100);
  - there are 12 prisms, 3 per chunk; 8 directed edges in total; 1 junction with 12 movements and 2 phases.
  — proof: `pnpm --filter @dv/shared test -- world`
- AC-4 Given each decoded chunk When `toStaticShapeSet` runs Then the heightfield has `nx = nz = 65`, cell 4, 4,225 heights equal to `dm × 0.1`, and `at = [originX, 0, originZ]`; `prisms` is the concatenation of prisms, slabs and hoods — proof: `pnpm check:unit -- packages/shared`
- AC-5 Given both packs When the tool re-encodes them (`encodeP0(decodeP0(b))`, `encodeL0(decodeL0(b, p0))`) Then the output is byte-identical to the input. An out-of-range coordinate makes the encoder throw — proof: `pnpm check:unit -- tools/map`
- AC-6 Given the committed hashes When `map:fixture graybox --check` runs Then it exits 0. In a temp copy with one byte of `hashes.json` changed, it exits 1 and names the file — proof: `pnpm map:fixture graybox --check && pnpm check:unit -- tools/map`
- AC-7 Given corrupted buffers (wrong magic, version 2, family 7, a truncated directory, a section offset past the end) When `decodeP0` runs Then each throws `PackDecodeError` with the matching reason and returns nothing partial — proof: `pnpm check:unit -- packages/shared`
- AC-8 Given `packages/shared/src/world/**` When lint runs Then the C02 determinism rules pass and the files import nothing outside `@dv/shared` — proof: `pnpm lint`
- AC-9 Given `config/world.bounds.json` When the bounds test runs Then it validates against the schema, equals the C08 §5 values, and its `play` box contains all four fixture chunks — proof: `pnpm check:unit -- tools/map`
- AC-10 Given the two pack records When the asset gate runs Then both are schema-valid and `active`, and each pack is ≤ 4 MiB — proof: `pnpm check:assets`
- AC-11 Given M01d merged before this branch When the asset gates run Then `assets/assets.lock.json` holds `world_pack/p0-64-64` and `world_pack/l0-64-64` (variant `default`) whose hashes equal the fixture files, and the catalog builds. If M01d is not merged, this AC is skipped and the report says so — proof: `pnpm check:assets && pnpm assets:verify`

## Test plan
- **Unit:** `world.grid`, `world.terrain`, `world.codec` (decode, shape set, corrupt inputs) in `@dv/shared`; `pack.roundtrip`, `fixture` (determinism plus `--check` failure), `bounds` in `tools/map`. All run under `pnpm check:unit`.
- **Determinism:** `pnpm map:fixture graybox --check` in the CI `unit` job. No e2e or device work (M01b2 renders the block).

## Demo script
1. `pnpm map:fixture graybox --check` prints two matching hashes; `pnpm --filter @dv/shared test -- world` passes.
2. In a Node REPL, `decodeP0` on `p0-64-64.pack` shows 4 chunks with non-empty prisms.

## Effort
0.5 session; ≈ 22 files; risk **low-medium** (junction movements and conflicts, sidewalk splits at chunk edges).

## Risks & fallbacks
- **`const enum` (`RoadClass`, `GroundClass`…) across packages under per-file transpilation.** Follow M01a1: `preserveConstEnums`, imported as values.
- **i16 range:** in-chunk coordinates stay within 0–2,560 dm.
- **A §4 clarification turns out wrong when the Architect rules on it.** Only the codec and the regenerated fixture change (C08 §7: version both together). Hashes are recomputed with `map:fixture graybox`.
- **Overrun:** move `l0` trees and lamps to a follow-up PR; BUILDING stays.

## Notes for the Builder
- Read first: `02-world-contracts.md` §1–§5 and §7; `02-world.md` §3 and §8; `01-engine-contracts.md` C01 (`StaticShapeSet`); `05-assets-pipeline.md` §14 (world provenance). The frame constants come from [research/repos-world.md §1.1].
- Order: `c08.ts` + grid tests → `terrain.ts` → encoder and decoder together, section by section, with a round-trip test per section → fixture → CLI and hashes → bounds → records.
- Keep `pack-codec.ts` free of `DataView` endianness surprises: read and write little-endian explicitly (`getInt16(o, true)`). Header magic `0x50575644` is the bytes `D V W P`.
- `tools/map` may use Node APIs. `@dv/shared` may not. The encoder reuses the shared constants and never redefines them.
- Secrets and paid accounts: none. The app is unchanged, so no deploy step is needed; `pnpm build` in AC-1 keeps it deployable.
- Branch `m01f-world-graybox-fixture-codec`.
