/**
 * The binder between a pursuit event and the engine's `PursuitDirector` (06-racing.md 2.6, 06-racing-content.md C.11; M07a2).
 *
 * A race event whose police are on gets `PursuitApi.setProfile({kind: 'race', startHeat, maxHeat, success, configRef})` at GO and
 * the profile it had before (`story`) when the event ends. `configRef` names `config/pursuit.race.json`, which the engine's pursuit
 * module resolves with `racePursuitLoaders()` (wired in `apps/web/src/workers/sim.worker.ts`). The binder listens for the
 * director's three endings (`pursuit.escaped`, `pursuit.busted`, `pursuit.survived`), counts the bounty (points a second at the
 * current heat, a bonus a wrecked unit) and keeps the highest heat. It never touches the director's internals.
 *
 * Sim code under the C02 lint.
 */
import { parseRacePursuit, type RacePursuitRules } from '@dv/engine/sim';
import type { HeatLevel, PursuitApi, PursuitConfig, PursuitProfile, RaceDef, SimEvent, SimEventBus } from '@dv/shared';
import pursuitJson from '../../../../../config/pursuit.json';
import raceJson from '../../../../../config/pursuit.race.json';

export const PURSUIT_RACE_REF = 'config/pursuit.race.json';

export interface RacePursuitFile { cfg: PursuitConfig; rules: RacePursuitRules }

let parsed: RacePursuitFile | null = null;

/** `config/pursuit.race.json` over `config/pursuit.json`, validated; throws with the paths of every defect. */
export function racePursuitFile(): RacePursuitFile {
  if (parsed) return parsed;
  const r = parseRacePursuit(raceJson, pursuitJson as unknown as PursuitConfig);
  if (!r.ok) throw new Error(`${PURSUIT_RACE_REF}: ${r.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  parsed = { cfg: r.cfg, rules: r.rules };
  return parsed;
}

/** The two resolvers the engine's pursuit module takes (`createPursuitModule({...racePursuitLoaders()})`). */
export function racePursuitLoaders(): { loadConfig(ref: string): PursuitConfig | null; loadRace(ref: string): RacePursuitRules | null } {
  return {
    loadConfig: (ref) => (ref === PURSUIT_RACE_REF ? racePursuitFile().cfg : null),
    loadRace: (ref) => (ref === PURSUIT_RACE_REF ? racePursuitFile().rules : null),
  };
}

export type PursuitOutcome = 'evade' | 'survive' | 'bust' | null;

export function profileOf(def: Pick<RaceDef, 'police'>): PursuitProfile {
  const p = def.police;
  const success = p.success === undefined || p.success === 'evade' ? { kind: 'evade' as const } : { kind: 'survive' as const, sec: p.success.surviveSec };
  return { kind: 'race', startHeat: p.startHeat, maxHeat: p.maxHeat, success, configRef: PURSUIT_RACE_REF };
}

const TICKS_PER_SEC = 60;

export class PursuitBinder {
  outcome: PursuitOutcome = null;
  maxHeat: HeatLevel = 0;
  /** Bounty points earned so far. */
  points = 0;
  takedowns = 0;
  startTick = -1;
  private off: (() => void)[] = [];
  private lastSecond = -1;
  private active = false;

  constructor(
    private readonly api: Pick<PursuitApi, 'setProfile' | 'setRouteHint' | 'state'>,
    private readonly events: Pick<SimEventBus, 'on'>,
    private readonly def: RaceDef,
    private readonly rules: RacePursuitRules = racePursuitFile().rules,
  ) {}

  get running(): boolean {
    return this.active;
  }

  start(tick: number): void {
    if (this.active) return;
    this.active = true;
    this.startTick = tick;
    this.outcome = null;
    this.points = 0;
    this.takedowns = 0;
    this.maxHeat = this.def.police.startHeat;
    this.lastSecond = 0;
    this.api.setProfile(profileOf(this.def));
    const edges = this.def.route.flatMap((r) => r.edgeIds);
    if (edges.length > 0) this.api.setRouteHint(edges);
    this.off.push(
      this.events.on('pursuit.escaped', () => this.end('evade')),
      this.events.on('pursuit.survived', () => this.end('survive')),
      this.events.on('pursuit.busted', () => this.end('bust')),
      this.events.on('pursuit.wrecked', (e: SimEvent) => {
        if (this.outcome === null) {
          this.takedowns++;
          this.points += this.rules.bounty.perTakedown;
          void e;
        }
      }),
    );
  }

  private end(o: Exclude<PursuitOutcome, null>): void {
    if (this.outcome === null) this.outcome = o;
  }

  /** Every sim tick while the event runs: the bounty and the highest heat. */
  step(tick: number): void {
    if (!this.active || this.outcome !== null) return;
    const lv = this.api.state().level;
    if (lv > this.maxHeat) this.maxHeat = lv;
    const sec = Math.floor((tick - this.startTick) / TICKS_PER_SEC);
    while (this.lastSecond < sec) {
      this.lastSecond++;
      if (lv > 0) this.points += this.rules.bounty.perSecAtHeat * lv;
    }
  }

  bountyCents(): number {
    return Math.round(this.points) * this.rules.bounty.centsPerPoint;
  }

  seconds(tick: number): number {
    return this.startTick < 0 ? 0 : Math.max(0, Math.floor((tick - this.startTick) / TICKS_PER_SEC));
  }

  /** Back to the story profile (the event ended or the player left). */
  stop(): void {
    for (const f of this.off) f();
    this.off = [];
    if (!this.active) return;
    this.active = false;
    this.api.setProfile({ kind: 'story', startHeat: 0, maxHeat: 5 });
    this.api.setRouteHint(null);
  }
}
