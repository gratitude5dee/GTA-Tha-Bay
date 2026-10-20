/**
 * `PursuitDirector` (M03c): the wanted system. It turns witnessed infractions into heat points and levels 0 to 5 (6 only when
 * scripted), runs the search circle and cooldown, applies the bust rule, tracks per-vehicle heat, and drives a `Dispatcher` that puts
 * police units on the road. It implements the C06 `PursuitApi`.
 *
 * The director is pure logic over four ports (`ports.ts`), so the engine suites run it on fakes. `step(tick)` is called once per AI
 * step (30 Hz, `SimStage.AI`, rateDivisor 2) with the sim tick; durations are in ticks (60 Hz): a robotaxi report lands 120 ticks
 * after the event, a bust needs 180 ticks.
 *
 * Randomness: stream `pursuit` (pedestrian report delays) and stream `police` (spawn picks). Sim code under the C02 lint.
 */
import { NULL_HANDLE } from '@dv/shared';
import type {
  EntityHandle, Fnv64, HeatLevel, HeatState, InfractionKind, PursuitApi, PursuitConfig, PursuitProfile, StableKey,
} from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { SimResource } from '../services.ts';
import { BustModel, fineCents } from './bust.ts';
import { hasTactic } from './config.ts';
import { Dispatcher } from './dispatch.ts';
import { HeatModel, ReportQueue, TICKS_PER_SEC, type ReportWitness, type RngLike } from './heat.ts';
import type { PlayerView, PursuitHost, PursuitWorld, Vec3, VehicleDamagePort, WalletPort } from './ports.ts';
import { SearchModel } from './search.ts';
import { VehicleHeat } from './vehicle-heat.ts';

export const PURSUIT_RESOURCE = 'pursuit';
/** The phase `busted` lasts this many ticks before the pursuit resets (3 s), long enough for the HUD to show it. */
export const BUST_HOLD_TICKS = 3 * TICKS_PER_SEC;
/** Evasion points are earned once per this many ticks of being chased (10 s). */
const EVASION_TICKS = 10 * TICKS_PER_SEC;
const PORTAL_OWNER = 'pursuit';

export interface DirectorDeps {
  cfg: PursuitConfig;
  host: PursuitHost;
  world: PursuitWorld;
  wallet: WalletPort;
  damage: VehicleDamagePort;
  rng: { pursuit: RngLike; police: RngLike };
  /** Loads `PursuitProfile.configRef` (a JSON file the page ships); null when unknown. */
  loadConfig?: (ref: string) => PursuitConfig | null;
}

export class PursuitDirector implements PursuitApi {
  readonly heat: HeatModel;
  readonly search: SearchModel;
  readonly bust: BustModel;
  readonly vheat = new VehicleHeat();
  readonly reports = new ReportQueue();
  readonly dispatch: Dispatcher;
  cfg: PursuitConfig;
  profile: PursuitProfile = { kind: 'story', startHeat: 0, maxHeat: 5 };
  /** QA sandbox toggle: no heat is ever earned (the memory-only form of `sandbox.player.neverWanted`); set it with `setNeverWanted`. */
  neverWanted = false;
  /**
   * Called once, the first time anything changes the director's state. The module registers the hashed resource then, so a session
   * that never meets the pursuit hashes exactly as a session without the director (the goldens of M03b1 stay valid).
   */
  onActivate: (() => void) | null = null;
  private activated = false;
  /** Busts so far (the idempotency key of the fine). */
  bustCount = 0;
  /** Escapes so far. */
  escapes = 0;
  /** The fine of the latest bust, cents, and the strikes the car had after it. */
  lastFine = 0;
  lastStrikes = 0;
  private hint: number[] | null = null;
  private bustedAt = -1;
  private evasionTicks = 0;
  private surviveTicks = 0;
  private lastTick = -1;
  private tickNow = 0;
  private seenPulse = -1;
  private despawnRadius = 0;
  private lastLevel: HeatLevel = 0;
  private lastPlayerKey: string | null = null;
  /** Refusals so far, for tests and the QA panel. */
  readonly refusals: string[] = [];

  constructor(private readonly deps: DirectorDeps) {
    this.cfg = deps.cfg;
    this.heat = new HeatModel(deps.cfg);
    this.search = new SearchModel(deps.cfg);
    this.bust = new BustModel(deps.cfg);
    this.dispatch = new Dispatcher(deps.cfg, deps.host, deps.world, deps.rng.police, deps.damage);
  }

  private touch(): void {
    if (this.activated) return;
    this.activated = true;
    this.onActivate?.();
  }

