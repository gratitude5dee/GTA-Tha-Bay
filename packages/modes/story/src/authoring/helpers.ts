/**
 * The mission authoring helpers (C09 section C2). They only build data: every function returns a plain value of the C09 types, and
 * `defineMission` returns a `MissionIR`. The compiler validates and resolves it; the runtime never runs this module.
 *
 * Objective ids and texts may be left out: the helper derives an id from the kind and its main target, and `defineMission` gives
 * every objective without a text the key `mission.<missionId>.obj.<objectiveId>` and makes the ids unique inside a stage.
 */
import type {
  BeatRef, CastDef, CastName, CastRole, FailRule, HeatLevel, LandmarkId, LatLngTuple, LineId, MissionIR, ModeHook, ObjectiveDef, Op, NpcTask, Placement, Pred, RosterSlot,
  Rewards, StageDef, TalkDef, Trigger, UnlockEventId, Who, WeatherPreset, ZoneDef, ZoneName,
} from '@dv/shared';

type ObjectiveOf<K extends ObjectiveDef['k']> = Extract<ObjectiveDef, { k: K }>;
type Base = { id?: string; text?: string; optional?: boolean; marker?: boolean };
type Opts<K extends ObjectiveDef['k']> = Base & Partial<Omit<ObjectiveOf<K>, 'k' | keyof Base>>;
const base = (o: Base | undefined): Partial<Pick<ObjectiveDef, 'id' | 'text' | 'optional' | 'marker'>> => {
  const out: Partial<Pick<ObjectiveDef, 'id' | 'text' | 'optional' | 'marker'>> = {};
  if (o?.id !== undefined) out.id = o.id;
  if (o?.text !== undefined) out.text = o.text;
  if (o?.optional !== undefined) out.optional = o.optional;
  if (o?.marker !== undefined) out.marker = o.marker;
  return out;
};
/** A helper-made objective before `defineMission` fills `id` and `text`. */
export type DraftObjective = Omit<ObjectiveDef, 'id' | 'text'> & { id?: string; text?: string };
const draft = (v: unknown): DraftObjective => v as DraftObjective;

// ---- placements, cast and zones ------------------------------------------------------------------------------------------------

export const at = (lat: number, lng: number, o: { snap?: Placement['snap']; yawDeg?: number; y?: number } = {}): Placement => ({
  at: [lat, lng],
  snap: o.snap ?? 'ground',
  ...(o.yawDeg !== undefined ? { yawDeg: o.yawDeg } : {}),
  ...(o.y !== undefined ? { y: o.y } : {}),
});
export const atLandmark = (id: LandmarkId, o: { snap?: Placement['snap']; yawDeg?: number } = {}): Placement => ({
  at: { landmark: id },
  snap: o.snap ?? 'ground',
  ...(o.yawDeg !== undefined ? { yawDeg: o.yawDeg } : {}),
});

type NpcOpts = { soul?: string; slot?: RosterSlot; role: CastRole; spawn?: Placement; prefab?: string; spawnAt?: 'start' | 'manual' };
export function npc(o: NpcOpts): CastDef {
  const who = o.slot !== undefined ? { slot: o.slot } : { soul: o.soul ?? '' };
  return { k: 'npc', who, role: o.role, ...(o.spawn ? { spawn: o.spawn } : {}), ...(o.prefab ? { prefab: o.prefab } : {}), ...(o.spawnAt ? { spawnAt: o.spawnAt } : {}) };
}
export const vehicle = (o: { prefab: string; spawn: Placement; role?: CastRole; playerUsable?: boolean; spawnAt?: 'start' | 'manual' }): CastDef => ({ k: 'vehicle', ...o });
export const prop = (o: { prefab: string; spawn: Placement; item?: string; spawnAt?: 'start' | 'manual' }): CastDef => ({ k: 'prop', ...o });
export const pickup = (o: { prefab: string; spawn: Placement; item?: string; spawnAt?: 'start' | 'manual' }): CastDef => ({ k: 'pickup', ...o });
export const unit = (o: { prefab: `police.${string}`; spawn: Placement; spawnAt?: 'start' | 'manual' }): CastDef => ({ k: 'unit', ...o });

export const circle = (lat: number, lng: number, r: number): ZoneDef => ({ k: 'circle', at: [lat, lng], r });
export const poly = (points: LatLngTuple[], o: { yMin?: number; yMax?: number } = {}): ZoneDef => ({ k: 'poly', ring: points, ...o });
export const landmark = (id: LandmarkId, r?: number): ZoneDef => ({ k: 'landmark', id, ...(r !== undefined ? { r } : {}) });
export const route = (widthM: number, ...via: LatLngTuple[]): ZoneDef => ({ k: 'route', via, widthM });
export const castZone = (cast: CastName, r: number): ZoneDef => ({ k: 'cast', cast, r });

