/**
 * Compiler stages 1 and 2 (C09 section C5): the JSON Schema with its bounds, then the references (cast, zone, line, landmark, hook,
 * stage), the world bounds, the fallbacks of beats and the op budget. Errors carry the JSON Pointer of the node.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { enuFromLatLng, type MissionIR } from '@dv/shared';
import schema from '../../../../shared/schemas/mission-ir-1.schema.json' with { type: 'json' };
import type { CompileEnv, CompileError } from './types.ts';
import { walkMission, type Visitor } from './walk.ts';

export const OP_NODE_LIMIT = 4000;

let validators: { story: ValidateFunction; mod: ValidateFunction } | null = null;
function schemas(): { story: ValidateFunction; mod: ValidateFunction } {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  ajv.addSchema(schema as object);
  const story = ajv.getSchema('mission-ir-1#/$defs/story');
  const mod = ajv.getSchema('mission-ir-1#/$defs/mod');
  if (!story || !mod) throw new Error('mission-ir-1.schema.json has no profile roots');
  validators = { story, mod };
  return validators;
}

/** Ajv errors as `E_SCHEMA`, one per pointer and message. */
function schemaErrors(errors: readonly ErrorObject[]): CompileError[] {
  const out: CompileError[] = [];
  const seen = new Set<string>();
  for (const e of errors) {
    // the branch-selecting keywords add noise next to the error of the branch that was chosen
    if (e.keyword === 'oneOf' || e.keyword === 'anyOf' || e.keyword === 'if') continue;
    let pointer = e.instancePath;
    const p = e.params as Record<string, unknown>;
    if (e.keyword === 'required' && typeof p['missingProperty'] === 'string') pointer += `/${p['missingProperty']}`;
    if (e.keyword === 'additionalProperties' && typeof p['additionalProperty'] === 'string') pointer += `/${p['additionalProperty']}`;
    const message = `${e.message ?? 'invalid'}${e.keyword === 'enum' && Array.isArray(p['allowedValues']) ? ` (${(p['allowedValues'] as unknown[]).join(', ')})` : ''}`;
    const key = `${pointer}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: 'E_SCHEMA', pointer: pointer === '' ? '/' : pointer, message });
  }
  return out;
}

/** Stage 1: the schema (story or mod profile). A mission that fails it is not walked further. */
export function validateSchema(ir: unknown, profile: 'story' | 'mod'): CompileError[] {
  const v = schemas()[profile];
  if (v(ir)) return [];
  const errs = schemaErrors(v.errors ?? []);
  return errs.length > 0 ? errs : [{ code: 'E_SCHEMA', pointer: '/', message: 'does not match mission-ir-1' }];
}

/** The ids of the stages reachable from stage 0 by the default order, `next` and talk outcome jumps. */
export function reachableStages(ir: MissionIR): Set<string> {
  const ids = ir.stages.map((s) => s.id);
  const seen = new Set<string>();
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.shift() as number;
    const s = ir.stages[i];
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.next !== undefined) {
      const j = ids.indexOf(s.next);
      if (j >= 0) queue.push(j);
    } else if (i + 1 < ir.stages.length) queue.push(i + 1);
    for (const o of s.objectives) {
      if (o.k !== 'talk') continue;
      for (const out of Object.values(o.talk.outcomes)) {
        const j = out.stage === undefined ? -1 : ids.indexOf(out.stage);
        if (j >= 0) queue.push(j);
      }
    }
  }
  return seen;
}

/** Stage 2: references, bounds, fallbacks, budget. Assumes the IR passed the schema. */
export function validateRefs(ir: MissionIR, env: CompileEnv): CompileError[] {
  const errors: CompileError[] = [];
  const add = (code: CompileError['code'], pointer: string, message: string): void => void errors.push({ code, pointer, message });
  const castNames = new Set(Object.keys(ir.cast));
  const zoneNames = new Set(Object.keys(ir.zones));
  const hookIds = new Set((ir.modeHooks ?? []).map((h) => h.id));
  const stageIds = new Set(ir.stages.map((s) => s.id));
  const declaredLines = new Set<string>(ir.lines);
  const usedLines: { id: string; ptr: string }[] = [];
  let ops = 0;

  const known = (key: string): boolean => env.lines.has(key) || (env.i18n?.has(key) ?? false);

  const v: Visitor = {
    cast(name, ptr, o) {
      if (o.who && (name === 'player' || name === 'playerVehicle')) return;
      if (castNames.has(name)) return;
      if (o.zoneOk && zoneNames.has(name)) return;
      add('E_REF_CAST', ptr, `${name} is not a cast entry of this mission`);
    },
    zone(name, ptr) {
      if (!zoneNames.has(name)) add('E_REF_ZONE', ptr, `${name} is not a zone of this mission`);
    },
    line(id, ptr) {
      if (!env.lines.has(id)) add('E_REF_LINE', ptr, `${id} is not in lines.en.json`);
      if (!ptr.startsWith('/lines/')) usedLines.push({ id, ptr });
    },
    loc(key, ptr) {
      if (!known(key)) add('E_REF_LINE', ptr, `${key} is neither in lines.en.json nor in the UI catalogue`);
    },
    latLng(p, ptr) {
      const { x, z } = enuFromLatLng(p[0], p[1]);
      const b = env.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) add('E_OUT_OF_BOUNDS', ptr, `[${p[0]}, ${p[1]}] is outside the play bounds`);
    },
    landmark(id, ptr) {
      if (!env.landmarks.has(id)) add('E_REF_LANDMARK', ptr, `${id} is not a landmark of the world`);
    },
    beat(ref, ptr) {
      if ('director' in ref) {
        if (!env.directors.has(ref.director)) add('E_NO_FALLBACK', `${ptr}/director`, `${ref.director} is not a DirectorScript`);
      } else {
        const c = env.cutscenes?.get(ref.cutscene);
        if (!c) add('E_NO_FALLBACK', `${ptr}/cutscene`, `${ref.cutscene} is not a known cutscene`);
        else if (!c.fallback) add('E_NO_FALLBACK', `${ptr}/cutscene`, `${ref.cutscene} has no in-engine fallback`);
      }
    },
    hook(id, ptr) {
      if (!hookIds.has(id)) add('E_HOOK_STUB', ptr, `${id} is not a mode hook of this mission`);
    },
    op() {
      ops++;
    },
    jump(stage, ptr) {
      if (!stageIds.has(stage)) add('E_UNREACHABLE_STAGE', ptr, `${stage} is not a stage of this mission`);
    },
  };
  walkMission(v, ir);

  // lines the ops speak must be listed in `lines` (the lint target of the mission)
  for (const u of usedLines) if (!declaredLines.has(u.id)) add('E_REF_LINE', '/lines', `${u.id} (used at ${u.ptr}) is missing from the mission's lines list`);

  // every stage must be reachable
  const reach = reachableStages(ir);
  ir.stages.forEach((s, i) => {
    if (!reach.has(s.id)) add('E_UNREACHABLE_STAGE', `/stages/${i}`, `stage ${s.id} cannot be reached from stage 0`);
  });
  const ids = ir.stages.map((s) => s.id);
  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) add('E_SCHEMA', `/stages/${i}/id`, `stage id ${id} is used twice`);
  });
  ir.stages.forEach((s, i) => {
    if (s.next !== undefined && !stageIds.has(s.next)) add('E_UNREACHABLE_STAGE', `/stages/${i}/next`, `${s.next} is not a stage of this mission`);
  });

  // a hook's stub must itself be a runnable objective: its references were checked by the walk; it may not be a mode objective
  (ir.modeHooks ?? []).forEach((h, i) => {
    if ((h.stub as { k: string }).k === 'mode') add('E_HOOK_STUB', `/modeHooks/${i}/stub`, 'a hook stub is never a mode objective');
  });

  // objective ids are unique inside the mission
  const oids = new Set<string>();
  ir.stages.forEach((s, si) => s.objectives.forEach((o, oi) => {
    if (oids.has(o.id)) add('E_SCHEMA', `/stages/${si}/objectives/${oi}/id`, `objective id ${o.id} is used twice`);
    oids.add(o.id);
  }));

  // cross-field bounds the schema cannot state
  const [lo, hi] = ir.autoplay.expectedSec;
  if (hi < lo * 1.2) add('E_SCHEMA', '/autoplay/expectedSec', 'max must be at least 1.2 times min');
  if (ir.medals && ir.medals.goldSec > ir.medals.silverSec) add('E_SCHEMA', '/medals', 'goldSec must not exceed silverSec');

  if (env.routable) {
    for (const [name, z] of Object.entries(ir.zones)) {
      if (z.k === 'route' && !env.routable(z.via)) add('E_ROUTE_UNSNAPPABLE', `/zones/${name}`, 'the route cannot be snapped to the road graph');
    }
  }

  if (ops > OP_NODE_LIMIT) add('E_BUDGET', '/', `${ops} op nodes (the limit is ${OP_NODE_LIMIT})`);
  return errors;
}
