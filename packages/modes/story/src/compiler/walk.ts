/**
 * One walk over a mission IR that reports every reference it holds, with the JSON Pointer of the node. The validator and the lint
 * are written against these callbacks, so no rule has its own traversal of the (recursive) op and predicate trees.
 */
import type { BeatRef, LatLngTuple, MissionIR, ObjectiveDef, Op, NpcTask, Pred } from '@dv/shared';

export interface Visitor {
  /** A name that must be a cast entry (`who`: 'player' and 'playerVehicle' are allowed too; `zoneOk`: a zone name is allowed). */
  cast?(name: string, ptr: string, o: { who: boolean; zoneOk: boolean }): void;
  zone?(name: string, ptr: string): void;
  line?(id: string, ptr: string): void;
  loc?(key: string, ptr: string): void;
  latLng?(p: LatLngTuple, ptr: string): void;
  landmark?(id: string, ptr: string): void;
  beat?(ref: BeatRef, ptr: string): void;
  prefab?(id: string, ptr: string): void;
  item?(id: string, ptr: string): void;
  hook?(id: string, ptr: string): void;
  /** Every op node, once (the op budget counts these). */
  op?(op: Op, ptr: string): void;
  objective?(o: ObjectiveDef, ptr: string, where: { stage: number | null; hook: string | null }): void;
  /** A talk outcome that jumps to `stage` (a stage id). */
  jump?(stage: string, ptr: string, talkPtr: string): void;
}

const whoRef = (v: Visitor, name: string | undefined, ptr: string): void => {
  if (name !== undefined) v.cast?.(name, ptr, { who: true, zoneOk: false });
};
const castRef = (v: Visitor, name: string | undefined, ptr: string): void => {
  if (name !== undefined) v.cast?.(name, ptr, { who: false, zoneOk: false });
};

function placement(v: Visitor, p: { at: LatLngTuple | { landmark: string } }, ptr: string): void {
  if (Array.isArray(p.at)) v.latLng?.(p.at, `${ptr}/at`);
  else v.landmark?.(p.at.landmark, `${ptr}/at/landmark`);
}

export function walkPred(v: Visitor, p: Pred, ptr: string): void {
  switch (p.p) {
    case 'and':
    case 'or':
      p.of.forEach((x, i) => walkPred(v, x, `${ptr}/of/${i}`));
      break;
    case 'not':
      walkPred(v, p.of, `${ptr}/of`);
      break;
    case 'inZone':
      whoRef(v, p.who, `${ptr}/who`);
      v.zone?.(p.zone, `${ptr}/zone`);
      break;
    case 'inVehicle':
      whoRef(v, p.who, `${ptr}/who`);
      if (p.vehicle !== undefined && p.vehicle !== 'any') castRef(v, p.vehicle, `${ptr}/vehicle`);
      break;
    case 'near':
    case 'far':
      whoRef(v, p.a, `${ptr}/a`);
      whoRef(v, p.b, `${ptr}/b`);
      break;
    case 'health':
    case 'ko':
    case 'speed':
      whoRef(v, p.who, `${ptr}/who`);
      break;
    case 'destroyed':
      castRef(v, p.cast, `${ptr}/cast`);
      break;
    case 'modeResult':
      v.hook?.(p.hook, `${ptr}/hook`);
      break;
    case 'item':
      v.item?.(p.id, `${ptr}/id`);
      break;
    default:
      break;
  }
}

function walkTask(v: Visitor, t: NpcTask, ptr: string): void {
  switch (t.t) {
    case 'goto':
    case 'driveTo':
      v.zone?.(t.zone, `${ptr}/zone`);
      break;
    case 'follow':
    case 'look':
      whoRef(v, t.t === 'follow' ? t.who : t.who, `${ptr}/who`);
      break;
    case 'enterVehicle':
      castRef(v, t.vehicle, `${ptr}/vehicle`);
      break;
    case 'flee':
      whoRef(v, t.from, `${ptr}/from`);
      break;
    default:
      break;
  }
}

export function walkOps(v: Visitor, ops: readonly Op[] | undefined, ptr: string): void {
  (ops ?? []).forEach((o, i) => walkOp(v, o, `${ptr}/${i}`));
}

function walkOp(v: Visitor, o: Op, ptr: string): void {
  v.op?.(o, ptr);
  switch (o.op) {
    case 'seq':
      walkOps(v, o.body, `${ptr}/body`);
      break;
    case 'all':
    case 'race':
      o.branches.forEach((b, i) => walkOps(v, b, `${ptr}/branches/${i}`));
      break;
    case 'if':
      walkPred(v, o.cond, `${ptr}/cond`);
      walkOps(v, o.then, `${ptr}/then`);
      walkOps(v, o.else, `${ptr}/else`);
      break;
    case 'loop':
      if (o.until) walkPred(v, o.until, `${ptr}/until`);
      walkOps(v, o.body, `${ptr}/body`);
      break;
    case 'waitUntil':
      walkPred(v, o.cond, `${ptr}/cond`);
      walkOps(v, o.onTimeout, `${ptr}/onTimeout`);
      break;
    case 'spawn':
    case 'despawn':
      o.cast.forEach((c, i) => castRef(v, c, `${ptr}/cast/${i}`));
      break;
    case 'task':
      castRef(v, o.cast, `${ptr}/cast`);
      walkTask(v, o.task, `${ptr}/task`);
      break;
    case 'say':
      if (o.speaker !== 'player' && o.speaker !== 'radio') castRef(v, o.speaker, `${ptr}/speaker`);
      v.line?.(o.line, `${ptr}/line`);
      break;
    case 'text':
      v.line?.(o.line, `${ptr}/line`);
      break;
    case 'marker':
      v.cast?.(o.target, `${ptr}/target`, { who: false, zoneOk: true });
      break;
    case 'beat':
      v.beat?.(o.ref, `${ptr}/ref`);
      break;
    case 'camera':
      whoRef(v, o.subject, `${ptr}/subject`);
      break;
    case 'heat':
      castRef(v, o.unit, `${ptr}/unit`);
      break;
    case 'trust':
      castRef(v, o.npc, `${ptr}/npc`);
      break;
    case 'give':
      (o.items ?? []).forEach((it, i) => v.item?.(it.id, `${ptr}/items/${i}/id`));
      break;
    default:
      break;
  }
}

