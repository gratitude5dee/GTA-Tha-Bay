import { stepDownTier, type DynamicQuality, type QualityTier, type QualityTierId, type TierDecisionSource } from '@dv/shared';
import { EvictionRegistry } from './eviction.ts';

/**
 * MemoryBudget (11-platform.md section 5.6, P-11). It sums the accounted memory (`renderer.info.memory`, the registered wasm and
 * SharedArrayBuffer bytes and asset.worker caches, the media estimate) against the tier's caps in `config/tier-budgets.json` and acts
 * on the worst ratio of any cap:
 *
 * - at 85 %: evict (the registered evictors: LRU chunks and textures), raise `textureMipBias` one step, emit `onMemoryPressure('soft')`;
 * - at 95 %: drop the streaming radius one step and emit `'hard'`; while it stays hard the radius keeps stepping down every 2 s;
 * - a `'hard'` that lasts 10 s with the radius at its floor asks for the next tier down (`'memory-pressure'`) at a safe point.
 *
 * It leaves a level only after the ratio has been under 80 % for 10 s (the re-admission delay of the risks list), so evicted chunks do
 * not come straight back and cycle. Time is the caller's clock in milliseconds.
 */
export const SOFT_RATIO = 0.85;
export const HARD_RATIO = 0.95;
/** Ratio under which a level may end, after `RESTORE_AFTER_MS`. */
export const CLEAR_RATIO = 0.8;
export const RESTORE_AFTER_MS = 10_000;
export const RADIUS_STEP_GAP_MS = 2000;
export const HARD_SUSTAIN_MS = 10_000;
export const MIP_BIAS_STEP = 0.5;

export type MemoryLevel = 'none' | 'soft' | 'hard';

/** What the budget counts, MB. `mediaMB` is the decoded-clip estimate (0 where none). */
export interface MemoryReading {
  texturesMB: number;
  gpuMB: number;
  /** wasm memories, SharedArrayBuffer blocks, asset.worker caches. */
  heapMB: number;
  mediaMB: number;
}

/** The caps of a tier (`TierBudget.memory`); a null or zero cap is not counted. */
export interface MemoryCaps {
  maxTextureMB: number;
  maxGpuResourceMB: number;
  maxAccountedHeapMB: number;
  maxMediaMB: number | null;
}

/** What the response does to the world; the app wires these to the ChunkStore. */
export interface MemoryActions {
  /** Drops one streaming-radius step. Returns false when the radius is already at its floor. */
  dropRadius(): boolean;
  /** Puts the radius back to nominal (the level ended). */
  restoreRadius(): void;
}

/** The part of `QualityServiceImpl` the budget uses. */
export interface MemoryQuality {
  readonly tier: QualityTier;
  readonly dynamic: Readonly<DynamicQuality>;
  readonly isSafe: boolean;
  setDynamic(q: DynamicQuality): void;
  setTier(id: QualityTierId, reason: TierDecisionSource): Promise<void>;
  emitMemoryPressure(level: 'soft' | 'hard'): void;
  onTierChange(fn: (next: QualityTier, prev: QualityTier) => void): () => void;
}

export interface MemoryBudgetOptions {
  quality: MemoryQuality;
  read: () => MemoryReading;
  actions: MemoryActions;
  evictors?: EvictionRegistry;
  note?: (line: string) => void;
}

export interface MemoryState {
  level: MemoryLevel;
  /** The largest used/cap ratio and the cap that gave it. */
  ratio: number;
  worst: 'textures' | 'gpu' | 'heap' | 'media' | null;
  injectedMB: number;
  reading: MemoryReading;
  radiusAtFloor: boolean;
  /** How long the level has been `hard` with the radius at its floor, ms. */
  hardAtFloorMs: number;
  tierRequested: boolean;
  softEvents: number;
  hardEvents: number;
}

export class MemoryBudget {
  readonly evictors: EvictionRegistry;
  private readonly o: MemoryBudgetOptions;
  private level_: MemoryLevel = 'none';
  private injected = 0;
  private clearSince: number | null = null;
  private lastDrop = Number.NEGATIVE_INFINITY;
  private atFloorSince: number | null = null;
  private radiusFloor = false;
  private requested = false;
  private soft = 0;
  private hard = 0;
  private last: { ratio: number; worst: MemoryState['worst']; reading: MemoryReading } = { ratio: 0, worst: null, reading: { texturesMB: 0, gpuMB: 0, heapMB: 0, mediaMB: 0 } };
  private readonly off: () => void;

  constructor(o: MemoryBudgetOptions) {
    this.o = o;
    this.evictors = o.evictors ?? new EvictionRegistry();
    this.off = o.quality.onTierChange(() => {
      // A new tier has new caps and a new radius plan: start over.
      this.requested = false;
      this.atFloorSince = null;
      this.radiusFloor = false;
    });
  }

  get level(): MemoryLevel {
    return this.level_;
  }

  /** QA: adds `mb` of accounted heap on top of the reading (0 clears it). */
  injectMB(mb: number): void {
    this.injected = Number.isFinite(mb) && mb > 0 ? mb : 0;
  }

