/**
 * Cable cars (living part 5; M03b2): 4.2 m/s on the authored chains of `content/world/cablecars.json`, baked into
 * `data/transit-routes.v1` as splines, back and forth with a stop at each terminus. Riding one (hop on and off at the stops, the
 * cling-on stunts) is not part of this milestone (BD-M03b2-06). A chain missing from the bake is never invented: with no
 * cable-car route the count is 0. Pure; C02 lint applies.
 */
import { Path, type TransitRoutesData } from './path.ts';
import { TRANSIT_CONFIG, type TransitRows } from './components.ts';

export const cablecarPaths = (d: TransitRoutesData): Path[] => d.cablecar.map((r) => new Path(r.points));
export const cablecarSpeed = (c: TransitRows = TRANSIT_CONFIG): number => c.speeds.cablecarMps;
export const cablecarEndDwell = (c: TransitRows = TRANSIT_CONFIG): number => Math.round(c.dwell.cablecarEndS * 60);
