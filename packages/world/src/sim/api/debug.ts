/**
 * QA calls into the world services (M02c1): `{t: 'debug.world', id, op, args}` arrives as an engine debug command (QA builds
 * only, the runtime drops it otherwise), runs here between ticks, and the answer goes back as the qa message
 * `world.reply.<id>` that `__dvBridge.world` reads. Every answer is plain JSON. The ops are the bridge's teleport, route,
 * resolve and friends; none of them is reachable in a production build. Pure; C02 lint applies.
 */
import type { LandmarkId, PoiId, RouteRequest, SnapRequest, TeleportKind, TeleportTarget, WaterWallState } from '@dv/shared';
import { waterWall } from '@dv/shared';
import type { WorldServices } from './world-api.ts';

export interface WorldDebugCommand {
  t: 'debug.world';
  id: number;
  op: string;
  args?: Record<string, unknown>;
}

/** Longest edge list a reply carries (the event ring holds 64 KB). */
export const REPLY_MAX_EDGES = 4000;

type Args = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rec = (v: unknown): Args | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Args) : null);

/** A place in a request: an edge position, a landmark, a POI or a point. */
function spotOf(w: WorldServices, v: unknown): RouteRequest['from'] | null {
  const s = rec(v);
  if (!s) return null;
  const edge = num(s['edge']);
  if (edge !== null) return { edge, s: num(s['s']) ?? 0, lane: 0 };
  const lm = str(s['landmark']);
  if (lm !== null) {
    const l = w.places.landmark(lm as LandmarkId);
    return l ? { x: l.arrival.x, z: l.arrival.z } : null;
  }
  const poi = str(s['poi']);
  if (poi !== null) {
    const p = w.places.poi(poi as PoiId);
    return p ? { x: p.x, z: p.z } : null;
  }
  const x = num(s['x']), z = num(s['z']);
  return x !== null && z !== null ? { x, z } : null;
}

function targetOf(a: Args): TeleportTarget | null {
  const lm = str(a['landmark']);
  if (lm !== null) return { landmark: lm };
  const node = str(a['node']);
  if (node !== null) return { node };
  const x = num(a['x']), z = num(a['z']);
  if (x === null || z === null) return null;
  const yaw = num(a['yaw']);
  return yaw === null ? { x, z } : { x, z, yaw };
}

const KINDS: readonly TeleportKind[] = ['sandbox', 'fast-travel', 'xr-comfort', 'respawn', 'debug'];

/** What a few ops need of the physics world (a ray against the statics, to find the play-bounds wall). */
export interface WorldDebugPhysics {
  castRay(origin: [number, number, number], dir: [number, number, number], max: number, mask: number): { toi: number; normal: [number, number, number] } | null;
  /** Collision group bit of the statics. */
  staticMask: number;
}

