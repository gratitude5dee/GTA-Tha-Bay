/**
 * The handling presets: the ten of M03a1 and the five race cars of M07a1 (`content/vehicles/handling/hp.*.json`, schema
 * `packages/shared/schemas/racing/handling.schema.json`), bundled so the sim worker needs no fetch. Mods add theirs through the registry below.
 */
import type { HandlingProfile } from '@dv/shared';
import compact from '../../../../../content/vehicles/handling/hp.compact.json';
import sedan from '../../../../../content/vehicles/handling/hp.sedan.json';
import rideshare from '../../../../../content/vehicles/handling/hp.rideshare.json';
import van from '../../../../../content/vehicles/handling/hp.van.json';
import truck from '../../../../../content/vehicles/handling/hp.truck.json';
import pickup from '../../../../../content/vehicles/handling/hp.pickup.json';
import policeCruiser from '../../../../../content/vehicles/handling/hp.police-cruiser.json';
import policeSuv from '../../../../../content/vehicles/handling/hp.police-suv.json';
import robotaxiAmbient from '../../../../../content/vehicles/handling/hp.robotaxi-ambient.json';
import ondinePico from '../../../../../content/vehicles/handling/hp.ondine-pico.json';
import aurelianSorrel from '../../../../../content/vehicles/handling/hp.aurelian-sorrel.json';
import kestrelQuill from '../../../../../content/vehicles/handling/hp.kestrel-quill.json';
import brackenridgeRasp from '../../../../../content/vehicles/handling/hp.brackenridge-rasp.json';
import solenneSkip from '../../../../../content/vehicles/handling/hp.solenne-skip.json';
import halcyonCormorant from '../../../../../content/vehicles/handling/hp.halcyon-cormorant.json';

const BUILT_IN = [
  compact,
  sedan,
  rideshare,
  van,
  truck,
  pickup,
  policeCruiser,
  policeSuv,
  robotaxiAmbient,
  ondinePico,
  aurelianSorrel,
  kestrelQuill,
  brackenridgeRasp,
  solenneSkip,
  halcyonCormorant,
] as unknown as HandlingProfile[];

const registry = new Map<string, HandlingProfile>();
for (const p of BUILT_IN) registry.set(p.id, p);

export class UnknownHandlingError extends Error {
  constructor(readonly handlingId: string) {
    super(`unknown handling profile ${handlingId}`);
    this.name = 'UnknownHandlingError';
  }
}

/** Every built-in preset, in registration order. */
export const HANDLING_PRESETS: readonly HandlingProfile[] = BUILT_IN;

export function handlingById(id: string): HandlingProfile {
  const p = registry.get(id);
  if (!p) throw new UnknownHandlingError(id);
  return p;
}

/** Adds or replaces a profile (mods, tests). Callers validate against the schema and the class envelope first. */
export function registerHandling(p: HandlingProfile): void {
  registry.set(p.id, p);
}