  /** The largest used/cap ratio of the counters now. */
  measure(): { ratio: number; worst: MemoryState['worst']; reading: MemoryReading } {
    const caps = this.o.quality.tier.budget.memory as MemoryCaps;
    const r = this.o.read();
    const reading: MemoryReading = { ...r, heapMB: r.heapMB + this.injected };
    const rows: [MemoryState['worst'], number, number | null][] = [
      ['textures', reading.texturesMB, caps.maxTextureMB],
      ['gpu', reading.gpuMB, caps.maxGpuResourceMB],
      ['heap', reading.heapMB, caps.maxAccountedHeapMB],
      ['media', reading.mediaMB, caps.maxMediaMB],
    ];
    let ratio = 0;
    let worst: MemoryState['worst'] = null;
    for (const [name, used, cap] of rows) {
      if (cap === null || !(cap > 0)) continue;
      const x = used / cap;
      if (x > ratio) {
        ratio = x;
        worst = name;
      }
    }
    return { ratio, worst, reading };
  }

  /** Reads the counters and acts on them. Call about once a second (the platform does, from the frame loop). */
  sample(nowMs: number): MemoryLevel {
    const m = this.measure();
    this.last = m;
    const prev = this.level_;
    let next: MemoryLevel = prev;
    if (m.ratio >= HARD_RATIO) next = 'hard';
    else if (m.ratio >= SOFT_RATIO) next = prev === 'hard' && m.ratio >= (HARD_RATIO + SOFT_RATIO) / 2 ? 'hard' : 'soft';
    else if (m.ratio < CLEAR_RATIO) next = prev; // ends below, after the delay
    if (m.ratio >= CLEAR_RATIO) this.clearSince = null;
    else if (prev !== 'none') {
      this.clearSince ??= nowMs;
      if (nowMs - this.clearSince >= RESTORE_AFTER_MS) next = 'none';
    }

    if (next !== prev) this.enter(prev, next, nowMs);
    if (this.level_ === 'hard') this.whileHard(nowMs);
    return this.level_;
  }

  private enter(prev: MemoryLevel, next: MemoryLevel, nowMs: number): void {
    this.level_ = next;
    if (prev === 'hard' && next !== 'hard') this.atFloorSince = null;
    const q = this.o.quality;
    const note = this.o.note ?? (() => {});
    if (next === 'none') {
      this.o.actions.restoreRadius();
      this.radiusFloor = false;
      this.atFloorSince = null;
      this.lastDrop = Number.NEGATIVE_INFINITY;
      note('memory pressure ended');
      return;
    }
    if (prev === 'none') {
      // soft response: evict, raise the mip bias one step, say so
      const freed = this.evictors.run('soft');
      this.raiseMipBias();
      this.soft += 1;
      note(`memory soft ${Math.round(this.last.ratio * 100)}% (${this.last.worst}) freed ${Math.round(freed)} MB`);
      q.emitMemoryPressure('soft');
    }
    if (next === 'hard') {
      this.evictors.run('hard');
      this.dropStep(nowMs);
      this.hard += 1;
      note(`memory hard ${Math.round(this.last.ratio * 100)}% (${this.last.worst})`);
      q.emitMemoryPressure('hard');
    }
  }

  private raiseMipBias(): void {
    const q = this.o.quality;
    const floor = q.tier.dynamic.floor.textureMipBias;
    const cur = q.dynamic.textureMipBias;
    if (cur >= floor) return;
    q.setDynamic({ ...(q.dynamic as DynamicQuality), textureMipBias: Math.min(floor, Math.round((cur + MIP_BIAS_STEP) * 100) / 100) });
  }

  private dropStep(nowMs: number): void {
    this.lastDrop = nowMs;
    const stepped = this.o.actions.dropRadius();
    this.radiusFloor = !stepped;
  }

  private whileHard(nowMs: number): void {
    if (!this.radiusFloor && nowMs - this.lastDrop >= RADIUS_STEP_GAP_MS) this.dropStep(nowMs);
    if (!this.radiusFloor) {
      this.atFloorSince = null;
      return;
    }
    this.atFloorSince ??= nowMs;
    if (this.requested || nowMs - this.atFloorSince < HARD_SUSTAIN_MS || !this.o.quality.isSafe) return;
    const next = stepDownTier(this.o.quality.tier.id);
    if (next === null) return;
    this.requested = true;
    this.o.note?.(`memory demotion ${this.o.quality.tier.id}>${next}`);
    this.o.quality.setTier(next, 'memory-pressure').catch(() => {
      this.requested = false;
    });
  }

  state(nowMs = 0): MemoryState {
    return {
      level: this.level_,
      ratio: Math.round(this.last.ratio * 1000) / 1000,
      worst: this.last.worst,
      injectedMB: this.injected,
      reading: this.last.reading,
      radiusAtFloor: this.radiusFloor,
      hardAtFloorMs: this.atFloorSince === null ? 0 : Math.max(0, Math.round(nowMs - this.atFloorSince)),
      tierRequested: this.requested,
      softEvents: this.soft,
      hardEvents: this.hard,
    };
  }

  dispose(): void {
    this.off();
  }
}
