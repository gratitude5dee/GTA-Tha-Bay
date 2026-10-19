/**
 * The finished `synth` bake in dist/world (`pnpm map:build -- --area synth`), for the specs that prove a service against the real
 * data shapes. Returns null, after printing a SKIP line, when there is none (DV_REQUIRE_BAKE=1 throws instead).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { decodeDistrictGrid, decodeGraph, decodeP0, type DistrictGrid, type GraphTopology, type SimChunk, type WorldIndex } from '@dv/shared';
import { requireBake } from '../../../../tests/support/require-bake.ts';

export interface BakeData {
  bakeId: string;
  dir: string;
  index: WorldIndex;
  topology: GraphTopology;
  districtGrid: DistrictGrid | null;
  /** Decodes the p0 chunks of the tiles holding the given chunk keys (all of them when omitted); slow for the whole city. */
  chunks(filter?: (key: string) => boolean): SimChunk[];
}

let memo: BakeData | null | undefined;

export function loadBake(area: 'synth' | 'civic-excerpt', suite: string): BakeData | null {
  if (area === 'synth' && memo !== undefined) return memo;
  const found = requireBake(area, suite);
  if (!found) {
    if (area === 'synth') memo = null;
    return null;
  }
  const dir = found.dir;
  const gridFile = path.join(dir, 'district-grid.v1.pack');
  const data: BakeData = {
    bakeId: found.bakeId,
    dir,
    index: JSON.parse(readFileSync(path.join(dir, 'world-index.json'), 'utf8')) as WorldIndex,
    topology: decodeGraph(readFileSync(path.join(dir, 'packs', 'sf-graph.v1.pack'))),
    districtGrid: existsSync(gridFile) ? decodeDistrictGrid(readFileSync(gridFile)) : null,
    chunks(filter) {
      const out: SimChunk[] = [];
      for (const name of readdirSync(path.join(dir, 'packs')).sort()) {
        if (!name.startsWith('p0-')) continue;
        for (const c of decodeP0(readFileSync(path.join(dir, 'packs', name)))) if (!filter || filter(c.key)) out.push(c);
      }
      return out;
    },
  };
  if (area === 'synth') memo = data;
  return data;
}
