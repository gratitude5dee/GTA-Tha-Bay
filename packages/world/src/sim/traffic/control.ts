/**
 * `TrafficControl` (M02c1; C08 `TrafficControl`, 02-world-living.md sections 1.7 and 6): the switches that missions, events,
 * pursuit and the sandbox use to change the city for a while, each held by an owner string and released by the same owner.
 *
 *  - **Blackout.** Adopts M02b2's hashed `Blackout` unchanged: signals go dark (`RoadGraph.signal`), robotaxis hold, lamps go off.
 *  - **Density.** `setDensity(kind, mult, by)`, mult clamped to 0 to 1.5. Each kind keeps a stack of overrides in the order they
 *    were set; the newest one is in force and releasing it brings back the one below (a mission's 0.35 over the sandbox's 1.0).
 *  - **Closures.** `closeEdges(edges, by)` marks edges closed for planning (the router avoids them); an edge stays closed while
 *    any owner holds it. Every change notifies the `onClosureChange` listeners with `{edges, closed, by}`: the edges that
 *    owner closed, or the edges it reopens on release (M03a1 puts barrier props at them, DL-663).
 *
 * Everything here is sim state: `resource()` hashes and checkpoints it (the blackout keeps its own resource). Pure; C02 lint applies.
 */
import type { EdgeId, TrafficControl } from '@dv/shared';
import type { SimResource } from '@dv/engine/sim';
import type { Blackout } from '../env/blackout.ts';

export type DensityKind = 'traffic' | 'ped' | 'parked';
export const DENSITY_KINDS: readonly DensityKind[] = ['traffic', 'ped', 'parked'];
export const DENSITY_MAX = 1.5;
/** Name of the resource in the state hash. */
export const TRAFFIC_RESOURCE = 'world.traffic';

export interface ClosureChange {
  edges: readonly EdgeId[];
  closed: boolean;
  by: string;
}
export type ClosureListener = (e: ClosureChange) => void;

interface DensityHold {
  by: string;
  mult: number;
}