  get isActivated(): boolean {
    return this.activated;
  }

  setNeverWanted(on: boolean): void {
    this.touch();
    this.neverWanted = on;
    if (on && this.heat.level > 0) this.forceClear('neverWanted');
  }

  // ---- PursuitApi ------------------------------------------------------------------------------------------------------------

  state(): Readonly<HeatState> {
    const phase = this.bustedAt >= 0 ? 'busted' : this.search.phase;
    return {
      level: this.heat.level,
      points: this.heat.points,
      phase,
      lastKnown: this.search.lastKnown ? { pos: [...this.search.lastKnown.pos] as [number, number, number], tick: this.search.lastKnown.tick } : null,
      searchRadiusM: this.search.phase === 'search' || this.search.phase === 'cooldown' ? this.search.radius : 0,
      cooldown: this.search.cooldown,
      units: this.dispatch.units.map((u) => u.id),
      sealedPortals: [...this.deps.world.sealedPortals()],
      cap: this.heat.cap,
      scripted: this.heat.scripted,
    };
  }

  report(k: InfractionKind, at: [number, number, number], witness: ReportWitness, count = 1): void {
    if (witness === 'ped' && !this.cfg.witness.pedReports) return;
    this.touch();
    const delay = this.reports.delayTicks(this.cfg, witness, this.deps.rng.pursuit);
    if (delay === 0) this.applyNow(k, at, count, witness);
    else this.reports.push(this.tickNow + delay, k, at, count, witness);
  }

  setHeat(l: HeatLevel, reason: string): void {
    this.touch();
    if (l === 6 && !this.heat.scripted) {
      this.refuse(`setHeat(6) refused without scripted: ${reason}`);
      return;
    }
    this.forceHeat(l);
  }

  capHeat(l: HeatLevel): void {
    this.touch();
    if (!this.heat.scripted) {
      this.refuse('capHeat refused without scripted');
      return;
    }
    this.heat.setCap(l);
  }

  clear(reason: string): void {
    if (!this.heat.scripted) {
      this.refuse(`clear refused without scripted: ${reason}`);
      return;
    }
    this.forceClear(reason);
  }

  setProfile(p: PursuitProfile): void {
    this.touch();
    this.profile = { ...p };
    if (p.configRef && this.deps.loadConfig) {
      const c = this.deps.loadConfig(p.configRef);
      if (c) this.setConfig(c);
    }
    this.heat.cap = Math.min(p.maxHeat, 5) as HeatLevel;
    this.surviveTicks = 0;
    if (p.startHeat > 0) this.forceHeat(p.startHeat);
  }

  setRouteHint(edgeIds: readonly number[] | null): void {
    this.touch();
    this.hint = edgeIds && edgeIds.length > 0 ? [...edgeIds] : null;
  }

  vehicleHeat(vehicleKey: string): number {
    return this.vheat.get(vehicleKey);
  }

  respray(vehicleKey: string): void {
    this.vheat.respray(vehicleKey);
  }

  spawnNamedUnit(prefabId: string, key: StableKey): EntityHandle {
    this.touch();
    const p = this.deps.host.player();
    if (!p) return NULL_HANDLE;
    return this.dispatch.spawnNamed(prefabId, key, p, this.tickNow) as EntityHandle;
  }

  // ---- beyond the API (scripts, the QA bridge, the module) ---------------------------------------------------------------------

  /** A script takes the scripted mode (the finale): it may set heat 6, cap and clear. */
  setScripted(on: boolean): void {
    this.touch();
    this.heat.scripted = on;
    if (!on && this.heat.level === 6) this.heat.level = 5;
  }

  /** Heat set without the scripted check: sandbox, QA and the story's own rules. Level 6 is still refused. */
  forceHeat(l: HeatLevel): void {
    this.touch();
    if (l === 6 && !this.heat.scripted) return;
    if (this.neverWanted && l > 0) return;
    if (l === 0) {
      this.forceClear('setHeat');
      return;
    }
    this.heat.set(l);
    const p = this.deps.host.player();
    if (this.search.phase === 'clear' && p) this.search.start(p.pos, this.tickNow);
    this.noteLevel();
  }

