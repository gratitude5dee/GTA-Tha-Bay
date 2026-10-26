/**
 * The NPC agency sim module (M06c): the named-NPC brains, the bark system, the Talk handler and `ModeContext.npc` in `sim.worker`.
 *
 * It follows the module pattern of the world and the racing modes (DL-651): the engine never imports this package. The module is inert
 * unless the boot payload carries a world with an index, so a gray-box session hashes as before. Once active it
 *  - adds components 768 to 775, one entity `npc:<id>` per roster soul and one system in `SimStage.AI` (order 120, after the pedestrians);
 *  - registers an `NpcHostPort` on `services.npc`, which the modes module binds when the session starts (the bridge, the event bus, the
 *    timeline, the interaction service) and from which it builds `ModeContext.npc`;
 *  - takes the page's `mode.cmd` commands of the reserved owner `npc`: `flags`, `intent`, `talk.end`, `bark`, `mission`, `lock`.
 * Sim code; C02 lint applies.
 */
import { dsqrt, fnv32, SimStage, type Fnv64, type JsonObject, type KillScope, type ModeContext, type SystemDef } from '@dv/shared';
import type { Archetype, BarkTag, CompiledSoulPublic, InkKnot, NearbyEvent, NpcIntent } from '@dv/shared/contracts/c10-npc';
import { validateNpcIntent } from '@dv/shared/npc';
import { Transform, type ByteReader, type ByteWriter, type NpcHostEnv, type NpcHostPort, type SimModule, type SimModuleContext, type SimResource } from '@dv/engine/sim';
import { BarkSystem, type BarkEmit, type BarkRequest } from '../barks/bark-system.ts';
import { FILLER_SPEAKER, fillerArchetype, builtinPools, type BarkPools } from '../barks/pools.ts';
import { SubtitleLane } from '../barks/subtitle-lane.ts';
import { InkRunner } from '../ink/ink-runner.ts';
import { LOD, UTILITY, type BrainEnv, type BrainWorld } from './agent.ts';
import { BRAIN_CONFIG, lodCap } from './config.ts';
import { NPC_COMPONENTS } from './components.ts';
import { IntentRequests } from './intent-requests.ts';
import { createModeNpcApi, KnotPlayer, type KnotLine, type KnotSource } from './mode-context-npc.ts';
import { BrainSim } from './sim.ts';
import { H, NpcEntities, type PedBark } from './system.ts';
import { TalkHandler, type TalkTarget } from './talk-handler.ts';

export const NPC_MODULE_ID = 'npc.agency';
export const NPC_SYSTEM_ID = 'npc.agency.brains';
export const NPC_RESOURCE_ID = 'npc.agency';

export interface NpcModuleOptions {
  /** The public souls of the roster (`data/npc-roster`). */
  roster: readonly CompiledSoulPublic[];
  /** Compiled ink JSON by owner: an NPC id or `archetype:<a>`. */
  ink: Readonly<Record<string, string>>;
  /** ENU `[x, z]` of POIs the baked table lacks (`content/npcs/poi.stub.json` `positions`). */
  stubPois?: Readonly<Record<string, readonly [number, number]>>;
  pools?: BarkPools;
  /**
   * A millisecond clock for the cost readings of the perf scenario (`performance.now`, passed by the worker entry; sim code has no clock).
   * Absent: the readings stay 0.
   */
  clock?: () => number;
}

export interface NpcModule extends SimModule, NpcHostPort {
  /** The live parts (tests and the QA panel); null until the module is active. */
  parts(): NpcParts | null;
}

export interface NpcParts {
  sim: BrainSim;
  barks: BarkSystem;
  knots: KnotPlayer;
  lane: SubtitleLane;
  talk: TalkHandler;
  intents: IntentRequests;
  entities: NpcEntities;
}

const BARK_TAGS: readonly BarkTag[] = [
  'bump', 'greet_pass', 'idle', 'busy', 'flee', 'car_crash_nearby', 'heat_low', 'heat_high', 'rain', 'fog', 'night', 'compliment_car',
  'player_wins_race', 'player_loses_race', 'sideshow', 'goodbye',
];
const NEARBY_EVENTS: readonly NearbyEvent[] = [
  'car_crash', 'melee_fight', 'police_chase', 'race_finished', 'player_won_race', 'player_lost_race', 'sideshow', 'rain_started',
  'fog_rolling_in', 'night_fell', 'mission_started', 'mission_failed', 'mission_passed',
];
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isTag = (s: unknown): s is BarkTag => typeof s === 'string' && (BARK_TAGS as readonly string[]).includes(s);
const GOALS_ALWAYS = ['continue_schedule', 'approach_player', 'avoid_player', 'go_to'];