/** Runs one op. `reply(id, data)` is called exactly once, now or when an asynchronous op settles. */
export function runWorldDebug(w: WorldServices, tick: number, cmd: WorldDebugCommand, reply: (id: number, data: unknown) => void, physics?: WorldDebugPhysics): void {
  const a = cmd.args ?? {};
  const done = (data: unknown): void => reply(cmd.id, data);
  switch (cmd.op) {
    case 'teleport': {
      const to = targetOf(a);
      const kind = (KINDS as readonly string[]).includes(String(a['kind'])) ? (a['kind'] as TeleportKind) : 'debug';
      if (!to) return done({ ok: false, reason: 'blocked', messageKey: 'world.teleport.unknownTarget' });
      void w.teleport.request(kind, to).then(done);
      return;
    }
    case 'route': {
      const from = spotOf(w, a['from']), to = spotOf(w, a['to']);
      if (!from || !to) return done(null);
      const req: RouteRequest = {
        from, to, maxExpand: num(a['maxExpand']) ?? 200_000, useTopology: a['useTopology'] !== false,
        ...(a['allowWrongWay'] === true ? { allowWrongWay: true } : {}), ...(num(a['classMask']) !== null ? { classMask: num(a['classMask']) as number } : {}),
      };
      const r = w.graph.routeDetailed(req);
      if (!r) return done(null);
      return done({ edges: r.edges.slice(0, REPLY_MAX_EDGES), count: r.edges.length, lengthM: r.lengthM, etaS: r.etaS, complete: r.complete, expanded: r.expanded });
    }
    case 'resolve': {
      const lat = num(a['lat']), lng = num(a['lng']);
      return done(lat === null || lng === null ? null : w.graph.resolve(lat, lng));
    }
    case 'snap':
      return done(w.resolver.snap(a as unknown as SnapRequest));
    case 'find': {
      void w.places.findPlace(str(a['text']) ?? '', num(a['limit']) ?? 5).then(done);
      return;
    }
    case 'pois': {
      const x = num(a['x']), z = num(a['z']);
      if (x === null || z === null) return done([]);
      const kind = str(a['kind']);
      const list = w.places.poisNear(x, z, num(a['r']) ?? 200, kind === null ? undefined : (kind as never));
      return done(list.slice(0, 200).map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z })));
    }
    case 'pedRoute':
      return done(w.places.pedRoute((str(a['a']) ?? '') as PoiId, (str(a['b']) ?? '') as PoiId));
    case 'query': {
      const x = num(a['x']), z = num(a['z']);
      if (x === null || z === null) return done(null);
      const y = num(a['y']);
      return done({
        groundY: y === null ? w.query.groundY(x, z) : w.query.groundY(x, z, y), isWater: w.query.isWater(x, z), depth: w.query.waterDepth(x, z),
        nhood: w.query.nhoodAt(x, z), district: w.query.districtAt(x, z),
      });
    }
    case 'portals':
      return done({ portals: w.bounds.portals(), sealed: w.bounds.sealedPortals() });
    case 'portal':
      return done(w.bounds.setPortalState(str(a['id']) ?? '', (str(a['state']) ?? 'closed') as never, str(a['by']) ?? 'debug'));
    case 'release':
      w.bounds.release(str(a['by']) ?? 'debug');
      return done(true);
    case 'closeEdges':
      w.traffic.closeEdges(Array.isArray(a['edges']) ? (a['edges'] as number[]) : [], str(a['by']) ?? 'debug');
      return done(w.traffic.closedEdges().slice(0, REPLY_MAX_EDGES));
    case 'density':
      w.traffic.setDensity((str(a['kind']) ?? 'traffic') as never, num(a['mult']) ?? 1, str(a['by']) ?? 'debug');
      return done({ traffic: w.traffic.densityOf('traffic'), ped: w.traffic.densityOf('ped'), parked: w.traffic.densityOf('parked') });
    case 'shore': {
      const x = num(a['x']), z = num(a['z']);
      if (x === null || z === null) return done(null);
      return done({ node: w.bounds.nearestShore(x, z, a['roadAdjacent'] === true), pose: w.shoreRespawn(x, z, a['roadAdjacent'] === true) });
    }
    case 'waterWall': {
      // steps the pure rule `ticks` times at a constant depth, for the bridge (the vehicle wiring is M03a1)
      let s: WaterWallState = { wetTicks: 0, stalled: false };
      let at: { stall: number | null; respawn: number | null } = { stall: null, respawn: null };
      for (let t = 1; t <= (num(a['ticks']) ?? 120); t++) {
        const r = waterWall(s, num(a['depth']) ?? 1, 1);
        s = r.state;
        if (r.verdict === 'stall' && at.stall === null) at = { ...at, stall: t };
        if (r.verdict === 'respawn' && at.respawn === null) at = { ...at, respawn: t };
      }
      return done(at);
    }
    case 'map': {
      const what = str(a['what']);
      const x = num(a['x']), z = num(a['z']);
      if (what === 'waypoint' && x !== null && z !== null) w.map.setWaypoint(x, z);
      else if (what === 'clearWaypoint') w.map.clearWaypoint();
      else if (what === 'route' && x !== null && z !== null) w.map.setRoute({ x, z });
      else if (what === 'clearRoute') w.map.setRoute(null);
      return done({ blips: w.map.blips().length, route: w.map.currentRoute ? { points: w.map.currentRoute.points.length / 2, lengthM: w.map.currentRoute.lengthM } : null });
    }
    case 'state':
      return done({
        tick,
        sealed: w.bounds.sealedPortals(),
        closed: w.traffic.closedEdges().length,
        blackout: w.traffic.blackout,
        density: { traffic: w.traffic.densityOf('traffic'), ped: w.traffic.densityOf('ped'), parked: w.traffic.densityOf('parked') },
        fog: w.boundaries.fog,
        boundary: w.boundaries.lastEvent,
        busy: w.teleport.busy,
        fares: w.teleport.fares,
        topology: w.network.hasTopology,
        residentChunks: w.network.residentKeys().length,
        blips: w.map.blips().length,
        play: w.play,
      });
    case 'ray': {
      // a ray against the static colliders: where the first solid thing is along a direction (the play-bounds wall, a barrier)
      const o = Array.isArray(a['from']) ? (a['from'] as number[]) : null;
      const d = Array.isArray(a['dir']) ? (a['dir'] as number[]) : null;
      if (!physics || !o || !d || o.length !== 3 || d.length !== 3) return done(null);
      const hit = physics.castRay([o[0] as number, o[1] as number, o[2] as number], [d[0] as number, d[1] as number, d[2] as number], num(a['max']) ?? 500, physics.staticMask);
      return done(hit ? { toi: hit.toi, at: [(o[0] as number) + (d[0] as number) * hit.toi, (o[1] as number) + (d[1] as number) * hit.toi, (o[2] as number) + (d[2] as number) * hit.toi], normal: hit.normal } : null);
    }
    case 'traffic': {
      // the ambient traffic (M03b1): counts, and with `focus` / `clearFocus` the point the traffic follows instead of the player
      const t = w.ambient;
      if (!t) return done(null);
      const fx = num(a['x']), fz = num(a['z']);
      if (a['clearFocus'] === true) t.focusOverride = null;
      else if (fx !== null && fz !== null) t.focusOverride = { x: fx, z: fz, vx: num(a['vx']) ?? 0, vz: num(a['vz']) ?? 0 };
      return done({
        ...t.describe(), tick, tier: t.sim.tier, radius: t.sim.radius, cap: t.sim.cap(),
        focus: t.focusOverride, stats: t.sim.stats, promoted: t.sim.promotions.count, filled: !t.sim.fill,
      });
    }
    case 'peds': {
      // the ambient pedestrians (M03b2): counts, and with `head` / `clearHead` the XR head pose they keep 0.6 m clear of
      const p = w.peds;
      if (!p) return done(null);
      const hx = num(a['headX']), hz = num(a['headZ']);
      if (a['clearHead'] === true) p.headOverride = null;
      else if (hx !== null && hz !== null) p.headOverride = { x: hx, z: hz };
      return done({ ...p.describe(), tick, radius: p.sim.radius, cap: p.sim.cap(), filled: !p.sim.fill, stats: p.sim.stats, attract: p.sim.attract.live().length });
    }
    case 'attract': {
      // a `crowd.attract` source at (x, z) for the pedestrians, or the release of one (`id`)
      const p = w.peds;
      if (!p) return done(null);
      const id = num(a['release']);
      if (id !== null) {
        p.sim.attract.release(id);
        return done({ released: id });
      }
      // `atPlayer`: at the player's place, the point the pedestrians follow
      const at = a['atPlayer'] === true ? w.transit?.playerAt() ?? null : null;
      const x = at ? at[0] : num(a['x']), z = at ? at[2] : num(a['z']);
      return done(x === null || z === null ? null : { id: p.sim.attract.add(x, z, str(a['by']) ?? 'debug') });
    }
    case 'crowd': {
      // QA: n pedestrians 8 to 40 m around the player (or at x, z), so the near level and the gathering are easy to see
      const p = w.peds;
      if (!p) return done(null);
      const at = w.transit?.playerAt() ?? null;
      const x = num(a['x']) ?? (at ? at[0] : null), z = num(a['z']) ?? (at ? at[2] : null);
      if (x === null || z === null) return done(null);
      return done({ placed: p.sim.scatter(x, z, Math.min(64, Math.max(0, Math.floor(num(a['n']) ?? 12))), num(a['rMin']) ?? 8, num(a['rMax']) ?? 40) });
    }
    case 'transit': {
      const t = w.transit;
      return done(t ? { ...t.describe(), tick } : null);
    }
    case 'ride': {
      // Bay Rail from one station to another, or a robotaxi to a point
      const t = w.transit;
      if (!t) return done(null);
      const from = str(a['from']);
      const to = str(a['to']) ?? (a['next'] === true && from !== null ? t.nextStationOf(from) : null);
      if (from !== null && to !== null) {
        void t.ride.fastTravel(from, to).then(done);
        return;
      }
      // `dx`, `dz`: a point relative to where the player stands (the QA panel's taxi button)
      const at = t.playerAt();
      const x = num(a['x']) ?? (at && num(a['dx']) !== null ? at[0] + (num(a['dx']) as number) : null);
      const z = num(a['z']) ?? (at && num(a['dz']) !== null ? at[2] + (num(a['dz']) as number) : null);
      if (x === null || z === null) return done(null);
      void t.ride.callRobotaxi({ x, z }, 'point').then(done);
      return;
    }
    case 'infraction': {
      const t = w.ambient;
      const x = num(a['x']), z = num(a['z']);
      if (!t || x === null || z === null) return done(null);
      const id = t.board.post((str(a['kind']) ?? 'redLightSeen') as never, { x, y: num(a['y']) ?? 0, z }, str(a['actor']) ?? '', tick);
      return done({ id });
    }
    case 'candidates': {
      const kind = (KINDS as readonly string[]).includes(String(a['kind'])) ? (a['kind'] as TeleportKind) : 'sandbox';
      return done(w.teleport.candidates(kind));
    }
    default:
      return done({ error: `unknown op ${cmd.op}` });
  }
}