// ---- triggers -----------------------------------------------------------------------------------------------------------------

export const markerTrigger = (where: Placement, radiusM: number, o: { onFoot?: boolean; hours?: [number, number] } = {}): Trigger => ({ k: 'marker', at: where, radiusM, ...o });
export const phoneTrigger = (contact: string, delaySec?: number): Trigger => ({ k: 'phone', contact, ...(delaySec !== undefined ? { delaySec } : {}) });
export const autoTrigger = (when: Pred): Trigger => ({ k: 'auto', when });

// ---- objectives ---------------------------------------------------------------------------------------------------------------

export const goto = (zone: ZoneName, o?: Opts<'goto'>): DraftObjective => draft({ k: 'goto', zone, ...(o ?? {}), id: o?.id ?? `goto_${zone}` });
export const enterVehicle = (vehicleName: CastName | 'any', o?: Opts<'enterVehicle'>): DraftObjective => draft({ k: 'enterVehicle', vehicle: vehicleName, ...base(o), id: o?.id ?? `enter_${vehicleName}` });
export const follow = (target: CastName, band: [number, number], loseAfterSec: number, o?: Opts<'follow'>): DraftObjective => draft({ k: 'follow', target, band, loseAfterSec, ...(o ?? {}), id: o?.id ?? `follow_${target}` });
export const chase = (target: CastName, catchDist: number, o?: Opts<'chase'>): DraftObjective => draft({ k: 'chase', target, catchDist, ...(o ?? {}), id: o?.id ?? `chase_${target}` });
export const escape = (o?: Base): DraftObjective => draft({ k: 'escape', untilHeat: 0, ...base(o), id: o?.id ?? 'escape' });
export const survive = (sec: number, o?: Base): DraftObjective => draft({ k: 'survive', sec, ...base(o), id: o?.id ?? 'survive' });
export const collect = (cast: CastName, o?: Base): DraftObjective => draft({ k: 'collect', cast, ...base(o), id: o?.id ?? `collect_${cast}` });
export const deliver = (cast: CastName, to: ZoneName, o?: Opts<'deliver'>): DraftObjective => draft({ k: 'deliver', cast, to, ...(o ?? {}), id: o?.id ?? `deliver_${cast}` });
export const protect = (target: CastName, minHealth: number, o?: Opts<'protect'>): DraftObjective => draft({ k: 'protect', target, minHealth, ...(o ?? {}), id: o?.id ?? `protect_${target}` });
export const talk = (def: TalkDef, o?: Base): DraftObjective => draft({ k: 'talk', talk: def, ...base(o), id: o?.id ?? `talk_${def.id}` });
export const photo = (subject: CastName | LandmarkId, o?: Opts<'photo'>): DraftObjective => draft({ k: 'photo', subject, ...(o ?? {}), id: o?.id ?? `photo_${subject.replace(/[^a-z0-9_]/g, '_')}` });
export const stealth = (zone: ZoneName, detectBudget: number, autoplayPath: LatLngTuple[], o?: Base): DraftObjective => draft({ k: 'stealth', zone, detectBudget, autoplayPath, ...base(o), id: o?.id ?? `stealth_${zone}` });
export const defeat = (targets: CastName[], o?: Base): DraftObjective => draft({ k: 'defeat', targets, nonLethal: true, ...base(o), id: o?.id ?? `defeat_${targets.join('_')}` });
export const score = (metric: 'drift' | 'airtime' | 'nearMiss', target: number, withinSec: number, o?: Base): DraftObjective => draft({ k: 'score', metric, target, withinSec, ...base(o), id: o?.id ?? `score_${metric}` });
export const waitFor = (sec: number, o?: Base): DraftObjective => draft({ k: 'wait', sec, ...base(o), id: o?.id ?? 'wait' });
export const modeObjective = (hook: string, o?: Base): DraftObjective => draft({ k: 'mode', hook, ...base(o), id: o?.id ?? `mode_${hook}` });

export const talkDef = (d: Omit<TalkDef, 'maxTurns' | 'ink'> & { maxTurns?: number; ink?: string }): TalkDef => ({ maxTurns: 4, ink: '', ...d });

export const modeHook = (h: Omit<ModeHook, 'stub'> & { stub: DraftObjective }): ModeHook => h as unknown as ModeHook;

// ---- stages and fail rules ----------------------------------------------------------------------------------------------------

