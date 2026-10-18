# ADR-0005 — Building representation per tier

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-05 and D-15; contract C08

## Context
R-MAP-01 asks for an accurate, recognizable San Francisco on every device from an iPhone 15 to a desktop GPU. Draw cost in three.js grows with render objects, not triangles alone (issue #30560 is open) [F-007]; Quest 3 is held to under 200 draw calls and 1.5 M triangles [F-013]. The bake reference is 176,777 building footprints (`spec/domains/02-world.md` §8, M02a1); the source is DataSF `ynuv-fyni` under PDDL [F-054], and OSM adds tags under ODbL [F-053].

## Options considered
1. **Google Photorealistic 3D Tiles or Mapbox tiles.** No caching, offline use or derivation; Mapbox forbids deriving data [F-055, F-056].
2. **Loose per-building meshes.** Render-object count explodes beyond the mobile cap of 150.
3. **Per-tier sim data.** Breaks the `canonical` determinism profile because colliders differ per device.
4. **Baked footprint extrusions merged per chunk, with authored landmarks swapped in** (chosen).

## Decision
- **One representation on every tier.** The bake writes tier-independent `p0` sim packs (heightfield, building prisms) and `l0`/`l1`/`l2` render packs holding Int16 footprints (each pack ≤ 4 MiB). `asset.worker` meshes footprints, merges them per chunk into at most 6 render objects in one static `BundleGroup`, and the main thread uploads at most one chunk per frame through `ChunkUploadGate`. Tiers differ only in distance, LOD and facade detail.
- **LOD ladder.** L0 256 m chunks with full footprints; L1 1,024 m tiles with simplified footprints (drop h < 6 m outside d1/d5); L2 4,096 m blocks with massing boxes ≥ 20 m; beyond SF, `far-bay-*` skyline cards. Cover masks hide the coarse object where finer children are resident.
- **Draw distance (D-15).** Desktop 8,200 m; Vision Pro 3,000 m; mobile 2,500 m; `mobile-low` and Quest 1,500 m.
- **Landmarks (A-05).** At least 25 landmark buildings (37 are listed with coordinates) are separate glTF assets at fixed AssetIds `building/lm.<slug>`. `LandmarkLayer` swaps each in for its extrusion (a remesh inside `swapM`); it sits outside the 6-object chunk rule, and the extrusion proxy stays if the pack is missing. **Authoring route:** the v0 wording "hand-authored" is read as authored glTF at stable ids: code recipes produce the files in M02d1–M02d2 and a Blender art pass may replace the files after M05c without changing any id (DL-105, DL-201).
- **Budgets (C13).** Planned visible render objects ≈ 420 desktop (≤ 600) and ≈ 80 mobile (≤ 150); mobile triangles ≈ 0.3 M against ≤ 1.0 M.
- **Names.** Landmark names go through the `NameRegistry`; no murals or public art; fictional brands.

## Consequences
- (+) Accuracy comes from open data with clean licences; one code path for all tiers; physics equals visuals via one shared 4 m heightfield.
- (−) Facades are stylized (flat colour first, atlas later), not photographic.
- (−) Tunnels need carved hoods or teleport pairs if the M02a2 drive tests fail (DL-108).
- (−) 37 landmarks depend on art time; recipes first limit the slip risk (R-S02-10).

## Affected contracts and milestones
C08 (chunk fields, `SimChunk`, pack ids), C13 (budgets, `lodBias`, `buildingDistanceScale`), C07 (`world_pack`, provenance `ODbL-1.0`/`PDDL-1.0`). M02a1 (bake), M02b1 (streaming, LOD), M02d1–M02d2 (landmarks), M11a (budgets as tests), M15a (expansion reuses the grid).

## Links
`spec/domains/02-world.md` §2.1 (W-4, W-5, W-7), §5.3–5.4; `02-world-bake.md`; `spec/11-decision-log.md` DL-049, DL-105; ADR-0010, ADR-0021.
