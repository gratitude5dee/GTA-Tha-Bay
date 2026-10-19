import { dcos, dsin, type ComponentDef, type EntityHandle, type StableKey } from '@dv/shared';
import playerDefault from '../../../../../assets/prefabs/player.default.json';
import { BodyRef, RenderKey, Transform } from '../ecs/components.ts';
import type { EcsWorld, PrefabComponent } from '../ecs/world.ts';
import type { BodyDesc, PhysicsBackend, WheelDesc } from '../physics/backend.ts';
import { PHYSICS_CONFIG } from '../physics/config.ts';
import { GROUP_BIT, GROUPS, interactionGroups } from '../physics/groups.ts';

/** Entity prefab kinds (spec/domains/01-engine-save-modes.md, "Entity prefabs"). */
export type PrefabKind = 'player' | 'vehicle' | 'ped' | 'prop' | 'pickup' | 'police' | 'robotaxi' | 'portal' | 'marker' | 'trigger';

type GroupName = keyof typeof GROUP_BIT;

/**
 * An entity prefab: `assets/prefabs/<id>.json`, validated by `schema/prefab.schema.json` at build and mod load.
 * (Distinct from the ECS-level `PrefabDef` in ecs/world.ts, which is only a component list; this one is the content
 * format and is turned into that one by `PrefabRegistry.load`.)
 */
export interface PrefabDef {
  id: string;
  kind: PrefabKind;
  version: number;
  nameKey?: string;
  render: { asset: string; variants?: number; anim?: string };
  physics: { body: BodyDesc['kind']; shape: BodyDesc['shape']; dims: number[]; massKg?: number; groups: GroupName[] } | null;
  /** ComponentDef name to default field values; a string value is interned. */
  components: Record<string, Record<string, number | string>>;
  vehicle?: { handling: string; seats: number; wheels: WheelDesc[]; quirks?: string[] };
  interact?: { kind: string; radius: number; promptKey: string };
  audio?: { set: string };
}

/** Where a prefab is placed: ENU metres and a heading in radians about +Y (0 faces -Z). */
export interface PrefabPlacement {
  pos: [number, number, number];
  yaw: number;
}

export interface PrefabService {
  spawn(id: string, at: PrefabPlacement, key?: StableKey, init?: Record<string, number>): EntityHandle;
  despawn(h: EntityHandle): void;
  def(id: string): PrefabDef;
}

export class PrefabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrefabError';
  }
}

/** The collision group bits a prefab names, as Rapier interaction groups (members: the named groups; filter: everything solid). */
export function groupsFromNames(names: readonly GroupName[]): number {
  if (names.length === 0) throw new PrefabError('a prefab body needs at least one collision group');
  if (names.length === 1) {
    const only = names[0] as GroupName;
    if (only in GROUPS) return GROUPS[only];
  }
  let membership = 0;
  for (const n of names) {
    const bit = GROUP_BIT[n];
    if (bit === undefined) throw new PrefabError(`unknown collision group ${String(n)}`);
    membership |= bit;
  }
  return interactionGroups(membership, 0xffff & ~GROUP_BIT.sensor);
}

/**
 * Loads prefab definitions into an `EcsWorld` and spawns them. A capsule prefab's `Transform` is its feet, and its
 * body is created centred `halfHeight + radius + skin` above them (see `onFootSystem`).
 */
export class PrefabRegistry implements PrefabService {
  private readonly defs = new Map<string, PrefabDef>();

  constructor(
    private readonly ecs: EcsWorld,
    private readonly backend: Pick<PhysicsBackend, 'createBody' | 'removeBody'> | null = null,
  ) {}

