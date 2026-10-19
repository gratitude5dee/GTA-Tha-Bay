# Map data — sf-3d viewer's upstream sources (S00-adjacent note, 2026-10-19)

Prompted by the owner: "can we use this to help with the sf map: github.com/Atharvsinh-codez/San-Francisco". This file records what that repo pulls from so the `sf` bake (M02a1–M02c2) and `map:fetch` can use the same **upstream** data under our own provenance.

## The repo

`Atharvsinh-codez/San-Francisco` (`sf-3d`): a Three.js viewer of an accurate San Francisco — Vite + three + takram geospatial/atmosphere libs, with a bake pipeline (`tools/bake*.ts` + `tools/fetch.ts`) that turns open data into per-cell `.bin` geometry, ortho imagery tiles, landuse polygons, labels and a hand-authored `landmarks.json`.

**Licence: none.** The repo ships no LICENSE file, so it is all-rights-reserved. Use it as a *reading* reference only — no vendored code or baked data. Every dataset below is fetched by it from upstream; we fetch upstream ourselves. The one authored file (`landmarks.json` content) is likewise not copied; its *schema* is the useful part.

## Upstream sources it uses (fetched in `tools/fetch.ts`)

| Layer | Source | Endpoint | Licence posture | Already ours? |
|---|---|---|---|---|
| Buildings | DataSF Building Footprints | `data.sfgov.org/resource/ynuv-fyni.json` (Socrata, paged 45k rows) | open data | yes — `datasf-footprints` in `config/world/sources.json` |
| Trees | DataSF Street Tree List | `data.sfgov.org/resource/tkzw-k3nq.json` (`$select=latitude,longitude,species`, 50k) | open data | yes — `datasf-trees` |
| Terrain | AWS Terrarium PNGs | `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — z14 core, z11 far | public domain (3DEP/SRTM) | yes — `terrarium` (we run z15 core) |
| Roads/landuse/labels | OSM via **Overpass JSON** | `overpass-api.de/api/interpreter`, mirrors `lz4.overpass-api.de`, `overpass.kumi.systems`; bbox `37.705,-122.525,37.865,-122.345` | ODbL-1.0 | partial — our source is Geofabrik `norcal-latest.osm.pbf`; Overpass is the alternate path below |
| Orthoimagery | **USGS National Map `USGSImageryOnly`** | `basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` — z14, JPG, no key | public domain (NAIP/HRO) | **no — new** |
| Landmarks | hand-authored | `public/data/landmarks.json` | repo-authored, unlicensed | n/a — schema only |

## Delta worth taking

1. **USGS orthoimagery is a new open-data source.** `USGSImageryOnly` serves public-domain NAIP/high-resolution ortho tiles with no API key. `config/world/sources.json` currently has no imagery source — this is the candidate if the `sf` bake wants satellite-style backdrop tiles (the far LOD ring / map web tiles, M13b2). Adding it is a `sources.json` entry + a fetch stage, all inside the existing host allowlist model (`assertAllowedHost` denies only Mapbox/Google tiles).
2. **Overpass JSON is a lighter OSM acquisition path than the Geofabrik `.osm.pbf` pull** — bbox-scoped JSON, no osmium needed. Note from spec/03 §7: `overpass-api.de` itself resets through this session's egress proxy, but the `lz4` and `kumi.systems` mirrors were never tried here — worth probing on the AC-9 operator run before declaring OSM unreachable from build environments.
3. **Bake techniques to borrow as design ideas (not code):** 8×8 cell grid over a 20 km × 20 km world (2.5 km cells), int16 coordinates quantized at 8 cm relative to cell centre, roads subdivided every 20 m so they hug terrain without clipping hills, a 9-class road taxonomy that includes cable-car and BART/transit overlay classes, and a landmark schema with flyover parameters (`flyDistM`, `flyPitchDeg`, `flyHeadingDeg`) — a good template for `content/world` hero landmarks and any cinematic intro we shoot.
4. **What it does not give us:** our pack format (`world_pack` p0/l0 codec) is unrelated to its `.bin` cells — nothing drops in as binary. The value is sources + recipe, matching how the spec already routes SF data through `tools/map`.

## Provenance note

If anything is ever copied from this repo it needs a `third_party/` vendoring PR with licence clearance under D-31 — it currently has no licence, so assume it cannot be. The upstream datasets carry their own licences (ODbL for OSM derivatives: attribution + share-alike database; DataSF and USGS/NAIP open/public-domain), already tracked in `config/attribution.world.json` for the ones we use.
