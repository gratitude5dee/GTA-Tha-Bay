/**
 * The chunk tags the pursuit director reads (M03c; C08 rule 3): hiding spots and choke points of the resident `p0` chunks. The
 * engine owns the port shape (`WorldTagsPort`); this is its implementation over the sim's chunk store.
 *
 * Pure; C02 lint applies.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, type ChokePoint, type ChunkKey, type HidingSpot } from '@dv/shared';
import type { WorldTagsPort } from '@dv/engine/sim';
import type { ChunkSource } from './query.ts';

export function createTagsPort(store: ChunkSource): WorldTagsPort {
  const e = CHUNK_EDGE_M[9];
  const each = (x0: number, z0: number, x1: number, z1: number, fn: (key: ChunkKey) => void): void => {
    const i0 = Math.floor((x0 - GRID_MIN_M) / e), i1 = Math.floor((x1 - GRID_MIN_M) / e);
    const j0 = Math.floor((z0 - GRID_MIN_M) / e), j1 = Math.floor((z1 - GRID_MIN_M) / e);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(`9/${i}/${j}` as ChunkKey);
  };
  return {
    hidingSpotAt(x, z): HidingSpot | null {
      let best: HidingSpot | null = null;
      each(x - 60, z - 60, x + 60, z + 60, (key) => {
        const c = store.payload(key);
        if (!c) return;
        for (const h of c.tags.hidingSpots) {
          const dx = h.x - x, dz = h.z - z;
          if (dx * dx + dz * dz <= h.radiusM * h.radiusM && (best === null || h.id < best.id)) best = h;
        }
      });
      return best;
    },
    chokePointsNear(x, z, r): ChokePoint[] {
      const out: ChokePoint[] = [];
      each(x - r, z - r, x + r, z + r, (key) => {
        const c = store.payload(key);
        if (!c) return;
        for (const p of c.tags.chokePoints) {
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz <= r * r) out.push(p);
        }
      });
      return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
  };
}