  /** Validates each definition, resolves component names and registers it with the ECS. Replaces a prefab with the same id. */
  load(defs: readonly PrefabDef[]): void {
    for (const def of defs) {
      this.check(def);
      const components: PrefabComponent[] = [];
      const seen = new Set<string>();
      const add = (name: string, values: Record<string, number | string>): void => {
        const cdef = this.componentByName(def.id, name);
        const init: Record<string, number> = {};
        for (const [field, v] of Object.entries(values)) {
          if (typeof v === 'string') init[field] = this.ecs.strings.intern(v);
          else init[field] = v;
        }
        components.push({ def: cdef, init });
        seen.add(name);
      };
      for (const [name, values] of Object.entries(def.components)) add(name, values);
      // A prefab with a body always has Transform and BodyRef; one with a render asset has RenderKey.
      if (!seen.has(Transform.name)) add(Transform.name, {});
      if (def.physics && !seen.has(BodyRef.name)) add(BodyRef.name, {});
      if (!seen.has(RenderKey.name)) add(RenderKey.name, {});
      const rkAt = components.findIndex((c) => c.def.name === RenderKey.name);
      const rk = components[rkAt];
      if (rk) components[rkAt] = { def: rk.def, init: { ...rk.init, asset: this.ecs.strings.intern(def.render.asset) } };
      this.ecs.definePrefab({ id: def.id, components });
      this.defs.set(def.id, def);
    }
  }

  def(id: string): PrefabDef {
    const d = this.defs.get(id);
    if (!d) throw new PrefabError(`unknown prefab ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  spawn(id: string, at: PrefabPlacement, key?: StableKey, init: Record<string, number> = {}): EntityHandle {
    const def = this.def(id);
    const values: Record<string, number> = { ...init };
    const half = at.yaw / 2;
    values['Transform.px'] = at.pos[0];
    values['Transform.py'] = at.pos[1];
    values['Transform.pz'] = at.pos[2];
    values['Transform.qx'] = 0;
    values['Transform.qy'] = dsin(half);
    values['Transform.qz'] = 0;
    values['Transform.qw'] = dcos(half);
    if (def.physics) {
      if (!this.backend) throw new PrefabError(`prefab ${id} has a body but this registry has no physics backend`);
      values['BodyRef.body'] = this.backend.createBody(this.bodyDesc(def, at));
    }
    return this.ecs.commands.spawn(id, values, key);
  }

  despawn(h: EntityHandle): void {
    const id = this.ecs.resolve(h);
    if (id !== null && this.backend && this.ecs.has(h, BodyRef)) {
      const body = this.ecs.store(BodyRef).body[id] as number;
      if (body !== 0) this.backend.removeBody(body);
    }
    this.ecs.commands.despawn(h);
  }

  private bodyDesc(def: PrefabDef, at: PrefabPlacement): BodyDesc {
    const p = def.physics as NonNullable<PrefabDef['physics']>;
    const centreLift = p.shape === 'capsule' ? (p.dims[0] as number) + (p.dims[1] as number) + PHYSICS_CONFIG.character.skinM : 0;
    const desc: BodyDesc = {
      kind: p.body,
      shape: p.shape,
      dims: [...p.dims],
      at: [at.pos[0], at.pos[1] + centreLift, at.pos[2]],
      groups: groupsFromNames(p.groups),
    };
    if (p.massKg !== undefined) desc.mass = p.massKg;
    return desc;
  }

  private componentByName(prefabId: string, name: string): ComponentDef {
    const c = this.ecs.registry.getByName(name);
    if (!c) throw new PrefabError(`prefab ${prefabId}: unknown component ${name}`);
    return c;
  }

  private check(def: PrefabDef): void {
    if (typeof def.id !== 'string' || def.id === '') throw new PrefabError('a prefab needs an id');
    if (!def.render || typeof def.render.asset !== 'string' || !/^[a-z][a-z0-9_-]*\/[A-Za-z0-9._-]+$/.test(def.render.asset)) {
      throw new PrefabError(`prefab ${def.id}: render.asset must be a C07 AssetRef '<kind>/<id>'`);
    }
    for (const [name, values] of Object.entries(def.components)) {
      const c = this.componentByName(def.id, name);
      for (const field of Object.keys(values)) {
        const base = field.split('.')[0] as string;
        if (!(base in c.schema)) throw new PrefabError(`prefab ${def.id}: component ${name} has no field ${field}`);
      }
    }
  }
}

/** The prefabs the engine ships (v1 list grows with M03a1 and later). */
export const ENGINE_PREFABS: readonly PrefabDef[] = [playerDefault as unknown as PrefabDef];