/** A crash that cost the vehicle at least this much speed (m/s) frightens people around it. */
const CRASH_MIN_MPS = 4;
/** How far from the crash a pedestrian or a named NPC reacts. */
const CRASH_RADIUS_M = 40;
/** Ambient-condition barks are tried every this many ticks. */
const AMBIENT_BARK_EVERY = 300;

export function createNpcModule(opts: NpcModuleOptions): NpcModule {
  let ctx: SimModuleContext | null = null;
  let host: NpcHostEnv | null = null;
  let parts: NpcParts | null = null;
  const killed = new Map<string, KillScope[]>();
  const runners = new Map<string, InkRunner>();
  const pools = opts.pools ?? builtinPools();
  const stub = opts.stubPois ?? {};
  const lastWinner: number[] = [];
  const scratchBarks: PedBark[] = [];
  let env: BrainEnv = { tick: 0, clockT: 0, player: null, trust: () => 0 };
  let lastDebug = -1000;
  // QA: the standing filler a spec talks to, and when its knock-down ends
  let qaFiller: { key: string; handle: number; bumpUntil: number } | null = null;
  let qaSerial = 0;
  // perf scenario readings (M06c AC-9): brain steps per window, brain cost per sim tick, and the whole system's
  const perf = { ticks: 0, brainMsSum: 0, brainMsMax: 0, sysMsSum: 0, sysMsMax: 0, aMax: 0, bMax: 0, cMax: 0 };
  let cmdCount = 0;
  let lastCmd = '';
  let bound = false;

  const speakerOf = (owner: string, tags: readonly string[]): string => {
    if (tags.includes('who:player')) return 'player';
    if (owner.startsWith('archetype:')) return FILLER_SPEAKER[owner.slice(10)] ?? 'passerby';
    return owner;
  };
  const source: KnotSource = {
    lines(owner, knot): KnotLine[] | null {
      const r = runners.get(owner);
      if (!r) return null;
      return r.play(knot as InkKnot).map((l) => ({ text: l.text, speaker: speakerOf(owner, l.tags) }));
    },
  };

  const clockT = (): number => host?.clockT() ?? ctx?.sim.services.clock?.now().t ?? ctx?.sim.core.tick ?? 0;

  function world(): BrainWorld {
    const svc = ctx?.sim.services;
    return {
      poiPos: (id) => {
        const p = svc?.world.api?.places.poiPos(id) ?? null;
        if (p) return p;
        const s = stub[id];
        return s ? [s[0], 0, s[1]] : null;
      },
      pedRoute: (a, b) => svc?.world.api?.places.pedRoute(a, b) ?? [],
      groundY: (x, z) => svc?.world.api?.query.groundY(x, z) ?? null,
    };
  }

  // -------------------------------------------------------------------------------------------------------------- barks

  function emitBark(e: BarkEmit): void {
    parts?.lane.show(e.speaker, e.text, e.tick, e.endTick);
    // The audio service plays `audio` when the pool has one (M10c); the page also logs the line in QA.
    ctx?.sim.services.events.push({
      t: 'npc.bark', tick: e.tick, s: JSON.stringify({ key: e.key, tag: e.tag, line: e.lineId, audio: e.audio, speaker: e.speaker, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10 }),
    });
    const a = e.key.startsWith('npc:') ? parts?.sim.get(e.key.slice(4)) : undefined;
    if (a) parts?.entities.markBark(a.slot, e.tick, BARK_TAGS.indexOf(e.tag));
  }

  function barkFor(tick: number, b: PedBark): void {
    if (!parts) return;
    const arch: Archetype = fillerArchetype(fnv32(b.key));
    const req: BarkRequest = { tag: b.tag, key: b.key, owner: `archetype:${arch}`, speaker: FILLER_SPEAKER[arch] ?? 'passerby', x: b.x, z: b.z };
    parts.barks.request(tick, req, env.player);
  }

  function barkNamed(tick: number, npcId: string, tag: BarkTag): void {
    const a = parts?.sim.get(npcId);
    if (!parts || !a || !a.enabled || a.lod === LOD.C) return;
    const pool = pools.forNpc(a.id, a.soul.archetype);
    if (!pool) return;
    parts.barks.request(tick, { tag, key: a.key, owner: pool.owner, speaker: a.id, x: a.x, z: a.z }, env.player);
  }

  function ambientBark(tick: number): void {
    if (!parts || !ctx || !env.player) return;
    const svc = ctx.sim.services;
    const tags: BarkTag[] = [];
    const heat = svc.world.heat?.() ?? 0;
    if (heat >= 3) tags.push('heat_high');
    else if (heat >= 1) tags.push('heat_low');
    const e = svc.clock?.env();
    if (e) {
      if (e.weather === 'rain') tags.push('rain');
      if (e.weather === 'karl-fog') tags.push('fog');
      if (e.hour >= 21 || e.hour < 5) tags.push('night');
    }
    if (tags.length === 0) return;
    const rng = svc.rng.get('npc:barks');
    if (rng.nextFloat() > 0.5) return;
    const tag = tags[Math.min(tags.length - 1, Math.floor(rng.nextFloat() * tags.length))] as BarkTag;
    const ped = parts.entities.nearestPed(env.player, BRAIN_CONFIG.barks.radiusM - 5);
    if (ped) barkFor(tick, { ...ped, tag });
  }

  function reportCrash(tick: number, x: number, z: number): void {
    if (!parts) return;
    for (const a of parts.sim.agents) {
      if (!a.enabled || a.lod === LOD.C) continue;
      const dx = a.x - x;
      const dz = a.z - z;
      if (dsqrt(dx * dx + dz * dz) <= CRASH_RADIUS_M) parts.sim.report(a.id, 'car_crash', x, z, tick);
    }
    parts.intents.worldEvent(parts.sim, { ...env, tick }, 'car_crash', x, z);
    const ped = parts.entities.nearestPed({ x, z }, CRASH_RADIUS_M);
    if (ped) barkFor(tick, { ...ped, tag: 'car_crash_nearby' });
  }

  // -------------------------------------------------------------------------------------------------------------- step

  function step(tick: number): void {
    const p = parts;
    const c = ctx;
    if (!p || !c) return;
    const clock = opts.clock;
    const t0 = clock ? clock() : 0;
    env = { tick, clockT: clockT(), player: p.entities.player(), trust: (id) => host?.trust(id) ?? 0 };
    p.sim.tick(env);
    const t1 = clock ? clock() : 0;
    p.entities.ensure(p.sim);
    p.entities.sync(p.sim, (a) => {
      const pl = env.player;
      return pl ? dsqrt((a.x - pl.x) * (a.x - pl.x) + (a.z - pl.z) * (a.z - pl.z)) : -1;
    });

    for (const e of p.sim.takeEvents()) {
      if (e.kind === 'block') p.intents.blockBoundary(p.sim, env, e.npcId);
      else if (e.kind === 'talk.end') p.intents.encounterEnded(p.sim, env, e.npcId);
      else if (e.kind === 'bark' && isTag(e.tag)) barkNamed(tick, e.npcId, e.tag);
    }
    // a named NPC that just greeted or fled says so
    for (const a of p.sim.agents) {
      const prev = lastWinner[a.slot];
      lastWinner[a.slot] = a.winner;
      if (prev === undefined || prev === a.winner) continue;
      if (a.winner === UTILITY.Greet) barkNamed(tick, a.id, 'greet_pass');
      else if (a.winner === UTILITY.Flee) barkNamed(tick, a.id, 'flee');
    }

    if (env.player && tick % 6 === 0) {
      scratchBarks.length = 0;
      p.entities.scanFillers(env.player, { talkM: BRAIN_CONFIG.barks.fillerTalkRadiusM, watchM: BRAIN_CONFIG.barks.radiusM }, scratchBarks);
      for (const b of scratchBarks) barkFor(tick, b);
    }
    if (tick % AMBIENT_BARK_EVERY === AMBIENT_BARK_EVERY / 2) ambientBark(tick);

    if ((tick & 1) === 0) p.intents.scan(p.sim, env);
    const req = p.intents.next();
    if (req) host?.ui.patch('sys.npc.intents', req as unknown as JsonObject);

    if (qaFiller && qaFiller.bumpUntil > 0 && tick >= qaFiller.bumpUntil) {
      p.entities.setAnim(qaFiller.handle, 0);
      qaFiller.bumpUntil = 0;
    }

    p.barks.update(tick);
    p.knots.update(tick);
    p.lane.update(tick);

    if (clock) {
      const t2 = clock();
      const brain = t1 - t0;
      const sys = t2 - t0;
      perf.ticks++;
      perf.brainMsSum += brain;
      perf.sysMsSum += sys;
      if (brain > perf.brainMsMax) perf.brainMsMax = brain;
      if (sys > perf.sysMsMax) perf.sysMsMax = sys;
    }
    if (p.sim.counts.a > perf.aMax) perf.aMax = p.sim.counts.a;
    if (p.sim.counts.b > perf.bMax) perf.bMax = p.sim.counts.b;
    if (p.sim.counts.c > perf.cMax) perf.cMax = p.sim.counts.c;

    if (c.runtime.env.qa && tick - lastDebug >= 30) {
      lastDebug = tick;
      host?.ui.patch('sys.npc.debug', debugView(p));
    }
  }

  function debugView(p: NpcParts): JsonObject {
    return {
      a: p.sim.counts.a, b: p.sim.counts.b, c: p.sim.counts.c, peakA: p.sim.peakA, cap: p.sim.cap,
      steps: { a: p.sim.totalSteps.a, b: p.sim.totalSteps.b }, barks: { played: p.barks.played, dropped: p.barks.dropped, audible: p.barks.audible() },
      talks: p.talk.begun, knots: p.knots.done, intents: p.intents.written,
      cmds: cmdCount, lastCmd, bound, filler: qaFiller ? qaFiller.handle : 0, fillerSeen: qaFiller ? p.entities.seenAnim(qaFiller.handle) : -1, grants: p.entities.grants,
      perf: {
        ticks: perf.ticks, aMax: perf.aMax, bMax: perf.bMax, cMax: perf.cMax,
        brainMsMean: perf.ticks > 0 ? perf.brainMsSum / perf.ticks : 0, brainMsMax: perf.brainMsMax,
        sysMsMean: perf.ticks > 0 ? perf.sysMsSum / perf.ticks : 0, sysMsMax: perf.sysMsMax,
      },
      npcs: p.sim.agents.slice(0, 12).map((a) => ({
        id: a.id, lod: 'ABC'[a.lod] as string, block: a.block, who: ['talk', 'hold', 'flee', 'intent', 'greet', 'schedule'][a.winner] as string,
        x: Math.round(a.x), z: Math.round(a.z),
      })),
    };
  }

  const system: SystemDef = { id: NPC_SYSTEM_ID, owner: 'S04', stage: SimStage.AI, order: 120, run: (c) => step(c.tick) };

  const resource: SimResource = {
    name: NPC_RESOURCE_ID,
    hash(h: Fnv64) {
      if (!parts) return;
      parts.sim.hash(h);
      parts.barks.hash(h);
      parts.knots.hash(h);
      parts.talk.hash(h);
      parts.intents.hash(h);
    },
    save(w: ByteWriter) {
      if (!parts) return;
      parts.sim.save(w);
      parts.barks.save(w);
      parts.knots.save(w);
      parts.talk.save(w);
      parts.intents.save(w);
    },
    load(r: ByteReader) {
      if (!parts) return;
      parts.sim.load(r);
      parts.barks.load(r);
      parts.knots.load(r);
      parts.talk.load(r);
      parts.intents.load(r);
    },
  };

  // -------------------------------------------------------------------------------------------------------------- commands

  function applyFlags(args: JsonObject): void {
    killed.clear();
    const k = args['killed'];
    if (typeof k === 'object' && k !== null && !Array.isArray(k)) {
      for (const id of Object.keys(k).sort(byStr)) {
        const e = (k as Record<string, unknown>)[id];
        const scope = typeof e === 'object' && e !== null ? (e as { scope?: unknown }).scope : undefined;
        if (Array.isArray(scope)) killed.set(id, scope.filter((s): s is KillScope => typeof s === 'string') as KillScope[]);
      }
    }
    for (const a of parts?.sim.agents ?? []) {
      const sc = killed.get(a.id) ?? [];
      parts?.sim.setEnabled(a.id, !(sc.includes('all') || sc.includes('spawn')));
    }
  }

  function applyIntent(args: JsonObject): void {
    if (!parts) return;
    const npcId = args['npcId'];
    const raw = args['intent'];
    if (typeof npcId !== 'string' || typeof raw !== 'object' || raw === null) return;
    const a = parts.sim.get(npcId);
    if (!a || !a.enabled || !a.soul.roles.hero) return;
    if (validateNpcIntent(raw).length > 0) return;
    const intent = raw as unknown as NpcIntent;
    const allowed = [...a.soul.goals, ...GOALS_ALWAYS];
    if (!allowed.includes(intent.goal)) return;
    if (intent.bark !== null && !isTag(intent.bark)) return;
    // A recorded external input: replays read it back instead of asking again (C06 `TimelineRecorder.external`).
    const tick = (host?.tick() ?? env.tick) + 1;
    host?.timeline.external({ src: 'intent', tick, data: { npcId, intent: intent as unknown as JsonObject } });
    parts.sim.queueIntent(tick, npcId, intent);
  }

  function command(name: string, args: JsonObject | null): void {
    if (!parts) return;
    cmdCount++;
    lastCmd = name;
    const a = args ?? {};
    switch (name) {
      case 'flags':
        applyFlags(a);
        return;
      case 'intent':
        applyIntent(a);
        return;
      case 'talk.end': {
        const id = a['npcId'];
        if (typeof id === 'string') parts.sim.endTalk(id, env.tick);
        return;
      }
      case 'lock': {
        const id = a['npcId'];
        if (typeof id === 'string') parts.sim.lock(id, a['on'] !== false);
        return;
      }
      case 'mission':
        parts.intents.missionState(parts.sim, env);
        return;
      case 'bark': {
        const tag = a['tag'];
        if (!isTag(tag)) return;
        const id = a['npcId'];
        if (typeof id === 'string') {
          barkNamed(env.tick, id, tag);
          return;
        }
        if (env.player) {
          const ped = parts.entities.nearestPed(env.player, BRAIN_CONFIG.barks.radiusM - 5);
          if (ped) barkFor(env.tick, { ...ped, tag });
        }
        return;
      }
      case 'perf.reset': {
        // QA builds only: starts a new measurement window for the perf scenario (`npc-mission-crowd`)
        if (!ctx?.runtime.env.qa) return;
        perf.ticks = 0; perf.brainMsSum = 0; perf.brainMsMax = 0; perf.sysMsSum = 0; perf.sysMsMax = 0;
        perf.aMax = parts.sim.counts.a; perf.bMax = parts.sim.counts.b; perf.cMax = parts.sim.counts.c;
        lastDebug = -1000;
        return;
      }
      case 'qa.filler': {
        // QA builds only: a pedestrian that stands still `ahead` metres in front of the player, whose key and anim a spec controls
        if (!ctx?.runtime.env.qa) return;
        const ahead = typeof a['ahead'] === 'number' ? Math.min(6, Math.max(0.8, a['ahead'])) : 1.6;
        const made = parts.entities.spawnQaFiller(300 + (qaSerial++ % 100), ahead);
        if (made) qaFiller = { key: made.key, handle: made.handle, bumpUntil: 0 };
        return;
      }
      case 'qa.bump': {
        // QA builds only: the standing filler is knocked down for two seconds (the pedestrian layer's ragdoll anim), which the bark watcher hears
        // A bump while the pedestrian is still down is ignored (it would only push the recovery later, and the watcher sees no new knock-down).
        if (!ctx?.runtime.env.qa || !qaFiller || qaFiller.bumpUntil > 0) return;
        parts.entities.setAnim(qaFiller.handle, 12);
        qaFiller.bumpUntil = env.tick + 120;
        return;
      }
      case 'event': {
        const kind = a['kind'];
        if (typeof kind === 'string' && (NEARBY_EVENTS as readonly string[]).includes(kind) && env.player) {
          parts.intents.worldEvent(parts.sim, env, kind as NearbyEvent, env.player.x, env.player.z);
        }
        return;
      }
      default:
    }
  }

  // -------------------------------------------------------------------------------------------------------------- module

  const mod: NpcModule = {
    id: NPC_MODULE_ID,
    systems: [system],
    resources: [],
    parts: () => parts,

    components(boot) {
      const w = boot.config['world'];
      const on = typeof w === 'object' && w !== null && (w as { index?: unknown }).index !== undefined && boot.config['npc'] !== false;
      return on ? NPC_COMPONENTS : [];
    },

    async onInit(c: SimModuleContext): Promise<void> {
      ctx = c;
      parts = null;
      c.sim.services.npc.port = null;
      const w = c.boot.config['world'];
      if (typeof w !== 'object' || w === null || (w as { index?: unknown }).index === undefined || c.boot.config['npc'] === false) return;

      runners.clear();
      for (const owner of Object.keys(opts.ink).sort(byStr)) runners.set(owner, await InkRunner.create(opts.ink[owner] as string));

      const cfg = BRAIN_CONFIG;
      const sim = new BrainSim({ seed: c.cfg.seed, world: world(), cap: lodCap(c.cfg.tier), cfg });
      for (const soul of opts.roster) if (soul.status === 'active') sim.add(soul);
      // QA `?npcCast=<n>` (the perf scenario `npc-mission-crowd`): extra NPCs cloned from the roster, with the same schedules and places, so a hub
      // holds n named NPCs. They are never heroes, so they ask for no intents.
      const cast = c.boot.config['npcCast'];
      const base = opts.roster.filter((r) => r.status === 'active');
      if (c.runtime.env.qa && typeof cast === 'number' && cast > sim.agents.length && base.length > 0) {
        for (let i = sim.agents.length; i < Math.min(64, cast); i++) {
          const t = base[i % base.length] as CompiledSoulPublic;
          sim.add({ ...t, id: `crowd_${String(i).padStart(2, '0')}`, name: `Crowd ${i}`, roles: { ...t.roles, hero: false } });
        }
      }
      const rng = c.sim.services.rng.get('npc:barks');
      const barks = new BarkSystem({ pools, rng, cfg: cfg.barks, emit: emitBark });
      const lane = new SubtitleLane({
        patch: (k, v) => host?.ui.patch(k, v),
        peek: (k) => host?.ui.peek?.(k) as never,
      });
      const knots = new KnotPlayer({
        source,
        lane,
        cfg: cfg.barks,
        events: { emit: (e) => host?.events.emit(e) },
        lock: (id, on) => sim.lock(id, on),
      });
      const entities = new NpcEntities(c.sim.ecs);
      entities.definePrefab();
      const talk = new TalkHandler({
        sim,
        knots,
        cfg: cfg.barks,
        clockT,
        killed: (id) => killed.get(id) ?? [],
        patch: (k, v) => host?.ui.patch(k, v),
        classify: (ictx, target): TalkTarget | null => {
          const key = ictx.ecs.keyOf(target);
          if (!key) return null;
          if (key.startsWith('npc:')) return { kind: 'named', npcId: key.slice(4) };
          if (key.startsWith('amb:')) return { kind: 'filler', key, busy: entities.fillerBusy(target) };
          return null;
        },
      });
      const intents = new IntentRequests(cfg, !cfg.intent.offTiers.includes(c.cfg.tier));
      parts = { sim, barks, knots, lane, talk, intents, entities };
      lastWinner.length = 0;
      c.sim.core.addResource(resource);

      // Crashes frighten the people nearby: observe the engine's impact event without consuming it.
      const log = c.sim.services.events;
      const push = log.push.bind(log);
      log.push = (e): void => {
        push(e);
        if (e.t === 'vehicle.impact' && (e.n ?? 0) >= CRASH_MIN_MPS && e.a !== undefined) {
          const id = c.sim.ecs.resolve(H(e.a));
          if (id !== null) {
            const tr = c.sim.ecs.store(Transform);
            reportCrash(e.tick, tr.px[id] as number, tr.pz[id] as number);
          }
        }
      };
      c.sim.services.npc.port = mod;
    },

    bind(e: NpcHostEnv): void {
      host = e;
      bound = e.interaction !== null;
      if (parts) e.interaction?.register(parts.talk);
    },

    api(): ModeContext['npc'] {
      if (!parts) throw new Error('the NPC runtime is not active in this session');
      return createModeNpcApi({ sim: parts.sim, knots: parts.knots, clockT, killed: (id) => killed.get(id) ?? [] });
    },

    command,
  };
  return mod;
}
