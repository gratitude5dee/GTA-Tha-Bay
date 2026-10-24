/**
 * Ferries (living part 5; M03b2): 7 m/s on the water lines of `data/transit-routes.v1` (OSM `route=ferry` ways, else the authored
 * Ferry Building lines), back and forth with 20 s at each landing. Pure; C02 lint applies.
 */
import { Path, type TransitRoutesData } from './path.ts';
import { TRANSIT_CONFIG, type TransitRows } from './components.ts';

/** Height of the hull origin above the water surface (y = 0), metres. */
export const FERRY_DRAFT_M = 0;

export const ferryPaths = (d: TransitRoutesData): Path[] => d.ferry.map((r) => new Path(r.points));
export const ferrySpeed = (c: TransitRows = TRANSIT_CONFIG): number => c.speeds.ferryMps;
export const ferryEndDwell = (c: TransitRows = TRANSIT_CONFIG): number => Math.round(c.dwell.ferryEndS * 60);
