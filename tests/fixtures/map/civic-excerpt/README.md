# civic-excerpt: a 1 km² source excerpt around City Hall

Raw inputs of the `civic-excerpt` bake area (M02a1). The bake reads these files as they are, so CI proves byte-reproducible
bakes without the network: `pnpm map:build -- --area civic-excerpt --repro`.

Box (ENU metres from City Hall, +X east, -Z north): x -640 to 384, z -640 to 384, which is the 4 x 4 block of 256 m chunks
`9/254/254` to `9/257/257` (1.05 km²). City Hall (0, 0) sits in chunk `9/256/256`.

| File | Source | Licence | Rows |
|---|---|---|---|
| `ynuv-fyni.jsonl` | DataSF Building Footprints `ynuv-fyni`, rows whose first polygon centroid lies in the box | PDDL-1.0, "City and County of San Francisco" | 639 |
| `j2bu-swwd.jsonl` | DataSF Analysis Neighborhoods `j2bu-swwd`, polygons clipped to the box | PDDL-1.0 | 4 |
| `gtr9-ntp6.jsonl` | DataSF Recreation and Parks `gtr9-ntp6`, polygons clipped to the box | PDDL-1.0 | 10 |
| `tkzw-k3nq.jsonl` | DataSF Street Tree List `tkzw-k3nq`, trees inside the box | PDDL-1.0, SF Public Works | 2267 |
| `terrarium/15/5240..5241/12664..12665.png` | AWS Terrain Tiles (Terrarium) z15, the 4 tiles that cover the box | LicenseRef-PublicDomain-USGov, "3DEP data courtesy of the U.S. Geological Survey" | 4 |
| `osm.geojsonl` | **synthetic** (`synthetic: true`): the synth generator restricted to the square | LicenseRef-DeeVerse-Owned | 4 |

Why the OSM part is synthetic: the session that cut this excerpt had no `osmium` and could not reach the Geofabrik extract
(connection reset by the egress proxy), and the bake never calls Overpass or Nominatim. The four OSM features (a residential
landuse polygon, the City Hall plaza and two tagged civic building polygons) exist so that the S4 civic rule and the
landuse lookup run on the excerpt. Its stamp in `raw.lock.json` has licence `LicenseRef-DeeVerse-Owned` and is listed in
`syntheticSources`, so the bake's `WorldIndex.sources` attribution says "Synthetic test data (osm), Dee-Verse". A real OSM cut can replace it later: run the sf
extract with `osmium` for this box, export GeoJSON lines to `osm.geojsonl` here, then in `raw.lock.json` set the `osm` entry to the Geofabrik URL,
the new SHA-256 and row count and licence `ODbL-1.0`, and remove `osm` from `syntheticSources`. The `--fixture` command always
rewrites this file with the synthetic part, so do that edit after the last `--fixture` run.

Re-cutting the DataSF and Terrarium parts: `pnpm map:fetch -- --area civic-excerpt --fixture` (network). It overwrites
these files and `raw.lock.json`; the committed bake then changes its `bakeId`, which is expected.

DataSF data refreshes daily; `raw.lock.json` pins this snapshot (URL, retrieval time, SHA-256, row count per source).
