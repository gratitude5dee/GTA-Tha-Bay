/**
 * The pursuit sim module (M03c): the engine's contribution to the sim worker through the `SimModule` hook (DL-651). It builds the
 * `PursuitDirector` on the live sim once the world services and the vehicle module exist, runs it in `SimStage.AI` at 30 Hz, and
 * answers the QA commands.
 *
 *  - It is inert until the world registers `services.world.api` and the vehicle module `services.vehicleCtx`; a session without
 *    them runs and hashes as a session without the module.
 *  - The hashed resource `pursuit` is registered the first time the director is touched (`onActivate`), so a session that never meets
 *    the pursuit hashes as before (the M03b1 goldens stay valid).
 *  - Speeding is the one infraction it detects itself (a vehicle well above the road's limit): a unit that sees it reports at once,
 *    otherwise it is posted to the ambient `WitnessBoard` when the world has one (a robotaxi reports it after 2 s).
 *  - Sirens of the chasing units go to the ambient traffic (`sirenSource`) so civilians pull over.
 *
 * Sim code under the C02 lint.
 */
import { SimStage, dcos, dsin, type InfractionKind, type SystemDef } from '@dv/shared';
import type { SimModule, SimModuleContext } from '../runtime.ts';
import type { DebugCommand } from '../transport/envelope.ts';
import { DEFAULT_PURSUIT_CONFIG } from './config.ts';
import { PursuitDirector } from './director.ts';
import { EcsPursuitHost } from './host.ts';
import { MemoryWallet, type WalletPort } from './ports.ts';
import { pursuitWorldFrom } from './world-port.ts';
import type { PursuitQaHandler } from './qa-types.ts';
import type { PursuitConfig } from '@dv/shared';

export const PURSUIT_SYSTEM_ID = 'engine.pursuit.director';
/** Speeding is reported when the vehicle exceeds the road's limit by this factor and by `SPEED_OVER_MPS`. */
const SPEED_FACTOR = 1.35;
const SPEED_OVER_MPS = 4;
/** Posts a speeding infraction at most once per this many ticks. */
const SPEED_EVERY_TICKS = 60;

/** The parts of the ambient traffic the module touches, reached by shape so that the engine never imports `@dv/world`. */
interface AmbientLike {
  board?: { post(kind: InfractionKind, at: { x: number; y: number; z: number }, actor: string, tick: number): number; get(id: number): { x: number; y: number; z: number; kind: InfractionKind } | undefined; onWitness(fn: (e: { kind: InfractionKind; infraction: number }) => void): () => void };
  sirenSource?: (() => readonly { x: number; z: number; hx: number; hz: number }[]) | null;
}

export interface PursuitModuleOptions {
  /** The player's wallet; an empty in-memory wallet until M04a2 binds `EconomyApi`. */
  wallet?: WalletPort;
  /** Replaces `config/pursuit.json`. */
  config?: PursuitConfig;
  /** Resolves `PursuitProfile.configRef`. */
  loadConfig?: (ref: string) => PursuitConfig | null;
}

export interface PursuitModule extends SimModule {
  /** Installs the QA command handler (`qa.ts`); the QA worker entry does it, so a production bundle carries no QA ops. */
  installQa(h: PursuitQaHandler): void;
  /** The director once built, else null. */
  director(): PursuitDirector | null;
  readonly wallet: WalletPort;
}

interface Stats {
  level: number;
  phase: string;
  points: number;
  cooldown: number;
  radius: number;
  units: number;
  seen: boolean;
  fine: number;
  strikes: number;
}

