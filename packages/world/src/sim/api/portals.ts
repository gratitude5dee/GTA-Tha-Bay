/**
 * Portals (M02c1, DL-691; 02-world-maps.md section 4.2): the runtime entry of every `WorldIndex.portals` row. The Golden Gate,
 * the Bay Bridge, the county line and the ferry start `closed` whatever the bake wrote. A portal is `sealed` while any owner
 * holds it sealed (the pursuit director at heat 5; its edges are then closed for planning through `TrafficControl.closeEdges`),
 * `open` only when a scripted finale says so, and `closed` otherwise.
 *
 * `release(by)` restores everything `by` sealed. When an owner's closures are released directly in `TrafficControl` the portals
 * it sealed fall back too, because the runtime listens to the closure changes. State is sim state: `resource()` hashes and
 * checkpoints it. Pure; C02 lint applies.
 */
import type { EdgeId, Portal } from '@dv/shared';
import type { SimResource } from '@dv/engine/sim';
import type { TrafficControlImpl } from '../traffic/control.ts';

/** Name of the resource in the state hash. */
export const PORTAL_RESOURCE = 'world.portals';

interface Entry {
  base: Portal;
  open: boolean;
  /** Owners holding the portal sealed, ascending. */
  holders: string[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class PortalRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[];
  private readonly listeners = new Set<(id: string) => void>();

  constructor(portals: readonly Portal[], private readonly traffic: TrafficControlImpl) {
    for (const p of portals) this.entries.set(p.id, { base: { ...p, edges: [...p.edges], state: 'closed' }, open: false, holders: [] });
    this.order = [...this.entries.keys()].sort(byString);
    traffic.onClosureChange((e) => {
      if (e.closed) return;
      for (const id of this.order) {
        const en = this.entries.get(id) as Entry;
        if (en.holders.includes(e.by) && en.base.edges.some((x) => e.edges.includes(x))) {
          this.drop(en, e.by);
          this.changed(id);
        }
      }
    });
  }

  private stateOf(en: Entry): Portal['state'] {
    return en.holders.length > 0 ? 'sealed' : en.open ? 'open' : 'closed';
  }

  private drop(en: Entry, by: string): void {
    const i = en.holders.indexOf(by);
    if (i >= 0) en.holders.splice(i, 1);
  }

  /** Every portal with its current state, ascending by id. */
  list(): Portal[] {
    return this.order.map((id) => this.get(id) as Portal);
  }

  get(id: string): Portal | null {
    const en = this.entries.get(id);
    return en ? { ...en.base, edges: [...en.base.edges], state: this.stateOf(en) } : null;
  }

  /** Moves a portal to `closed`, `open` or `sealed` for the owner `by`. Returns false for an unknown portal or owner. */
  setState(id: string, state: Portal['state'], by: string): boolean {
    const en = this.entries.get(id);
    if (!en || by === '') return false;
    if (state === 'sealed') {
      if (!en.holders.includes(by)) {
        en.holders.push(by);
        en.holders.sort(byString);
      }
      this.traffic.closeEdges(en.base.edges, by);
    } else {
      // `open` and `closed` end this owner's seal; `open` also lifts the portal's own closure (a scripted finale)
      if (en.holders.includes(by)) {
        this.drop(en, by);
        this.traffic.reopenEdges(en.base.edges, by);
      }
      en.open = state === 'open';
    }
    this.changed(id);
    return true;
  }

  /** Restores every portal `by` sealed to its base state and drops the owner's other holds in `TrafficControl`. */
  release(by: string): void {
    const touched: string[] = [];
    for (const id of this.order) {
      const en = this.entries.get(id) as Entry;
      if (en.holders.includes(by)) {
        this.drop(en, by);
        touched.push(id);
      }
    }
    this.traffic.release(by);
    for (const id of touched) this.changed(id);
  }

  sealed(): string[] {
    return this.order.filter((id) => (this.entries.get(id) as Entry).holders.length > 0);
  }

  /** Edges of the county-line portals, which carry the soft wall. */
  edgesOf(kind: Portal['kind']): EdgeId[] {
    const out: EdgeId[] = [];
    for (const id of this.order) {
      const en = this.entries.get(id) as Entry;
      if (en.base.kind === kind) out.push(...en.base.edges);
    }
    return out.sort((a, b) => a - b);
  }

  /** Calls `fn(id)` after a portal's state changed (the colliders of a closure follow it). */
  onChange(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(id: string): void {
    for (const fn of [...this.listeners]) fn(id);
  }

  resource(): SimResource {
    return {
      name: PORTAL_RESOURCE,
      hash: (h) => {
        for (const id of this.order) {
          const en = this.entries.get(id) as Entry;
          h.str(id).u8(en.open ? 1 : 0).u32(en.holders.length);
          for (const by of en.holders) h.str(by);
        }
      },
      save: (w) => {
        for (const id of this.order) {
          const en = this.entries.get(id) as Entry;
          w.u8(en.open ? 1 : 0);
          w.u32(en.holders.length);
          for (const by of en.holders) w.str(by);
        }
      },
      load: (r) => {
        for (const id of this.order) {
          const en = this.entries.get(id) as Entry;
          en.open = r.u8() !== 0;
          en.holders = [];
          for (let n = r.u32(); n > 0; n--) en.holders.push(r.str());
        }
      },
    };
  }
}
