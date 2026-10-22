/**
 * Goal derivation of the story autoplayer (M05a2; 03-story-missions.md C9 table). A goal says where the player should be or what it
 * should do for one active objective; `policies.ts` turns a goal into movement. Pure functions of the observation. Sim code under
 * the C02 lint.
 */
import type { ObjectiveDef } from '@dv/shared';
import { dsqrt, enuFromLatLng } from '@dv/shared';
import type { Vec3 } from '../vm/actors.ts';
import type { MissionObs, ObjView } from './observe.ts';

/** Beyond this distance the bot drives, when a usable vehicle is within `VEHICLE_REACH_M` (C9: 150 m, 60 m). */
export const DRIVE_MIN_M = 150;
export const VEHICLE_REACH_M = 60;

export type Pace = 'walk' | 'run' | 'sprint';

export type Goal =
  | { k: 'idle' }
  /** Be inside `r` metres of `at`. `mode` limits how: on foot only, in the named vehicle only, or either by distance. */
  | { k: 'reach'; at: Vec3; r: number; mode: 'free' | 'foot' | 'vehicle'; vehicle?: string; stop?: boolean; pace?: Pace }
  | { k: 'enter'; vehicle: string }
  | { k: 'follow'; target: string; mid: number; zone: Vec3 | null; zoneR: number }
  | { k: 'chase'; target: string }
  | { k: 'path'; points: Vec3[]; r: number }
  | { k: 'photo'; subject: Vec3; maxDistM: number }
  | { k: 'pattern'; name: 'drift' }
  | { k: 'melee'; target: string };

const near = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dsqrt(dx * dx + dz * dz);
};

/** The usable vehicle nearest to the player (cast name), or null. */
export function nearestUsableVehicle(obs: MissionObs, maxM: number): string | null {
  let best: string | null = null;
  let bestD = maxM;
  for (const name of Object.keys(obs.cast)) {
    const c = obs.cast[name];
    if (!c || !c.usable || !c.pos || c.occupied) continue;
    const d = near(obs.me.pos, c.pos);
    if (d <= bestD) {
      best = name;
      bestD = d;
    }
  }
  return best;
}

/** The objective the bot works on: the first required one by id, else the first optional one. */
export function pickObjective(obs: MissionObs): ObjView | null {
  return obs.objectives.find((o) => !o.optional) ?? obs.objectives[0] ?? null;
}

/** Radius the bot aims inside a zone with: the middle, so a slide on arrival still counts. */
const aimR = (r: number): number => Math.max(1.2, r * 0.45);

export function deriveGoal(obs: MissionObs, o: ObjView): Goal {
  const d: ObjectiveDef = o.def;
  switch (d.k) {
    case 'goto': {
      const z = obs.zones[d.zone];
      if (!z || !z.c) return { k: 'idle' };
      const stop = d.stopped === true;
      if (d.inVehicle !== undefined && d.inVehicle !== 'any') return { k: 'reach', at: z.c, r: aimR(z.r), mode: 'vehicle', vehicle: d.inVehicle, stop };
      if (d.inVehicle === 'any') return { k: 'reach', at: z.c, r: aimR(z.r), mode: 'vehicle', stop };
      return { k: 'reach', at: z.c, r: aimR(z.r), mode: d.onFoot === true ? 'foot' : 'free', stop };
    }
    case 'enterVehicle': {
      const v = d.vehicle === 'any' ? nearestUsableVehicle(obs, 1e9) : d.vehicle;
      return v === null ? { k: 'idle' } : { k: 'enter', vehicle: v };
    }
    case 'follow': {
      const z = d.untilZone !== undefined ? obs.zones[d.untilZone] : undefined;
      return { k: 'follow', target: d.target, mid: (d.band[0] + d.band[1]) / 2, zone: z?.c ?? null, zoneR: z ? aimR(z.r) : 0 };
    }
    case 'chase':
      return { k: 'chase', target: d.target };
    case 'collect': {
      const c = obs.cast[d.cast];
      if (!c || !c.pos) return { k: 'idle' };
      return { k: 'reach', at: c.pos, r: 1.0, mode: 'foot', pace: 'run' };
    }
    case 'deliver': {
      const z = obs.zones[d.to];
      const c = obs.cast[d.cast];
      if (!c) return { k: 'idle' };
      // not yet in the hands: pick it up first
      if (!c.carried && c.pos && c.kind !== 'vehicle') {
        if (z?.c && near(c.pos, z.c) <= z.r) return { k: 'idle' };
        return { k: 'reach', at: c.pos, r: 1.0, mode: 'foot', pace: 'run' };
      }
      if (!z || !z.c) return { k: 'idle' };
      return { k: 'reach', at: z.c, r: aimR(z.r), mode: 'free' };
    }
    case 'photo': {
      const c = obs.cast[d.subject];
      const at = c?.pos ?? obs.landmarks[d.subject] ?? null;
      return at ? { k: 'photo', subject: at, maxDistM: d.maxDistM ?? 30 } : { k: 'idle' };
    }
    case 'stealth': {
      const points = d.autoplayPath.map((p): Vec3 => {
        const e = enuFromLatLng(p[0], p[1]);
        return [e.x, obs.groundY(e.x, e.z) ?? obs.me.pos[1], e.z];
      });
      return points.length > 0 ? { k: 'path', points, r: 2 } : { k: 'idle' };
    }
    case 'defeat':
      return d.targets[0] !== undefined ? { k: 'melee', target: d.targets[0] } : { k: 'idle' };
    case 'score':
      return { k: 'pattern', name: 'drift' };
    case 'escape': {
      // run for the farthest place the mission names (its hideout or its last stop): a moving car leaves the search circle behind (M05c1)
      let far: Vec3 | null = null;
      let farD = 0;
      for (const name of Object.keys(obs.zones).sort()) {
        const z = obs.zones[name];
        if (!z?.c) continue;
        const dd = near(obs.me.pos, z.c);
        if (dd > farD) {
          far = z.c;
          farD = dd;
        }
      }
      return far ? { k: 'reach', at: far, r: 12, mode: 'free' } : { k: 'idle' };
    }
    case 'survive':
    case 'protect':
    case 'talk':
    case 'wait':
      return { k: 'idle' };
    case 'mode': {
      // a hook runs its stub when the mode is not there yet; the bot works the stub (a hook the real mode plays needs no one)
      const stub = obs.hookStubs[d.hook];
      return stub ? deriveGoal(obs, { ...o, def: stub }) : { k: 'idle' };
    }
  }
}