export function createPursuitModule(opts: PursuitModuleOptions = {}): PursuitModule {
  const wallet = opts.wallet ?? new MemoryWallet(0);
  let sim: SimModuleContext['sim'] | null = null;
  let director: PursuitDirector | null = null;
  let host: EcsPursuitHost | null = null;
  let sendQa: ((name: string, data: unknown) => void) | null = null;
  let ambient: AmbientLike | null = null;
  let offBoard: (() => void) | null = null;
  let qaHandler: PursuitQaHandler | null = null;
  let lastSpeedPost = -1e9;
  let tickNow = 0;

  const build = (): boolean => {
    if (director) return true;
    if (!sim) return false;
    const services = sim.services;
    const api = services.world.api;
    const vctx = services.vehicleCtx;
    if (!api || !vctx) return false;
    host = new EcsPursuitHost({
      ecs: sim.ecs, backend: vctx.backend, services, prefabs: vctx.prefabs, store: vctx.store, tick: () => tickNow,
    });
    const world = pursuitWorldFrom({ api, bounds: services.world.bounds, tags: services.world.tags });
    director = new PursuitDirector({
      cfg: opts.config ?? DEFAULT_PURSUIT_CONFIG,
      host,
      world,
      wallet,
      damage: host,
      // streams are created on the first draw: a director nobody touches leaves the RNG resource (and so the state hash) as it was
      rng: { pursuit: { range: (a, b) => services.rng.get('pursuit').range(a, b) }, police: { range: (a, b) => services.rng.get('police').range(a, b) } },
      ...(opts.loadConfig ? { loadConfig: opts.loadConfig } : {}),
    });
    director.onActivate = () => {
      try {
        sim?.core.addResource(director?.resource() as NonNullable<ReturnType<PursuitDirector['resource']>>);
      } catch {
        // already registered (a second activation after a hot reload of the module)
      }
    };
    ambient = ((api as unknown as { ambient?: AmbientLike | null }).ambient ?? null);
    if (ambient?.board) {
      const board = ambient.board;
      offBoard = board.onWitness((e) => {
        const inf = board.get(e.infraction);
        director?.applyNow(e.kind, inf ? [inf.x, inf.y, inf.z] : [0, 0, 0], 1, 'robotaxi');
      });
    }
    if (ambient) {
      ambient.sirenSource = () => {
        const d = director;
        const h = host;
        if (!d || !h || d.heat.level < 1) return [];
        const out: { x: number; z: number; hx: number; hz: number }[] = [];
        for (const u of d.dispatch.units) {
          if (u.role === 'heli' || u.mode === 'disperse') continue;
          const v = h.unit(u.id);
          if (!v?.ready) continue;
          out.push({ x: v.pos[0], z: v.pos[2], hx: -dsin(v.yaw), hz: -dcos(v.yaw) });
        }
        return out;
      };
    }
    return true;
  };

  /** Speeding: the player's vehicle against the limit of the road under it. */
  const watchSpeeding = (tick: number): void => {
    const d = director;
    const h = host;
    const api = sim?.services.world.api;
    if (!d || !h || !api || tick - lastSpeedPost < SPEED_EVERY_TICKS || d.heat.level >= 6) return;
    const p = h.player();
    if (!p || p.onFoot || p.speed < 12) return;
    const road = api.graph.nearestEdge(p.pos[0], p.pos[2], p.pos[1], 12);
    const edge = road ? api.graph.edge(road.edge) : null;
    if (!edge) return;
    if (p.speed <= edge.speedMps * SPEED_FACTOR + SPEED_OVER_MPS) return;
    lastSpeedPost = tick;
    const at: [number, number, number] = [p.pos[0], p.pos[1], p.pos[2]];
    if (d.dispatch.lastSeen && d.heat.level >= 1) d.report('speedingSeen', at, 'police');
    else ambient?.board?.post('speedingSeen', { x: at[0], y: at[1], z: at[2] }, p.vehicleKey ?? '', tick);
  };

  const system: SystemDef = {
    id: PURSUIT_SYSTEM_ID,
    owner: 'S01',
    stage: SimStage.AI,
    order: 50,
    rateDivisor: 2,
    run: (ctx) => {
      tickNow = ctx.tick;
      if (!build()) return;
      (director as PursuitDirector).step(ctx.tick);
      watchSpeeding(ctx.tick);
    },
  };

  const stats = (): Stats | null => {
    const d = director;
    if (!d) return null;
    const s = d.state();
    return { level: s.level, phase: s.phase, points: Math.round(s.points), cooldown: Math.round(s.cooldown * 1000) / 1000, radius: Math.round(s.searchRadiusM), units: s.units.length, seen: d.dispatch.lastSeen, fine: s.phase === 'busted' ? d.lastFine : 0, strikes: s.phase === 'busted' ? d.lastStrikes : 0 };
  };

  const mod: PursuitModule = {
    id: 'engine.pursuit',
    systems: [system],
    wallet,
    director: () => director,
    onInit(ctx) {
      sim = ctx.sim;
      sendQa = (name, data) => void ctx.runtime.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } });
      // a session without the world or the vehicle module may get them later (the world module builds its services in its onInit)
      build();
    },
    side() {
      const s = stats();
      // absent means "clear": the page reads no block as level 0
      if (!s || (s.level === 0 && s.phase === 'clear' && s.points === 0)) return {};
      return { pursuit: s };
    },
    onDebug(cmd: DebugCommand) {
      if (cmd.t !== 'debug.pursuit' || !qaHandler || !sendQa) return;
      const ok = build() && director !== null && host !== null;
      qaHandler(ok ? { director: director as PursuitDirector, host: host as EcsPursuitHost, wallet, world: sim?.services.world.api ?? null, tick: tickNow } : null, cmd, sendQa);
    },
    installQa(h) {
      qaHandler = h;
    },
  };
  void offBoard;
  return mod;
}
