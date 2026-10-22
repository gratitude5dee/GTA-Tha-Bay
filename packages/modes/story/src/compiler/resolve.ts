/**
 * Load-time resolution (C09 section C5, step 2; run in `sim.worker` while the mission is `starting`, behind a fade). The IR holds
 * WGS84 tuples and landmark ids; this turns them into ENU metres with the C08 `WorldResolver`: placements are snapped (a snap more
 * than 25 m from a valid target fails), landmark zones take the landmark's position, route zones become road edge sets. Any failure
 * disables the mission (`E_REF_*`, telemetry `mission.fail {reason: 'unresolved'}`). Sim code under the C02 lint.
 */
import type { LatLng, LatLngTuple, MissionIR, Placement, WorldResolver, ZoneShape } from '@dv/shared';
import type { CompileError } from './types.ts';

export interface ResolvedPlacement {
  pos: [number, number, number];
  yaw: number;
}
export type ResolvedZone = ZoneShape | { k: 'cast'; cast: string; r: number };

export interface ResolvedMission {
  ir: MissionIR;
  /** The bake the positions were resolved against (the world's, not the IR's). */
  bake: string;
  zones: Record<string, ResolvedZone>;
  /** Spawn pose of each cast entry that has a placement. */
  spawns: Record<string, ResolvedPlacement>;
  /** Where the start marker stands, for a `marker` trigger. */
  trigger: ResolvedPlacement | null;
}

const toLatLng = (t: LatLngTuple): LatLng => ({ lat: t[0], lng: t[1] });
const DEFAULT_LANDMARK_R = 15;
const POLY_Y_MIN = -100;
const POLY_Y_MAX = 1000;

export function resolveMission(ir: MissionIR, w: WorldResolver): ResolvedMission | { errors: CompileError[] } {
  const errors: CompileError[] = [];
  const fail = (code: CompileError['code'], pointer: string, message: string): void => void errors.push({ code, pointer, message });

  const place = (p: Placement, ptr: string): ResolvedPlacement | null => {
    const at = Array.isArray(p.at) ? toLatLng(p.at) : { landmark: p.at.landmark };
    if (!Array.isArray(p.at) && !w.landmark(p.at.landmark)) {
      fail('E_REF_LANDMARK', `${ptr}/at/landmark`, `${p.at.landmark} is not in the loaded world`);
      return null;
    }
    const hit = w.snap({ at, snap: p.snap, ...(p.y !== undefined ? { y: p.y } : {}), ...(p.yawDeg !== undefined ? { yawDeg: p.yawDeg } : {}) });
    if (!hit) {
      fail('E_REF_ZONE', ptr, `no ${p.snap} within 25 m of the placement`);
      return null;
    }
    return { pos: [hit.pos[0], hit.pos[1], hit.pos[2]], yaw: hit.yaw };
  };

  const zones: Record<string, ResolvedZone> = {};
  for (const name of Object.keys(ir.zones).sort()) {
    const z = ir.zones[name];
    const ptr = `/zones/${name}`;
    if (!z) continue;
    switch (z.k) {
      case 'circle': {
        const hit = w.snap({ at: toLatLng(z.at), snap: 'ground' });
        if (!hit) fail('E_REF_ZONE', ptr, 'the zone centre is not on loaded ground');
        else zones[name] = { k: 'circle', at: [hit.pos[0], hit.pos[1], hit.pos[2]], r: z.r };
        break;
      }
      case 'poly': {
        const ring = z.ring.map((t) => {
          const e = w.toEnu(toLatLng(t));
          return [e[0], e[2]] as [number, number];
        });
        zones[name] = { k: 'poly', ring, yMin: z.yMin ?? POLY_Y_MIN, yMax: z.yMax ?? POLY_Y_MAX };
        break;
      }
      case 'landmark': {
        const lm = w.landmark(z.id);
        if (!lm) fail('E_REF_LANDMARK', ptr, `${z.id} is not in the loaded world`);
        else zones[name] = { k: 'circle', at: [lm.enu[0], lm.enu[1], lm.enu[2]], r: z.r ?? DEFAULT_LANDMARK_R };
        break;
      }
      case 'route': {
        const edges = w.route(z.via.map(toLatLng));
        if (!edges || edges.length === 0) fail('E_ROUTE_UNSNAPPABLE', ptr, 'the route cannot be snapped to the road graph');
        else zones[name] = { k: 'edges', edgeIds: edges, widthM: z.widthM };
        break;
      }
      case 'cast':
        zones[name] = { k: 'cast', cast: z.cast, r: z.r };
        break;
    }
  }

  const spawns: Record<string, ResolvedPlacement> = {};
  for (const name of Object.keys(ir.cast).sort()) {
    const c = ir.cast[name];
    if (c && 'spawn' in c && c.spawn) {
      const r = place(c.spawn, `/cast/${name}/spawn`);
      if (r) spawns[name] = r;
    }
  }
  const trigger = ir.start.k === 'marker' ? place(ir.start.at, '/start/at') : null;

  if (errors.length > 0) return { errors };
  return { ir, bake: w.bake, zones, spawns, trigger };
}
