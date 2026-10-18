import { COMPONENT_ID_RANGES, type ComponentDef, type ComponentId, type ComponentSchema, type ScalarKind } from '@dv/shared';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Component id range per owner subagent (C01 COMPONENT_ID_RANGES, owners in table order). */
export const OWNER_RANGES: Readonly<Record<ComponentDef['owner'], readonly [number, number]>> = {
  S01: COMPONENT_ID_RANGES.engine,
  S02: COMPONENT_ID_RANGES.world,
  S03: COMPONENT_ID_RANGES.story,
  S04: COMPONENT_ID_RANGES.npc,
  S06: COMPONENT_ID_RANGES.racing,
  S07: COMPONENT_ID_RANGES.fighter,
  S08: COMPONENT_ID_RANGES.tycoon,
  S09: COMPONENT_ID_RANGES.net,
  S12: COMPONENT_ID_RANGES.mod,
};

const SCALAR_KINDS: readonly ScalarKind[] = ['f64', 'f32', 'i32', 'u32', 'i16', 'u16', 'i8', 'u8'];
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_RE = /^[a-z][A-Za-z0-9]*$/;

/** Throws RegistryError unless the definition obeys C01: id in its owner's range, PascalCase name, valid schema. */
export function checkComponentDef(def: ComponentDef): void {
  const range = OWNER_RANGES[def.owner];
  if (!range) throw new RegistryError(`component ${def.name}: unknown owner ${String(def.owner)}`);
  if (!Number.isInteger(def.id) || def.id < range[0] || def.id > range[1]) {
    throw new RegistryError(`component ${def.name}: id ${def.id} is outside the ${def.owner} range ${range[0]}..${range[1]}`);
  }
  if (!NAME_RE.test(def.name)) throw new RegistryError(`component name ${def.name} must be PascalCase`);
  for (const [field, spec] of Object.entries(def.schema)) {
    if (!FIELD_RE.test(field)) throw new RegistryError(`component ${def.name}: field ${field} must be camelCase`);
    const kind = typeof spec === 'string' ? spec : spec[0];
    if (!SCALAR_KINDS.includes(kind)) throw new RegistryError(`component ${def.name}.${field}: unknown scalar kind ${String(kind)}`);
    if (typeof spec !== 'string' && (!Number.isInteger(spec[1]) || spec[1] < 1 || spec[1] > 64)) {
      throw new RegistryError(`component ${def.name}.${field}: vector length must be an integer in 1..64`);
    }
  }
}

/** Validates and freezes a component definition. */
export function defineComponent<const S extends ComponentSchema>(def: ComponentDef<S>): ComponentDef<S> {
  checkComponentDef(def);
  return Object.freeze({ ...def, schema: Object.freeze({ ...def.schema }) });
}

/** The set of components of one world. Rejects duplicate ids and duplicate names. */
export class ComponentRegistry {
  private readonly sorted: ComponentDef[] = [];
  private readonly byIdMap = new Map<ComponentId, ComponentDef>();
  private readonly byNameMap = new Map<string, ComponentDef>();

  constructor(defs: readonly ComponentDef[] = []) {
    for (const d of defs) this.register(d);
  }

  register(def: ComponentDef): void {
    checkComponentDef(def);
    const sameId = this.byIdMap.get(def.id);
    if (sameId) throw new RegistryError(`component id ${def.id} is already used by ${sameId.name}`);
    if (this.byNameMap.has(def.name)) throw new RegistryError(`duplicate component name ${def.name}`);
    this.byIdMap.set(def.id, def);
    this.byNameMap.set(def.name, def);
    this.sorted.push(def);
    this.sorted.sort((a, b) => a.id - b.id);
  }

  get(id: ComponentId): ComponentDef | undefined {
    return this.byIdMap.get(id);
  }

  getByName(name: string): ComponentDef | undefined {
    return this.byNameMap.get(name);
  }

  has(def: ComponentDef): boolean {
    return this.byIdMap.get(def.id) === def;
  }

  /** Definitions in ascending id order. */
  list(): readonly ComponentDef[] {
    return this.sorted;
  }
}
