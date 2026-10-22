import { PI, enuFromLatLng, type MapBlip, type TeleportResult, type WorldApi } from '@dv/shared';

export interface WorldStandinDeps {
  /** Ground height from the colliders that are resident (the M01f gray-box chunks); null where there is none. */
  groundY(x: number, z: number): number | null;
}

/**
 * `ModeContext.world` on a build without a baked world (DL-668): the engine-side gray-box stand-in for the C08 `WorldApi`. Ground
 * and water read the resident fixture chunks; the district is `255` / `null`; teleports are refused as `not-loaded`; the road graph
 * has no edges, so every route is `null`; places are empty; the map keeps its blips in memory; traffic overrides are recorded and
 * change nothing; the resolver's bake is `'graybox'`. Engine code never imports `@dv/world`, which depends on `@dv/engine`.
 */
export function createWorldStandin(deps: WorldStandinDeps): WorldApi {
  const blips = new Map<string, MapBlip>();
  const notLoaded: TeleportResult = { ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' };
  let blackout = false;
  return {
    graph: {
      edge: () => null,
      nearestEdge: () => null,
      laneCentre: (_e, out) => {
        out.fill(0);
      },
      route: () => null,
      resolve: () => null,
      signal: () => 'dark' as never,
      neighbours: () => [],
    },
    traffic: {
      setBlackout: (on) => {
        blackout = on;
      },
      setDensity: () => undefined,
      closeEdges: () => undefined,
      release: () => {
        blackout = false;
      },
      get blackout() {
        return blackout;
      },
    },
    map: {
      setBlip: (b) => void blips.set(b.id, b),
      removeBlip: (id) => void blips.delete(id),
      setWaypoint: (x, z) => void blips.set('waypoint', { id: 'waypoint', kind: 'waypoint', shape: 'pin', colorToken: 'waypoint', x, z, priority: 5 }),
      clearWaypoint: () => void blips.delete('waypoint'),
      setRoute: () => undefined,
      blips: () => [...blips.values()],
    },
    teleport: {
      request: () => Promise.resolve(notLoaded),
      candidates: () => [],
    },
    query: {
      groundY: (x, z) => deps.groundY(x, z),
      isWater: () => false,
      nhoodAt: () => 255,
      districtAt: () => null,
      chunkReady: () => false,
      nearestWalkable: () => null,
    },
    places: {
      landmarks: () => [],
      landmark: () => null,
      poi: () => null,
      poisNear: () => [],
      poiPos: () => null,
      pedRoute: () => [],
      findPlace: () => Promise.resolve([]),
    },
    // The gray-box resolver (M05a1): the C08 frame and the resident ground. `ground` and `none` placements resolve (a ground
    // placement needs a resident collider under it); `road` and `sidewalk` need the graph this build does not have, so they do not.
    resolver: {
      bake: 'graybox',
      toEnu: (ll) => {
        const p = enuFromLatLng(ll.lat, ll.lng);
        return [p.x, deps.groundY(p.x, p.z) ?? 0, p.z];
      },
      landmark: () => null,
      snap: (req) => {
        if (!('lat' in req.at) || req.snap === 'road' || req.snap === 'sidewalk') return null;
        const p = enuFromLatLng(req.at.lat, req.at.lng);
        const g = deps.groundY(p.x, p.z);
        if (req.snap === 'ground' && g === null) return null;
        const y = req.snap === 'none' ? (req.y ?? g ?? 0) : (g ?? 0);
        return { pos: [p.x, y, p.z], yaw: ((req.yawDeg ?? 0) * PI) / 180, distM: 0 };
      },
      route: () => null,
    },
  };
}