export interface StageOpts {
  join?: StageDef['join'];
  onEnter?: Op[];
  onComplete?: Op[];
  timeLimitSec?: number;
  checkpoint?: boolean;
  conduct?: StageDef['conduct'];
  next?: string;
}
export type DraftStage = Omit<StageDef, 'objectives'> & { objectives: DraftObjective[] };
export const stage = (id: string, objectives: DraftObjective[], o: StageOpts = {}): DraftStage => ({
  id,
  join: o.join ?? 'all',
  objectives,
  ...(o.onEnter !== undefined ? { onEnter: o.onEnter } : {}),
  ...(o.onComplete !== undefined ? { onComplete: o.onComplete } : {}),
  ...(o.timeLimitSec !== undefined ? { timeLimitSec: o.timeLimitSec } : {}),
  ...(o.checkpoint !== undefined ? { checkpoint: o.checkpoint } : {}),
  ...(o.conduct !== undefined ? { conduct: o.conduct } : {}),
  ...(o.next !== undefined ? { next: o.next } : {}),
});
export const failWhen = (when: Pred, reason: string, retry: FailRule['retry'] = 'checkpoint'): FailRule => ({ when, reason, retry });

// ---- predicates ---------------------------------------------------------------------------------------------------------------

export const and = (...of: Pred[]): Pred => ({ p: 'and', of });
export const or = (...of: Pred[]): Pred => ({ p: 'or', of });
export const not = (of: Pred): Pred => ({ p: 'not', of });
export const always = (): Pred => ({ p: 'true' });
export const inZone = (who: Who, zone: ZoneName): Pred => ({ p: 'inZone', who, zone });
export const inVehicle = (who: Who, vehicleName?: CastName | 'any'): Pred => ({ p: 'inVehicle', who, ...(vehicleName ? { vehicle: vehicleName } : {}) });
export const near = (a: Who, b: Who, maxM: number): Pred => ({ p: 'near', a, b, maxM });
export const far = (a: Who, b: Who, minM: number): Pred => ({ p: 'far', a, b, minM });
export const health = (who: Who, below: number): Pred => ({ p: 'health', who, below });
export const ko = (who: Who): Pred => ({ p: 'ko', who });
export const destroyed = (cast: CastName): Pred => ({ p: 'destroyed', cast });
export const busted = (): Pred => ({ p: 'busted' });
export const heatIs = (o: { min?: HeatLevel; max?: HeatLevel; phase?: 'clear' | 'pursuit' | 'search' | 'cooldown' }): Pred => ({ p: 'heat', ...o });
export const speed = (who: Who, o: { minMps?: number; maxMps?: number }): Pred => ({ p: 'speed', who, ...o });
export const hour = (from: number, to: number): Pred => ({ p: 'hour', from, to });
export const weatherIs = (...is: WeatherPreset[]): Pred => ({ p: 'weather', is });
export const flagIs = (key: string, o: { eq?: boolean | number | string; gte?: number } = {}): Pred => ({ p: 'flag', key, ...o });
export const trustOf = (npcId: string, o: { gte?: number; lte?: number }): Pred => ({ p: 'trust', npc: npcId, ...o });
export const hasItem = (id: string, gte = 1): Pred => ({ p: 'item', id, gte });
export const hasCash = (gteCents: number): Pred => ({ p: 'cash', gteCents });
export const objectiveIs = (id: string, state: 'active' | 'done' | 'failed'): Pred => ({ p: 'objective', id, state });
export const stageTime = (o: { gteSec?: number; lteSec?: number }): Pred => ({ p: 'stageTime', ...o });
export const eventSeen = (name: string, since: 'stage' | 'mission' = 'stage'): Pred => ({ p: 'event', name, since });
export const modeResult = (hook: string, outcome: string[]): Pred => ({ p: 'modeResult', hook, outcome });
export const passed = (mission: `m.${string}`): Pred => ({ p: 'passed', mission });
export const actAtLeast = (gte: 1 | 2 | 3): Pred => ({ p: 'act', gte });
export const unlocked = (id: UnlockEventId): Pred => ({ p: 'unlocked', id });

// ---- ops ----------------------------------------------------------------------------------------------------------------------

