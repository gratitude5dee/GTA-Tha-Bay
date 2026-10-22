import type { ComponentDef, EcsApi, EntityHandle, ZoneService, ZoneShape } from '@dv/shared';
import { Transform } from '../ecs/components.ts';

const CELL_M = 100;
/** A circle zone is a cylinder: horizontal radius `r`, this many metres up and down from `at.y`. */
export const CIRCLE_HALF_HEIGHT_M = 20;

/** A road edge near a point, for `edges` zones (the world's `graph.nearestEdge`); null when none is within `maxM`. */
export type EdgeProbe = (x: number, y: number, z: number, maxM: number) => { edge: number; twin: number; distM: number } | null;

export interface ZoneOptions {
  ecs: EcsApi;
  /** The sim tick; the spatial hash is rebuilt when it changes. */
  tick(): number;
  /** `edges` zones need the road graph; without a probe they contain nothing. */
  edgeProbe?: EdgeProbe;
}

interface Watcher {
  id: number;
  zone: string;
  filter: readonly ComponentDef[];
  kind: 'enter' | 'exit';
  cb: (h: EntityHandle) => void;
}

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

function boundsOf(s: ZoneShape): Bounds {
  switch (s.k) {
    case 'circle':
      return { minX: s.at[0] - s.r, maxX: s.at[0] + s.r, minZ: s.at[2] - s.r, maxZ: s.at[2] + s.r };
    case 'poly': {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of s.ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      return { minX, maxX, minZ, maxZ };
    }
    case 'edges':
      return { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
  }
}

function inPolygon(ring: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as [number, number];
    const b = ring[j] as [number, number];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * `ZoneService` (C06): named shapes in ENU metres, tested against `Transform`. `inside` is a direct test. `query` and the
 * enter/exit watchers use a 100 m spatial hash of the entities that have a `Transform`, rebuilt at most once per tick and only when
 * asked. Watchers fire from `update(tick)` (the engine calls it in `SimStage.Script`): per zone in ascending id order, exits before
 * enters, each in ascending handle order. A watcher's first update records who is inside without firing `onEnter`. Sim code under
 * the C02 lint.
 */
export class ZoneServiceImpl implements ZoneService {
  private readonly zones = new Map<string, ZoneShape>();
  private readonly watchers: Watcher[] = [];
  private readonly members = new Map<number, Set<number>>();
  private nextWatcher = 1;
  private index = new Map<number, number[]>();
  private indexTick = -1;
  private indexCount = -1;

  constructor(private readonly o: ZoneOptions) {}

  define(id: string, s: ZoneShape): void {
    this.zones.set(id, s);
  }

  undefine(id: string): void {
    this.zones.delete(id);
    for (let i = this.watchers.length - 1; i >= 0; i--) {
      const w = this.watchers[i] as Watcher;
      if (w.zone === id) {
        this.members.delete(w.id);
        this.watchers.splice(i, 1);
      }
    }
  }

  has(id: string): boolean {
    return this.zones.has(id);
  }

  shape(id: string): ZoneShape | undefined {
    return this.zones.get(id);
  }

  ids(): string[] {
    return [...this.zones.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Whether the entity's position is in the zone; false for a stale handle, an unknown zone or an entity without `Transform`. */
  inside(id: string, h: EntityHandle): boolean {
    const s = this.zones.get(id);
    if (!s) return false;
    const e = this.o.ecs.resolve(h);
    if (e === null || !this.o.ecs.has(h, Transform)) return false;
    const tr = this.o.ecs.store(Transform);
    return this.contains(s, tr.px[e] as number, tr.py[e] as number, tr.pz[e] as number);
  }

  /** Whether the point is in the zone. */
  containsPoint(id: string, x: number, y: number, z: number): boolean {
    const s = this.zones.get(id);
    return s ? this.contains(s, x, y, z) : false;
  }

  query(id: string, filter: readonly ComponentDef[] = []): EntityHandle[] {
    const s = this.zones.get(id);
    if (!s) return [];
    return this.collect(s, filter);
  }

  onEnter(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void {
    return this.watch(id, filter, 'enter', cb);
  }

  onExit(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void {
    return this.watch(id, filter, 'exit', cb);
  }

  /** Fires the enter and exit callbacks of this tick. */
  update(tick: number): void {
    void tick;
    if (this.watchers.length === 0) return;
    const sorted = [...this.watchers].sort((a, b) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : a.kind === b.kind ? a.id - b.id : a.kind === 'exit' ? -1 : 1));
    for (const w of sorted) {
      const s = this.zones.get(w.zone);
      if (!s) continue;
      const now = new Set<number>(this.collect(s, w.filter));
      const before = this.members.get(w.id);
      this.members.set(w.id, now);
      if (!before) continue;
      const changed = w.kind === 'enter' ? [...now].filter((h) => !before.has(h)) : [...before].filter((h) => !now.has(h));
      changed.sort((a, b) => a - b);
      for (const h of changed) w.cb(h as EntityHandle);
    }
  }

  private watch(zone: string, filter: readonly ComponentDef[], kind: 'enter' | 'exit', cb: (h: EntityHandle) => void): () => void {
    const w: Watcher = { id: this.nextWatcher++, zone, filter, kind, cb };
    this.watchers.push(w);
    return () => {
      const i = this.watchers.indexOf(w);
      if (i >= 0) this.watchers.splice(i, 1);
      this.members.delete(w.id);
    };
  }

  private contains(s: ZoneShape, x: number, y: number, z: number): boolean {
    switch (s.k) {
      case 'circle': {
        const dx = x - s.at[0];
        const dz = z - s.at[2];
        return dx * dx + dz * dz <= s.r * s.r && y >= s.at[1] - CIRCLE_HALF_HEIGHT_M && y <= s.at[1] + CIRCLE_HALF_HEIGHT_M;
      }
      case 'poly':
        return y >= s.yMin && y <= s.yMax && inPolygon(s.ring, x, z);
      case 'edges': {
        const hit = this.o.edgeProbe?.(x, y, z, s.widthM / 2);
        return hit !== null && hit !== undefined && (s.edgeIds.includes(hit.edge) || s.edgeIds.includes(hit.twin));
      }
    }
  }

  private rebuild(): void {
    const ecs = this.o.ecs;
    const ids = ecs.query([Transform]);
    const now = this.o.tick();
    if (this.indexTick === now && this.indexCount === ids.length) return;
    this.indexTick = now;
    this.indexCount = ids.length;
    this.index = new Map();
    const tr = ecs.store(Transform);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const key = cellKey(Math.floor((tr.px[id] as number) / CELL_M), Math.floor((tr.pz[id] as number) / CELL_M));
      let list = this.index.get(key);
      if (!list) this.index.set(key, (list = []));
      list.push(id);
    }
  }

  private collect(s: ZoneShape, filter: readonly ComponentDef[]): EntityHandle[] {
    const ecs = this.o.ecs;
    const tr = ecs.store(Transform);
    const out: EntityHandle[] = [];
    const take = (id: number): void => {
      const h = ecs.handle(id as never);
      if (filter.some((c) => !ecs.has(h, c))) return;
      if (this.contains(s, tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number)) out.push(h);
    };
    if (s.k === 'edges') {
      const ids = ecs.query([Transform]);
      for (let i = 0; i < ids.length; i++) take(ids[i] as number);
    } else {
      this.rebuild();
      const b = boundsOf(s);
      const x0 = Math.floor(b.minX / CELL_M);
      const x1 = Math.floor(b.maxX / CELL_M);
      const z0 = Math.floor(b.minZ / CELL_M);
      const z1 = Math.floor(b.maxZ / CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const list = this.index.get(cellKey(cx, cz));
          if (list) for (const id of list) take(id);
        }
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }
}

const cellKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
