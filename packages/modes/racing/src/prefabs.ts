/**
 * Puppet prefabs of racing (M07a2): the rivals (M2 point masses) and the ghosts are entities with a transform and a model and no
 * physics body (`physics: null`), one pair per race car. The model is the gray-box body of the car, as the car's own prefab draws
 * it, until the final bodies land (M10d3, DL-460). Loaded by the racing sim module next to `RACE_CAR_PREFABS`, so a session that
 * does not race registers none of them.
 */
import type { RACE_CAR_PREFABS } from '@dv/engine/sim';
import { RACE_CARS } from './cars.ts';

export const RIVAL_PREFIX = 'racing.rival.';
export const GHOST_PREFIX = 'racing.ghost.';

const slugOf = (vehicleDef: string): string => (vehicleDef.startsWith('vehicle.') ? vehicleDef.slice('vehicle.'.length) : vehicleDef);

export const rivalPrefabOf = (vehicleDef: string): string => `${RIVAL_PREFIX}${slugOf(vehicleDef)}`;
export const ghostPrefabOf = (vehicleDef: string): string => `${GHOST_PREFIX}${slugOf(vehicleDef)}`;

type Def = (typeof RACE_CAR_PREFABS)[number];

function puppet(id: string, slug: string, component: Record<string, Record<string, number | string>>): Def {
  return {
    id,
    kind: 'prop',
    version: 1,
    render: { asset: `vehicle/graybox.${slug}` },
    physics: null,
    components: { Transform: { qw: 1 }, RenderKey: { visible: 1 }, ...component },
  } as unknown as Def;
}

export const PUPPET_PREFABS: readonly Def[] = RACE_CARS.flatMap((c) => [
  puppet(`${RIVAL_PREFIX}${c.slug}`, c.slug, { RaceParticipant: { flags: 2 } }),
  puppet(`${GHOST_PREFIX}${c.slug}`, c.slug, { GhostPlayback: {} }),
]);