export const seq = (...body: Op[]): Op => ({ op: 'seq', body });
export const all = (...branches: Op[][]): Op => ({ op: 'all', branches });
export const race = (...branches: Op[][]): Op => ({ op: 'race', branches });
export const ifOp = (cond: Pred, then: Op[], otherwise?: Op[]): Op => ({ op: 'if', cond, then, ...(otherwise ? { else: otherwise } : {}) });
export const loop = (max: number, body: Op[], until?: Pred): Op => ({ op: 'loop', max, body, ...(until ? { until } : {}) });
export const wait = (sec: number): Op => ({ op: 'wait', sec });
export const waitUntil = (cond: Pred, o: { timeoutSec?: number; onTimeout?: Op[] } = {}): Op => ({ op: 'waitUntil', cond, ...o });
export const waitEvent = (event: string, timeoutSec?: number): Op => ({ op: 'waitEvent', event, ...(timeoutSec !== undefined ? { timeoutSec } : {}) });
export const spawn = (...cast: CastName[]): Op => ({ op: 'spawn', cast });
export const despawn = (...cast: CastName[]): Op => ({ op: 'despawn', cast });
export const task = (cast: CastName, t: NpcTask): Op => ({ op: 'task', cast, task: t });
export const say = (speaker: CastName | 'player' | 'radio', line: LineId, wait?: boolean): Op => ({ op: 'say', speaker, line, ...(wait !== undefined ? { wait } : {}) });
export const text = (from: string, line: LineId): Op => ({ op: 'text', from, line });
export const marker = (target: CastName | ZoneName, kind: 'objective' | 'destination' | 'target' | 'avoid', on = true): Op => ({ op: 'marker', target, kind, on });
export const beat = (ref: BeatRef): Op => ({ op: 'beat', ref });
export const camera = (shot: string, o: { subject?: Who; sec?: number } = {}): Op => ({ op: 'camera', shot, ...o });
export const fade = (to: 0 | 1, sec: number): Op => ({ op: 'fade', to, sec });
export const heat = (o: { set?: HeatLevel; cap?: HeatLevel; clear?: true; unit?: CastName }): Op => ({ op: 'heat', ...o });
export const clock = (o: { lock?: { hour?: number; weather?: WeatherPreset }; unlock?: true }): Op => ({ op: 'clock', ...o });
export const ambient = (o: { traffic?: number; peds?: number }): Op => ({ op: 'ambient', ...o });
export const setFlag = (set: Record<string, boolean | number | string>): Op => ({ op: 'flag', set });
export const trust = (npcName: CastName, delta: number): Op => ({ op: 'trust', npc: npcName, delta });
export const give = (idem: string, o: { cashCents?: number; items?: { id: string; qty: number }[] }): Op => ({ op: 'give', idem, ...o });
export const emit = (event: string): Op => ({ op: 'emit', event });
export const pass = (): Op => ({ op: 'pass' });
export const fail = (reason: string): Op => ({ op: 'fail', reason });

// ---- npc tasks ----------------------------------------------------------------------------------------------------------------

export const walkTo = (zone: ZoneName, mode: 'walk' | 'run' | 'drive' = 'walk'): NpcTask => ({ t: 'goto', zone, mode });
export const driveTo = (zone: ZoneName, style: 'normal' | 'fast' | 'flee' = 'normal'): NpcTask => ({ t: 'driveTo', zone, style });
export const followTask = (who: Who, distM: number): NpcTask => ({ t: 'follow', who, distM });
export const enterVehicleTask = (vehicleName: CastName, seatIndex = 0): NpcTask => ({ t: 'enterVehicle', vehicle: vehicleName, seat: seatIndex });
export const leaveVehicleTask = (): NpcTask => ({ t: 'leaveVehicle' });
export const animTask = (clip: string, loopIt?: boolean): NpcTask => ({ t: 'anim', clip, ...(loopIt !== undefined ? { loop: loopIt } : {}) });
export const lookTask = (who: Who): NpcTask => ({ t: 'look', who });
export const idleTask = (): NpcTask => ({ t: 'idle' });
export const fleeTask = (from: Who): NpcTask => ({ t: 'flee', from });

export type { DraftStage as StageDraft };
export type MissionInput = Omit<MissionIR, 'schema' | 'worldBake' | 'premise' | 'tags' | 'requires' | 'fail' | 'heatPolicy' | 'rewards' | 'lines' | 'stages' | 'giver' | 'start' | 'act' | 'district' | 'title' | 'autoplay'> & {
  title?: string;
  act?: MissionIR['act'];
  district: MissionIR['district'];
  premise?: MissionIR['premise'];
  tags?: string[];
  giver?: MissionIR['giver'];
  start?: Trigger;
  requires?: Pred[];
  stages: DraftStage[];
  fail?: FailRule[];
  heatPolicy?: MissionIR['heatPolicy'];
  rewards?: Rewards;
  lines?: LineId[];
  autoplay?: MissionIR['autoplay'];
  worldBake?: string;
};
