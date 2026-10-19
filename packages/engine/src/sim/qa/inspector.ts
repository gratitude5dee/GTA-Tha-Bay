/**
 * The QA entity inspector and the physics shape list (M03a1; 01-engine.md 2.11). Debug and sandbox builds only: the sim worker
 * entry installs it behind `VITE_DV_QA`, so a production bundle has neither this file nor the commands it answers.
 *
 * - `debug.inspect` lists the components of an entity with their field values;
 * - `debug.edit` sets one field (between ticks, like every debug command: the command channel is the only way in);
 * - `debug.physics` lists the shape of every body by entity handle, which the page draws as a wireframe (the U-ENG-6 fallback:
 *   Rapier's debug-render API is UNVERIFIED, so the page draws the `BodyDesc` shapes itself).
 */
import type { ComponentDef, EntityHandle, EntityId } from '@dv/shared';
import { BodyRef, Control, LocalPlayer, Transform, Vehicle } from '../ecs/components.ts';
import type { PhysicsSim } from '../sim-factory.ts';
import type { DebugCommand } from '../transport/envelope.ts';

type Reply = (name: string, data: unknown) => void;

/** The entity to inspect when the caller names none: the vehicle the player drives, else the player. */
function defaultEntity(sim: PhysicsSim): number {
  const ecs = sim.ecs;
  const players = ecs.query([LocalPlayer, Control]);
  const pid = (players[0] ?? 0) as number;
  if (pid !== 0) {
    const co = ecs.store(Control);
    const target = co.target[pid] as number;
    if (co.owner[pid] === 2 && target !== 0 && ecs.hasId(target, Vehicle)) return target;
  }
  return pid;
}

function readComponent(sim: PhysicsSim, id: number, def: ComponentDef): Record<string, number | number[]> {
  const layout = sim.ecs.layoutOf(def);
  const out: Record<string, number | number[]> = {};
  for (const f of layout.fields) {
    const arrays = f.arrays as unknown as ArrayLike<number>[];
    out[f.name] = arrays.length === 1 ? ((arrays[0] as ArrayLike<number>)[id] as number) : arrays.map((a) => a[id] as number);
  }
  return out;
}

export function qaInspector(sim: PhysicsSim, cmd: DebugCommand, reply: Reply): void {
  const ecs = sim.ecs;
  if (cmd.t === 'debug.inspect') {
    const id = cmd.handle !== undefined ? (ecs.resolve(cmd.handle as EntityHandle) ?? 0) : defaultEntity(sim);
    if (id === 0) {
      reply(`inspect.reply.${cmd.id}`, { ok: false, reason: 'no such entity' });
      return;
    }
    const components: Record<string, Record<string, number | number[]>> = {};
    for (const def of ecs.registry.list()) {
      if (def.id === 3 || def.id === 4) continue;   // Gen and Key are bookkeeping
      if (ecs.hasId(id, def)) components[def.name] = readComponent(sim, id, def);
    }
    reply(`inspect.reply.${cmd.id}`, { ok: true, handle: ecs.handle(id as EntityId), key: ecs.keyOf(ecs.handle(id as EntityId)), components });
    return;
  }
  if (cmd.t === 'debug.edit') {
    const id = ecs.resolve(cmd.handle as EntityHandle);
    const def = ecs.registry.getByName(cmd.component);
    if (id === null || !def || !ecs.hasId(id, def)) {
      reply(`inspect.reply.${cmd.id}`, { ok: false, reason: 'no such entity or component' });
      return;
    }
    const layout = ecs.layoutOf(def);
    const field = layout.fields.find((f) => f.name === cmd.field);
    const arrays = field?.arrays as unknown as ArrayLike<number>[] | undefined;
    const lane = cmd.lane ?? 0;
    const array = arrays?.[lane] as { [i: number]: number } | undefined;
    if (!array) {
      reply(`inspect.reply.${cmd.id}`, { ok: false, reason: 'no such field' });
      return;
    }
    array[id] = cmd.value;
    reply(`inspect.reply.${cmd.id}`, { ok: true, value: array[id] });
    return;
  }
  if (cmd.t === 'debug.physics') {
    const ids = ecs.query([BodyRef, Transform]);
    const bodies = ecs.store(BodyRef).body;
    const list: { handle: number; shape: string; dims: number[]; kind: string }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const body = bodies[id] as number;
      const shape = sim.backend.bodyShape(body);
      if (!shape) continue;
      list.push({ handle: ecs.handle(id as EntityId), shape: shape.shape, dims: shape.dims, kind: sim.backend.bodyKind(body) ?? 'fixed' });
    }
    reply(`physics.reply.${cmd.id}`, { ok: true, bodies: list });
  }
}
