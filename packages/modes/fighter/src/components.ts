/**
 * Fighter components 1280 to 1283 (C01 range 1280 to 1535, owner S07; 07-fighter-core.md FC2 "ECS mirror"). The authoritative state
 * of a match is the `Int32Array` of the fight core; these carry a projection for the renderer and the engine hash. Registered by
 * the fighter sim module (`sim/module.ts`) when the boot payload says `fighter: true`, so a session that never fights registers,
 * allocates and hashes exactly what it did before. `FightDigest` is the one hashed component: it is rewritten every tick from the
 * match hash, so the C02 `stateHash` covers a match without a new engine hook.
 */
import { defineComponent } from '@dv/engine/sim';
import type { ComponentDef } from '@dv/shared';

export const FighterView = defineComponent({
  id: 1280, name: 'FighterView', owner: 'S07', hashed: false, snapshot: 'render+net',
  schema: { slot: 'u8', state: 'u16', move: 'u16', frame: 'f32', facing: 'i8', hitFlash: 'u8' },
});
export const FightDigest = defineComponent({
  id: 1281, name: 'FightDigest', owner: 'S07', hashed: true, snapshot: 'none',
  schema: { lo: 'u32', hi: 'u32', tick: 'u32' },
});
export const ProjectileView = defineComponent({
  id: 1282, name: 'ProjectileView', owner: 'S07', hashed: false, snapshot: 'render',
  schema: { kind: 'u8', owner: 'u8', frame: 'u16' },
});
export const StageProp = defineComponent({
  id: 1283, name: 'StageProp', owner: 'S07', hashed: false, snapshot: 'render',
  schema: { prop: 'u16', phase: 'f32' },
});

export const FIGHTER_COMPONENTS: readonly ComponentDef[] = [FighterView, FightDigest, ProjectileView, StageProp];

/** The four prefabs the mirror spawns (loaded with the components). Gray-box `render.asset` refs: nothing is drawn from the world scene. */
export const FIGHTER_PREFABS = [
  { id: 'fighter.view', kind: 'prop', version: 1, render: { asset: 'character/graybox.fighter' }, physics: null, components: { FighterView: {} } },
  { id: 'fighter.digest', kind: 'marker', version: 1, render: { asset: 'prop/graybox.fighter-digest' }, physics: null, components: { FightDigest: {} } },
  { id: 'fighter.projectile', kind: 'prop', version: 1, render: { asset: 'prop/graybox.fighter-projectile' }, physics: null, components: { ProjectileView: {} } },
  { id: 'fighter.stage', kind: 'prop', version: 1, render: { asset: 'prop/graybox.stage-powell_turntable-day' }, physics: null, components: { StageProp: {} } },
] as const;
