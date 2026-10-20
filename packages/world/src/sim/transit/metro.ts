/**
 * City Metro (living part 5; M03b2): 2-car trains on the surface splines of `data/transit-routes.v1` (OSM light rail and tram ways,
 * tunnels dropped), running back and forth with a stop at each end. Not boardable in v1. Station stops along the spline are not
 * modelled (BD-M03b2-05). Pure; C02 lint applies.
 */
import { Path, type TransitRoutesData } from './path.ts';
import { TRANSIT_CONFIG, type TransitRows } from './components.ts';

export const metroPaths = (d: TransitRoutesData): Path[] => d.metro.map((r) => new Path(r.points));
export const metroSpeed = (c: TransitRows = TRANSIT_CONFIG): number => c.speeds.metroMps;
export const metroEndDwell = (c: TransitRows = TRANSIT_CONFIG): number => Math.round(c.dwell.metroEndS * 60);