const ascending = (a: number, b: number): number => a - b;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class TrafficControlImpl implements TrafficControl {
  private readonly density: Record<DensityKind, DensityHold[]> = { traffic: [], ped: [], parked: [] };
  /** owner to the edges it closed */
  private readonly closures = new Map<string, Set<EdgeId>>();
  /** edge to the number of owners holding it closed */
  private readonly held = new Map<EdgeId, number>();
  private readonly listeners = new Set<ClosureListener>();

  constructor(private readonly bo: Blackout) {}

  get blackout(): boolean {
    return this.bo.on;
  }

  setBlackout(on: boolean, by: string): void {
    this.bo.set(on, by);
  }

  /** `mult` is clamped to 0 to 1.5; a value that is not a number is ignored. */
  setDensity(kind: DensityKind, mult: number, by: string): void {
    if (by === '' || !(DENSITY_KINDS as readonly string[]).includes(kind) || !Number.isFinite(mult)) return;
    const m = mult < 0 ? 0 : mult > DENSITY_MAX ? DENSITY_MAX : mult;
    const stack = this.density[kind];
    const i = stack.findIndex((h) => h.by === by);
    if (i >= 0) stack.splice(i, 1);
    stack.push({ by, mult: m });
  }

  /** The multiplier in force for a kind: the newest override, 1 when there is none. `activeSlots` takes it as `override`. */
  densityOf(kind: DensityKind): number {
    const s = this.density[kind];
    const top = s[s.length - 1];
    return top ? top.mult : 1;
  }

  closeEdges(edges: readonly EdgeId[], by: string): void {
    if (by === '') return;
    const mine = this.closures.get(by) ?? new Set<EdgeId>();
    const added: EdgeId[] = [];
    for (const e of edges) {
      if (!Number.isInteger(e) || e < 0 || mine.has(e)) continue;
      mine.add(e);
      this.held.set(e, (this.held.get(e) ?? 0) + 1);
      added.push(e);
    }
    if (mine.size > 0) this.closures.set(by, mine);
    if (added.length > 0) this.notify({ edges: added.sort(ascending), closed: true, by });
  }

  /** Reopens specific edges for one owner (a portal returning to `closed`); `release` reopens all of an owner's. */
  reopenEdges(edges: readonly EdgeId[], by: string): void {
    const mine = this.closures.get(by);
    if (!mine) return;
    const gone: EdgeId[] = [];
    for (const e of edges) {
      if (!mine.delete(e)) continue;
      this.unhold(e);
      gone.push(e);
    }
    if (mine.size === 0) this.closures.delete(by);
    if (gone.length > 0) this.notify({ edges: gone.sort(ascending), closed: false, by });
  }

  /** Drops everything `by` holds: its blackout, its density overrides, its closures. */
  release(by: string): void {
    this.bo.set(false, by);
    for (const k of DENSITY_KINDS) {
      const s = this.density[k];
      const i = s.findIndex((h) => h.by === by);
      if (i >= 0) s.splice(i, 1);
    }
    const mine = this.closures.get(by);
    if (!mine) return;
    this.closures.delete(by);
    const gone = [...mine].sort(ascending);
    for (const e of gone) this.unhold(e);
    if (gone.length > 0) this.notify({ edges: gone, closed: false, by });
  }

  private unhold(e: EdgeId): void {
    const n = (this.held.get(e) ?? 0) - 1;
    if (n > 0) this.held.set(e, n);
    else this.held.delete(e);
  }

  isClosed(e: EdgeId): boolean {
    return this.held.has(e);
  }

  /** Edges closed by at least one owner, ascending. */
  closedEdges(): EdgeId[] {
    return [...this.held.keys()].sort(ascending);
  }

  /** The edges one owner holds closed, ascending. */
  closedBy(by: string): EdgeId[] {
    return [...(this.closures.get(by) ?? [])].sort(ascending);
  }

  onClosureChange(fn: ClosureListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(e: ClosureChange): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  /** The densities and closures as a hashed, checkpointed resource (the blackout has its own). */
  resource(): SimResource {
    return {
      name: TRAFFIC_RESOURCE,
      hash: (h) => {
        for (const k of DENSITY_KINDS) {
          h.u32(this.density[k].length);
          for (const d of this.density[k]) h.str(d.by).f64(d.mult);
        }
        const owners = [...this.closures.keys()].sort(byString);
        h.u32(owners.length);
        for (const by of owners) {
          const edges = [...(this.closures.get(by) as Set<EdgeId>)].sort(ascending);
          h.str(by).u32(edges.length);
          for (const e of edges) h.u32(e);
        }
      },
      save: (w) => {
        for (const k of DENSITY_KINDS) {
          w.u32(this.density[k].length);
          for (const d of this.density[k]) {
            w.str(d.by);
            w.f64(d.mult);
          }
        }
        const owners = [...this.closures.keys()].sort(byString);
        w.u32(owners.length);
        for (const by of owners) {
          const edges = [...(this.closures.get(by) as Set<EdgeId>)].sort(ascending);
          w.str(by);
          w.u32(edges.length);
          for (const e of edges) w.u32(e);
        }
      },
      load: (r) => {
        for (const k of DENSITY_KINDS) {
          this.density[k] = [];
          for (let n = r.u32(); n > 0; n--) this.density[k].push({ by: r.str(), mult: r.f64() });
        }
        this.closures.clear();
        this.held.clear();
        for (let n = r.u32(); n > 0; n--) {
          const by = r.str();
          const set = new Set<EdgeId>();
          for (let m = r.u32(); m > 0; m--) {
            const e = r.u32();
            set.add(e);
            this.held.set(e, (this.held.get(e) ?? 0) + 1);
          }
          this.closures.set(by, set);
        }
      },
    };
  }
}