  /** Ends the pursuit now: heat 0, units disperse, portals reopen. */
  forceClear(reason: string): void {
    const was = this.heat.level;
    this.heat.clear();
    this.search.reset();
    this.bust.reset();
    this.reports.clear();
    this.bustedAt = -1;
    this.evasionTicks = 0;
    this.despawnRadius = this.cfg.levels[Math.max(1, was) as HeatLevel].searchRadiusM * 1.25;
    this.dispatch.disperseAll(this.tickNow);
    this.deps.world.releasePortals(PORTAL_OWNER);
    this.noteLevel();
    if (was > 0) this.deps.host.emit({ t: 'pursuit.cleared', tick: this.tickNow, n: was, s: reason });
  }

  /** Replaces the config of every part (the hot reload of QA builds, and `configRef`). */
  setConfig(c: PursuitConfig): void {
    this.cfg = c;
    this.heat.cfg = c;
    this.search.cfg = c;
    this.bust.cfg = c;
    this.dispatch.cfg = c;
  }

  private refuse(msg: string): void {
    this.refusals.push(msg);
    this.deps.host.emit({ t: 'pursuit.refused', tick: this.tickNow, s: msg });
  }

  private noteLevel(): void {
    if (this.heat.level !== this.lastLevel) {
      this.lastLevel = this.heat.level;
      this.deps.host.emit({ t: 'pursuit.level', tick: this.tickNow, n: this.heat.level });
    }
  }

  /** Applies an infraction now: points, vehicle heat, the first sighting. */
  applyNow(k: InfractionKind, at: Vec3, count: number, witness: ReportWitness): void {
    this.touch();
    if (this.neverWanted || this.bustedAt >= 0) return;
    const pts = this.cfg.infractionPoints[k] * count;
    if (pts <= 0) return;
    this.heat.add(pts);
    if (this.lastPlayerKey) this.vheat.add(this.lastPlayerKey, pts);
    if (this.search.phase === 'clear' && this.heat.level >= 1) this.search.start(at, this.tickNow);
    if (witness === 'police' || witness === 'heli') this.seenPulse = this.tickNow;
    this.noteLevel();
    this.deps.host.emit({ t: 'pursuit.report', tick: this.tickNow, n: Math.round(pts), s: k });
  }

  // ---- the step --------------------------------------------------------------------------------------------------------------

  /** One AI step at sim tick `tick`. */
  step(tick: number): void {
    const dt = this.lastTick < 0 ? 0 : tick - this.lastTick;
    this.lastTick = tick;
    this.tickNow = tick;
    const player = this.deps.host.player();
    if (!player) return;
    if (player.vehicleKey) this.lastPlayerKey = player.vehicleKey;

    for (const r of this.reports.take(tick)) this.applyNow(r.kind, r.pos, r.count, r.witness);
    this.heat.decay(dt);
    if (this.neverWanted && this.heat.level > 0) this.forceClear('neverWanted');

    if (this.bustedAt >= 0) {
      this.stepBusted(tick, player);
      return;
    }

    const active = this.heat.level >= 1;
    const lastKnown = this.search.lastKnown ? this.search.lastKnown.pos : null;
    const res = this.dispatch.step({
      tick, dt, level: this.heat.level, active, player, lastKnown, hint: this.hint, despawnRadius: this.despawnRadius,
    });
    if (!active) {
      this.pruneHeat(dt);
      return;
    }

    this.sealPortals();
    if (this.search.phase === 'clear') this.search.start(player.pos, tick);
    const seen = res.seen || this.seenPulse === tick;
    if (seen && this.search.phase === 'pursuit') {
      this.evasionTicks += dt;
      this.surviveTicks += dt;
      while (this.evasionTicks >= EVASION_TICKS) {
        this.evasionTicks -= EVASION_TICKS;
        this.applyNow('evasion', player.pos, 1, 'police');
      }
    }
    const hiding = this.deps.world.hidingSpotAt(player.pos[0], player.pos[2]) !== null;
    const out = this.search.step({ dt, tick, level: this.heat.level, seen, pos: player.pos, hiding });
    this.despawnRadius = this.cfg.levels[this.heat.level].searchRadiusM * 1.25;
    if (out === 'escaped') {
      this.escape(tick);
      return;
    }
    if (this.profile.kind === 'race' && this.profile.success?.kind === 'survive' && this.surviveTicks >= this.profile.success.sec * TICKS_PER_SEC) {
      this.deps.host.emit({ t: 'pursuit.survived', tick, n: Math.round(this.surviveTicks / TICKS_PER_SEC) });
      this.surviveTicks = 0;
    }
    if (this.bust.step(dt, player, this.dispatch.groundViews())) this.busted(tick, player);
  }

  /** Points below the first level decay; nothing else happens while clear. */
  private pruneHeat(_dt: number): void {
    if (this.heat.level === 0 && this.search.phase !== 'clear') this.search.reset();
  }

