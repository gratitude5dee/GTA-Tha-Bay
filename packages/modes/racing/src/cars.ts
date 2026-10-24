/**
 * The six player cars of M07a1, one per class (06-racing-content.md C.1): the prefab id, the handling profile it drives with and the
 * class. `ondine-pico` (D) is the starter loaner from M03a1; the other five are new. Final bodies `vehicle/<slug>` land in M10d3
 * (DL-460); until then each prefab draws the gray-box `vehicle/graybox.<slug>`.
 */
import type { HandlingProfile, VehicleClass } from '@dv/shared';
import ondinePico from '../../../../content/vehicles/handling/hp.ondine-pico.json';
import kestrelQuill from '../../../../content/vehicles/handling/hp.kestrel-quill.json';
import brackenridgeRasp from '../../../../content/vehicles/handling/hp.brackenridge-rasp.json';
import aurelianSorrel from '../../../../content/vehicles/handling/hp.aurelian-sorrel.json';
import solenneSkip from '../../../../content/vehicles/handling/hp.solenne-skip.json';
import halcyonCormorant from '../../../../content/vehicles/handling/hp.halcyon-cormorant.json';

export interface RaceCar { vehicleDef: string; slug: string; class: VehicleClass; profile: HandlingProfile }

const make = (vehicleDef: string, profile: unknown): RaceCar => {
  const p = profile as HandlingProfile;
  return { vehicleDef, slug: vehicleDef.slice('vehicle.'.length), class: p.class, profile: p };
};

export const RACE_CARS: readonly RaceCar[] = [
  make('vehicle.ondine-pico', ondinePico),
  make('vehicle.kestrel-quill', kestrelQuill),
  make('vehicle.brackenridge-rasp', brackenridgeRasp),
  make('vehicle.aurelian-sorrel', aurelianSorrel),
  make('vehicle.solenne-skip', solenneSkip),
  make('vehicle.halcyon-cormorant', halcyonCormorant),
];

/** The loaner a race hands out when the garage has no legal car (the starter D-class set, `unlock.racing` grants). */
export const LOANER_CAR = 'vehicle.ondine-pico';

export function raceCar(vehicleDef: string): RaceCar | null {
  return RACE_CARS.find((c) => c.vehicleDef === vehicleDef) ?? null;
}