function walkObjective(v: Visitor, o: ObjectiveDef, ptr: string, where: { stage: number | null; hook: string | null }): void {
  v.objective?.(o, ptr, where);
  v.loc?.(o.text, `${ptr}/text`);
  switch (o.k) {
    case 'goto':
      v.zone?.(o.zone, `${ptr}/zone`);
      if (o.inVehicle !== undefined && o.inVehicle !== 'any') castRef(v, o.inVehicle, `${ptr}/inVehicle`);
      break;
    case 'enterVehicle':
      if (o.vehicle !== 'any') castRef(v, o.vehicle, `${ptr}/vehicle`);
      break;
    case 'follow':
      castRef(v, o.target, `${ptr}/target`);
      if (o.untilZone !== undefined) v.zone?.(o.untilZone, `${ptr}/untilZone`);
      break;
    case 'chase':
    case 'protect':
      castRef(v, o.k === 'chase' ? o.target : o.target, `${ptr}/target`);
      if (o.k === 'protect' && o.untilZone !== undefined) v.zone?.(o.untilZone, `${ptr}/untilZone`);
      break;
    case 'collect':
      castRef(v, o.cast, `${ptr}/cast`);
      break;
    case 'deliver':
      castRef(v, o.cast, `${ptr}/cast`);
      v.zone?.(o.to, `${ptr}/to`);
      break;
    case 'talk': {
      castRef(v, o.talk.npc, `${ptr}/talk/npc`);
      v.loc?.(o.talk.intent, `${ptr}/talk/intent`);
      for (const [name, out] of Object.entries(o.talk.outcomes)) {
        v.loc?.(out.label, `${ptr}/talk/outcomes/${name}/label`);
        if (out.stage !== undefined) v.jump?.(out.stage, `${ptr}/talk/outcomes/${name}/stage`, `${ptr}/talk`);
      }
      break;
    }
    case 'photo':
      if (o.subject.startsWith('lm.')) v.landmark?.(o.subject, `${ptr}/subject`);
      else castRef(v, o.subject, `${ptr}/subject`);
      break;
    case 'stealth':
      v.zone?.(o.zone, `${ptr}/zone`);
      o.autoplayPath.forEach((p, i) => v.latLng?.(p, `${ptr}/autoplayPath/${i}`));
      break;
    case 'defeat':
      o.targets.forEach((t, i) => castRef(v, t, `${ptr}/targets/${i}`));
      break;
    case 'mode':
      v.hook?.(o.hook, `${ptr}/hook`);
      break;
    default:
      break;
  }
}

/** Walks the whole mission. */
export function walkMission(v: Visitor, ir: MissionIR): void {
  v.loc?.(ir.title, '/title');
  const trig = ir.start;
  if (trig.k === 'marker') placement(v, trig.at, '/start/at');
  if (trig.k === 'auto') walkPred(v, trig.when, '/start/when');
  ir.requires.forEach((p, i) => walkPred(v, p, `/requires/${i}`));
  for (const [name, c] of Object.entries(ir.cast)) {
    const p = `/cast/${name}`;
    if ('spawn' in c && c.spawn) placement(v, c.spawn, `${p}/spawn`);
    if ('prefab' in c && c.prefab) v.prefab?.(c.prefab, `${p}/prefab`);
  }
  for (const [name, z] of Object.entries(ir.zones)) {
    const p = `/zones/${name}`;
    switch (z.k) {
      case 'circle':
        v.latLng?.(z.at, `${p}/at`);
        break;
      case 'poly':
        z.ring.forEach((pt, i) => v.latLng?.(pt, `${p}/ring/${i}`));
        break;
      case 'landmark':
        v.landmark?.(z.id, `${p}/id`);
        break;
      case 'route':
        z.via.forEach((pt, i) => v.latLng?.(pt, `${p}/via/${i}`));
        break;
      case 'cast':
        castRef(v, z.cast, `${p}/cast`);
        break;
    }
  }
  if (ir.intro) v.beat?.(ir.intro, '/intro');
  if (ir.outro) v.beat?.(ir.outro, '/outro');
  ir.stages.forEach((s, si) => {
    const p = `/stages/${si}`;
    walkOps(v, s.onEnter, `${p}/onEnter`);
    walkOps(v, s.onComplete, `${p}/onComplete`);
    s.objectives.forEach((o, oi) => walkObjective(v, o, `${p}/objectives/${oi}`, { stage: si, hook: null }));
  });
  for (const [name, ops] of Object.entries(ir.threads ?? {})) walkOps(v, ops, `/threads/${name}`);
  ir.fail.forEach((f, i) => {
    walkPred(v, f.when, `/fail/${i}/when`);
    v.loc?.(f.reason, `/fail/${i}/reason`);
  });
  (ir.modeHooks ?? []).forEach((h, i) => {
    walkObjective(v, h.stub, `/modeHooks/${i}/stub`, { stage: null, hook: h.id });
  });
  if (ir.medals?.goldIf) walkPred(v, ir.medals.goldIf, '/medals/goldIf');
  ir.lines.forEach((l, i) => v.line?.(l, `/lines/${i}`));
}