  private sealPortals(): void {
    const sealing = hasTactic(this.cfg, this.heat.level, 'portalSeal');
    const w = this.deps.world;
    if (sealing) {
      for (const p of w.portals()) if (p.state !== 'sealed') w.setPortalState(p.id, 'sealed', PORTAL_OWNER);
    } else if (w.sealedPortals().length > 0) {
      w.releasePortals(PORTAL_OWNER);
    }
  }

  private escape(tick: number): void {
    this.escapes++;
    this.deps.host.emit({ t: 'pursuit.escaped', tick, n: this.heat.level });
    this.forceClear('escaped');
  }

  private busted(tick: number, player: PlayerView): void {
    this.bustCount++;
    const level = this.heat.level;
    const cash = this.deps.wallet.cash();
    const fine = fineCents(this.cfg, cash, level);
    if (!this.deps.wallet.debit(fine, 'pursuit.bust', `bust:${this.bustCount}`) && cash > 0) {
      // the player cannot pay it all: the wallet is emptied
      this.deps.wallet.debit(cash, 'pursuit.bust', `bust:${this.bustCount}:partial`);
    }
    this.lastFine = fine;
    this.deps.host.emit({ t: 'pursuit.busted', tick, n: fine });
    const key = player.vehicleKey ?? this.lastPlayerKey;
    if (key) {
      const strikes = this.vheat.strike(key);
      this.lastStrikes = strikes;
      if (strikes >= this.cfg.impoundStrikes) {
        this.vheat.impound(key);
        this.deps.host.impound(key);
        this.deps.host.emit({ t: 'pursuit.impounded', tick, s: key, n: strikes });
      }
    }
    this.bustedAt = tick;
    this.bust.reset();
  }

  private stepBusted(tick: number, player: PlayerView): void {
    if (tick - this.bustedAt < BUST_HOLD_TICKS) {
      // the units hold their positions while the bust shows
      this.dispatch.step({
        tick, dt: 0, level: this.heat.level, active: true, player, lastKnown: null, hint: null, despawnRadius: this.despawnRadius,
      });
      return;
    }
    this.bustedAt = -1;
    this.forceClear('busted');
  }

  // ---- hash, save, load ------------------------------------------------------------------------------------------------------

  hash(h: Fnv64): void {
    this.heat.hash(h);
    this.search.hash(h);
    this.bust.hash(h);
    this.vheat.hash(h);
    this.reports.hash(h);
    this.dispatch.hash(h);
    h.u8(this.profile.kind === 'story' ? 0 : 1).u8(this.profile.startHeat).u8(this.profile.maxHeat);
    h.u32(this.hint ? this.hint.length : 0);
    for (const e of this.hint ?? []) h.u32(e);
    h.u32(this.lastFine).u32(this.lastStrikes).u32(this.bustCount).u32(this.escapes).f64(this.bustedAt).u32(this.evasionTicks).u32(this.surviveTicks).u8(this.neverWanted ? 1 : 0).f64(this.despawnRadius);
  }

  /**
   * The hashed, checkpointed resource. Checkpoints keep the heat state, the search state, the vehicle heat and the profile; the units
   * are not restored (the ECS holds their entities, the dispatcher respawns what the level calls for), BD-M03c-03.
   */
  resource(): SimResource {
    return {
      name: PURSUIT_RESOURCE,
      hash: (h) => this.hash(h),
      save: (w: ByteWriter) => {
        w.u8(this.heat.level);
        w.f64(this.heat.points);
        w.u8(this.heat.cap);
        w.u8(this.heat.scripted ? 1 : 0);
        w.u8(this.search.phase === 'clear' ? 0 : this.search.phase === 'pursuit' ? 1 : this.search.phase === 'search' ? 2 : 3);
        w.f64(this.search.cooldown);
        w.f64(this.search.radius);
        w.u32(this.bustCount);
        w.u32(this.escapes);
      },
      load: (r: ByteReader) => {
        this.heat.level = r.u8() as HeatLevel;
        this.heat.points = r.f64();
        this.heat.cap = r.u8() as HeatLevel;
        this.heat.scripted = r.u8() !== 0;
        const ph = r.u8();
        this.search.phase = ph === 0 ? 'clear' : ph === 1 ? 'pursuit' : ph === 2 ? 'search' : 'cooldown';
        this.search.cooldown = r.f64();
        this.search.radius = r.f64();
        this.bustCount = r.u32();
        this.escapes = r.u32();
      },
    };
  }
}
