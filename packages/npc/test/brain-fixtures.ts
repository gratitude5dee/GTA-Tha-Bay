/**
 * Shared fixtures of the M06c brain specs: a synthetic cast of named NPCs with schedules over a small grid of invented places, a player
 * who walks a fixed path, and a runner that drives `BrainSim` for a number of ticks the way the AI stage does.
 */
import { Fnv64 } from '@dv/shared';
import type { Activity, CompiledSoulPublic, ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import type { Vec3 } from '@dv/shared/npc';
import type { BrainEnv, BrainWorld, TraceRecord } from '../src/brains/agent.ts';
import { BrainSim } from '../src/brains/sim.ts';

export const SEED = 0xc0ffee;
/** One half-second of game clock per sim tick (30 game seconds per real second at 60 Hz). */
export const CLOCK_PER_TICK = 1;
export const HOUR = 7200;

export const homeOf = (i: number): string => `poi.test.home-${String(i).padStart(2, '0')}`;
export const workOf = (i: number): string => `poi.test.work-${String(i).padStart(2, '0')}`;
export const parkOf = (i: number): string => `poi.test.park-${String(i % 3)}`;

/** Invented places: homes on a row at z = 10, workplaces on a row at z = 70, three parks far to the east. */
export function placeAt(id: string): Vec3 | null {
  const m = /^poi\.test\.(home|work|park)-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === 'home') return [n * 14, 0, 10];
  if (m[1] === 'work') return [n * 14, 0, 70];
  return [300 + n * 40, 0, 40];
}

export const world: BrainWorld = { poiPos: (id) => placeAt(id) };

const block = (from: string, to: string, activity: Activity, place: string, priority: number, interruptible = true): ScheduleBlock =>
  ({ days: 'daily', from, to, activity, place: place as ScheduleBlock['place'], interruptible, priority });

/** Sleep 22:00 to 06:00 at home, commute to work 06:00 to 07:00, work to 18:00, socialize at a park to 22:00. */
export function scheduleOf(i: number): ScheduleBlock[] {
  return [
    block('22:00', '06:00', 'sleep', homeOf(i), 9, false),
    block('06:00', '07:00', 'commute', workOf(i), 4),
    block('07:00', '18:00', i % 4 === 3 ? 'patrol' : 'work', workOf(i), 5),
    block('18:00', '19:00', 'commute', parkOf(i), 3),
    block('19:00', '22:00', 'socialize', parkOf(i), 3),
  ];
}

export function makeSoul(id: string, schedule: ScheduleBlock[], hero = false): CompiledSoulPublic {
  return {
    schema: 'soul-public/1', id, soulVersion: 1, status: 'active', origin: 'first_party', name: id, shortBio: 'test', archetype: 'civilian', tags: [],
    tier: 'fictionalized', basis: 'original', disclaimer: 'none', fameDomain: [], marketingAllowed: false, ugcCameo: false, standIn: null, heightM: 1.7,
    moves: [], roles: { hero, questGiver: false, vendor: false, fighter: false, tycoonActor: false, racer: false },
    locations: { districts: [], home: homeOf(0) as ScheduleBlock['place'], hangouts: [] }, schedule, goals: ['idle', 'socialize'],
    voice: { tier: 'text', voiceRef: null, speed: 1 }, dialogue: { modelTier: 'haiku', maxTurnsPerEncounter: 12 }, stats: {},
    assets: { model: `character/${id}`, rig: 'rig/bay_rig_v1', anim: [], portrait: null, mouthAtlas: null, voice: null, ink: `data/ink.${id}`, barks: null },
  } as unknown as CompiledSoulPublic;
}

export function cast(n = 12): CompiledSoulPublic[] {
  return Array.from({ length: n }, (_, i) => makeSoul(`npc_${String(i).padStart(2, '0')}`, scheduleOf(i), i === 0));
}

/** The player's place at a tick: a slow walk along the row of homes. */
export const playerAt = (tick: number): { x: number; y: number; z: number } => ({ x: 20 + tick * 0.02, y: 0, z: 40 });

export interface RunResult {
  sim: BrainSim;
  traceHash: string;
  stateHash: string;
  trace: TraceRecord[];
}

export interface RunOptions {
  seed?: number;
  cap?: number;
  startT: number;
  ticks: number;
  /** Called at the start of every tick, before the sim sees it (queue intents, move the player). */
  before?: (sim: BrainSim, tick: number) => void;
  player?: (tick: number) => { x: number; y: number; z: number } | null;
  keepTrace?: boolean;
}

export function run(souls: CompiledSoulPublic[], o: RunOptions): RunResult {
  const h = new Fnv64();
  const trace: TraceRecord[] = [];
  const sim = new BrainSim({
    seed: o.seed ?? SEED,
    world,
    cap: o.cap ?? 8,
    trace: (r) => {
      h.u32(r.tick).u32(r.slot).u8(r.lod).u32(r.block >>> 0).u8(r.winner).u8(r.leaf);
      if (o.keepTrace) trace.push({ ...r });
    },
  });
  for (const s of souls) sim.add(s);
  const env: BrainEnv = { tick: 0, clockT: o.startT, player: null, trust: () => 0 };
  const player = o.player ?? playerAt;
  for (let t = 0; t < o.ticks; t++) {
    env.tick = t;
    env.clockT = o.startT + t * CLOCK_PER_TICK;
    env.player = player(t);
    o.before?.(sim, t);
    sim.tick(env);
  }
  return { sim, traceHash: h.hex(), stateHash: sim.stateHash(), trace };
}
