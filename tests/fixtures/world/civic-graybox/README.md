# civic-graybox

Hand-authored gray-box world slice: four 256 m chunks around City Hall as real `DVWP` v1 packs (C08 section 4).
It is original data written by `tools/map/src/fixtures/graybox.ts`; it reads no source data.

| File | Asset ref | Holds |
|---|---|---|
| `p0-64-64.pack` | `world_pack/p0-64-64` | sim data for chunks `9/256/256`, `9/257/256`, `9/256/257`, `9/257/257` |
| `l0-64-64.pack` | `world_pack/l0-64-64` | render data (buildings, trees, lamps) for the same chunks |
| `hashes.json` | none | `{file: sha256}` of the two packs |

Regenerate and check:

```bash
pnpm map:fixture graybox            # rewrites both packs and hashes.json
pnpm map:fixture graybox --check    # exits 1 and names any pack whose hash differs from hashes.json
```

After a change, replace the two provenance records (`pnpm provenance:new`), then refresh the asset lock entries
(`pnpm assets:lock -- --approved-by <handle>`).

## Contents

- Frame: ENU metres from City Hall; host tile `7/64/64`; `bakeId` = `sha256Hex(canonicalize({sourceHashes: {}, toolVersion: 'graybox@1', configHashes: {}}))`.
- Terrain: `dm(z) = 176 - round(z / 5)`: 17.6 m at City Hall, rising 2 % to the north. Edge posts are shared exactly.
- Roads: an E-W street on `z = 100` (x from -120 to 376) and an N-S street on `x = 100` (z from -120 to 376) meet at node J (100, 100), a signalised four-way junction. Arterial, 2 lanes each way, 3.5 m lanes, 13.5 m/s, parking both sides (carriageway 18.6 m).
- Junction 0: 12 movements (no U-turns); two movements conflict when their paths through the box intersect or share an out-edge (movements from the same approach never conflict). Signal: cycle 3,600 ticks; phase A (N-S) starts at 0, phase B (E-W) at 1,800; each is green 1,500, amber 240, clear 60.
- Sidewalks: 3 m wide, 10.8 m from each centreline, split at chunk edges with duplicate boundary nodes. Four 4 m crosswalks at the junction; each `movement` is the parallel straight movement (N leg: from W, E leg: from S, S leg: from E, W leg: from N).
- 12 boxes (3 per chunk) as prisms and as `BUILDING` records; 8 trees; 8 lamps; teleport node `tp.graybox.spawn` at (89, 16.4, 60); parked slots 512-515 in `9/256/256` and `9/257/256`.

## Ids

| Kind | Ids |
|---|---|
| Nodes | J 0, W end 1, N end 2 (`9/256/256`); E end 3 (`9/257/256`); S end 4 (`9/256/257`) |
| Segments | W 0, N 1, E 2, S 3, all stored in `9/256/256` with the J-to-end direction |
| Edges | out W 0, N 1, E 2, S 3, in W 4, N 5 (`9/256/256`); in E 6 (`9/257/256`); in S 7 (`9/256/257`). Twin of `k` is `k + 4` |
| Movements | `approach * 3 + turn`; approach N 0, E 1, S 2, W 3; turn straight 0, left 1, right 2 |
| Ped nodes | 0-11 (`9/256/256`), 12-15 (`9/257/256`), 16-19 (`9/256/257`) |

## Layout (DVWP v1)

Little-endian. Header 64 B: magic `0x50575644` (`D V W P`), version 1, family (0 p0, 1 l0), tileX, tileY, hostZ 7, chunkCount, `bakeId[32]`, `dirOffset` 64, 16 B reserved (zero).
Directory (8 B per chunk, ordered by `cy` then `cx`): `cx u8, cy u8, sectionCount u16, offset u32`. At `offset`: the section table (12 B per entry: `id u8, enc u8 = 0, count u16, offset u32, bytes u32`, ascending id), then the payloads in the same order. No padding; all offsets absolute.

| Id | Section | In | Layout |
|---|---|---|---|
| 1 | HEIGHT | p0 | `i16[65*65]`, z outer |
| 2 / 3 / 4 | PRISM / SLAB / HOOD | p0 | `u8 n, i16 baseDm, u16 hDm, n * (i16 dx, i16 dz)`; SLAB adds `i8 layer` (written 0) |
| 5 | SEGMENT | p0 | `u32 id, u16 nPts, u16 widthDm, u32 osmLo, u32 osmHi, u32 cnn, nPts * (i16 dx, i16 dz, i16 yDm)` |
| 6 | NODE | p0 | `u32 id, i16 dx, i16 dz, i16 yDm, i8 layer, u8 control, i16 junction` |
| 7 | EDGE | p0 | `u32 id, seg, from, to, i32 twin, u8 cls, lanes, laneW (0.05 m), speed (0.25 m/s), u16 flags (bit 15 = dir -1), i8 layer, u8 medianDm, parking, i8 gradePct, u8 nhood` |
| 8 | JUNCTION | p0 | as C08 section 4; `cycleTicks 0` means no program |
| 9 | PED | p0 | as C08 section 4; edge `a`, `b` are indices into the chunk's own node list |
| 10 | TAGS | p0 | groups of `u8 type, u8 count, records`; record = `u16 idStr, i16 dx, i16 dz, i16 yDm`, then the type's fields |
| 11 | SPAWN | p0 | as C08 section 4 |
| 12 | GROUND | p0 | `u8[64*64]` |
| 13 | STRINGS | p0 | `u16 n, n * (u8 len, utf8)` |
| 20 | BUILDING | l0 | `i16 baseDm, u16 hDm, u8 kind, u8 roof<<6 or palette, u16 seed, u8 proxyOf, u8 n, n * (i16 dx, i16 dz)` |
| 22 / 23 / 24 / 25 | TREE / LAMP / FURNITURE / LMREF | l0 | `i16 dx, i16 dz, u8 scale/32, u8 species` / `i16 dx, i16 dz, u8 yaw` / `i16 dx, i16 dz, u8 yaw, u8 type` / `u8 index` |

`l0` carries no HEIGHT and no GROUND; `decodeL0` takes both from the matching `p0` chunk. The full list of layout choices and C08 clarification proposals is at the top of `packages/shared/src/world/pack-codec.ts`.
