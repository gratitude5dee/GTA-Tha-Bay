import {
  VARIANT_FALLBACK,
  type DeviceProfile,
  type DynamicQuality,
  type QualityService,
  type QualityTier,
  type QualityTierId,
  type RenderBackend,
  type TierBudget,
  type TierDecisionSource,
} from '@dv/shared';
import { TIERS } from './tier-config.ts';

/**
 * QualityService (C13 section 4.2). Holds the active tier, the dynamic-quality state and the listeners.
 *
 * `setTier` applies only at a safe point (boot, title; later loading boundaries, menus and the XR veil). Outside one the request
 * is queued and the returned promise resolves when it is applied, so a tier change never lands in the middle of a mission.
 * The governor (`governor/governor.ts`, M11a1) moves `dynamic` between its floor and ceiling through `setDynamic`.
 */
export interface QualityServiceOptions {
  profile: DeviceProfile;
  backend: RenderBackend;
  initial: QualityTierId;
  tiers?: Readonly<Record<QualityTierId, QualityTier>>;
  /** Called when a tier change is applied; the platform persists the decision and resizes the renderer here. */
  apply?: (next: QualityTier, prev: QualityTier, reason: TierDecisionSource) => void | Promise<void>;
  /** Starts with a safe point open (boot). */
  safeAtStart?: boolean;
}

type Listener<A extends unknown[]> = (...args: A) => void;

interface Pending {
  id: QualityTierId;
  reason: TierDecisionSource;
  resolve: () => void;
  reject: (e: unknown) => void;
}

export class QualityServiceImpl implements QualityService {
  readonly profile: DeviceProfile;
  readonly backend: RenderBackend;
  private readonly tiers: Readonly<Record<QualityTierId, QualityTier>>;
  private current: QualityTier;
  private dyn: DynamicQuality;
  private safe: boolean;
  private queue: Pending[] = [];
  private readonly applyFn: NonNullable<QualityServiceOptions['apply']>;
  private readonly tierListeners = new Set<Listener<[QualityTier, QualityTier]>>();
  private readonly dynamicListeners = new Set<Listener<[Readonly<DynamicQuality>]>>();
  private readonly memoryListeners = new Set<Listener<['soft' | 'hard']>>();

  constructor(o: QualityServiceOptions) {
    this.profile = o.profile;
    this.backend = o.backend;
    this.tiers = o.tiers ?? TIERS;
    this.current = this.tiers[o.initial];
    this.dyn = { ...this.current.dynamic.ceil };
    this.safe = o.safeAtStart ?? true;
    this.applyFn = o.apply ?? (() => {});
  }

  get tier(): QualityTier {
    return this.current;
  }

  get dynamic(): Readonly<DynamicQuality> {
    return this.dyn;
  }

  get isSafe(): boolean {
    return this.safe;
  }

  /** Requests waiting for the next safe point. */
  get queued(): number {
    return this.queue.length;
  }

  budgetOf(id: QualityTierId = this.current.id): TierBudget {
    return this.tiers[id].budget;
  }

  /** First id of the tier's `VARIANT_FALLBACK` chain that the asset offers (C07). */
  assetVariant(available: readonly QualityTierId[]): QualityTierId {
    for (const id of VARIANT_FALLBACK[this.current.id]) if (available.includes(id)) return id;
    throw new Error(`no asset variant for tier ${this.current.id}: offered ${available.join(', ') || 'none'}`);
  }

  setTier(id: QualityTierId, reason: TierDecisionSource): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ id, reason, resolve, reject });
      if (this.safe) void this.drain();
    });
  }

  /** Opens or closes a safe point. Opening applies the queued requests in order. */
  setSafePoint(open: boolean): void {
    this.safe = open;
    if (open) void this.drain();
  }

  private draining: Promise<void> | null = null;

  private drain(): Promise<void> {
    // An empty queue (or a closed safe point) has nothing to await, so the `finally` below would run before `draining` is assigned and
    // leave it set for good: no later request would drain (BD-M11a1-02; the safe point now opens and closes during play).
    if (this.draining === null && (!this.safe || this.queue.length === 0)) return Promise.resolve();
    this.draining ??= (async () => {
      try {
        while (this.safe && this.queue.length > 0) {
          const req = this.queue.shift() as Pending;
          try {
            await this.applyNow(req.id, req.reason);
            req.resolve();
          } catch (e) {
            req.reject(e);
          }
        }
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  private async applyNow(id: QualityTierId, reason: TierDecisionSource): Promise<void> {
    const prev = this.current;
    if (prev.id === id) return;
    const next = this.tiers[id];
    this.current = next;
    this.dyn = { ...next.dynamic.ceil };
    await this.applyFn(next, prev, reason);
    for (const fn of [...this.tierListeners]) fn(next, prev);
    for (const fn of [...this.dynamicListeners]) fn(this.dyn);
  }

  onTierChange(fn: (next: QualityTier, prev: QualityTier) => void): () => void {
    this.tierListeners.add(fn);
    return () => this.tierListeners.delete(fn);
  }

  onDynamicChange(fn: (q: Readonly<DynamicQuality>) => void): () => void {
    this.dynamicListeners.add(fn);
    return () => this.dynamicListeners.delete(fn);
  }

  onMemoryPressure(fn: (level: 'soft' | 'hard') => void): () => void {
    this.memoryListeners.add(fn);
    return () => this.memoryListeners.delete(fn);
  }

  /** The MemoryBudget calls this (M11a1). */
  emitMemoryPressure(level: 'soft' | 'hard'): void {
    for (const fn of [...this.memoryListeners]) fn(level);
  }

  /** The governor and the MemoryBudget call this. */
  setDynamic(q: DynamicQuality): void {
    this.dyn = { ...q };
    for (const fn of [...this.dynamicListeners]) fn(this.dyn);
  }
}
