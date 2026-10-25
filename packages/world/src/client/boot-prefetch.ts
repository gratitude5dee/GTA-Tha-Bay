/**
 * Boot prefetch (M02f2): the speculative part of the boot set (the `p0` and `l0` rings beyond `critical`, then `l1`, `l2` and `far`)
 * downloads at idle priority while the player is on the Title or the main menu, and the part still queued is promoted when a mode
 * starts. Nothing speculative starts before the world is revealed, so the cold-boot download budget is untouched.
 *
 * The plan and the gate are pure; `BootPrefetch` is the page-side controller that runs them against an `AssetClient`.
 */
import type { AssetClient } from '@dv/engine/assets/client';
import { DOWNLOAD_ALL_QUOTA_FACTOR } from '@dv/engine/assets/quota';
import type { PackRef } from '@dv/engine/assets/types';
import type { BootSet } from '../sim/streaming/boot.ts';

export interface BootPrefetchPlan {
  /** The rings the first minutes need: `p0` then `l0` beyond `critical`, in `bootSet` order. */
  now: string[];
  /** The wider set: `l1`, `l2`, then `far`. */
  soon: string[];
}

/** What `prepareWorld` already demands (`critical`) is never planned; both lists are free of duplicates and of each other's refs. */
export function planBootPrefetch(set: BootSet): BootPrefetchPlan {
  const taken = new Set(set.critical);
  const take = (list: readonly string[]): string[] => {
    const out: string[] = [];
    for (const ref of list) {
      if (taken.has(ref)) continue;
      taken.add(ref);
      out.push(ref);
    }
    return out;
  };
  const now = take([...set.p0, ...set.l0]);
  const soon = take([...set.l1, ...set.l2, ...set.far]);
  return { now, soon };
}

export type PrefetchSkip = 'save-data' | 'quota' | 'memory' | 'read-only';

export interface PrefetchGateInput {
  /** `navigator.connection.saveData === true`. */
  saveData: boolean;
  /** `navigator.storage.estimate()`; null when the browser gives none. */
  estimate: { usage: number; quota: number } | null;
  /** Bytes of the planned packs that the store does not hold yet. */
  needBytes: number;
  storeKind: 'opfs' | 'memory-fallback';
  mode: 'rw' | 'read-only';
}

/**
 * Whether the speculative download is skipped, and why. A second tab never writes the store; the 48 MB memory fallback has no room for
 * speculation; a Save-Data hint asks for no extra transfer; free quota must cover 1.2 x the missing bytes (the rule of the offline
 * download). Without an estimate nothing is skipped on quota.
 */
export function prefetchGate(i: PrefetchGateInput): PrefetchSkip | null {
  if (i.mode === 'read-only') return 'read-only';
  if (i.storeKind === 'memory-fallback') return 'memory';
  if (i.saveData) return 'save-data';
  if (i.estimate && i.estimate.quota - i.estimate.usage < DOWNLOAD_ALL_QUOTA_FACTOR * i.needBytes) return 'quota';
  return null;
}

/** The Save-Data hint, feature-detected: only an explicit `true` counts. Which browsers expose it is U-W17. */
export function readSaveData(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  try {
    return (nav as { connection?: { saveData?: unknown } } | undefined)?.connection?.saveData === true;
  } catch {
    return false;
  }
}

async function readEstimate(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await (nav as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } } | undefined)?.storage?.estimate?.();
    if (est && typeof est.usage === 'number' && typeof est.quota === 'number' && est.quota > 0) return { usage: est.usage, quota: est.quota };
    return null;
  } catch {
    return null;
  }
}

export type PrefetchState = 'waiting' | 'running' | 'skipped' | 'direct' | 'off';

export interface PrefetchReport {
  /**
   * `waiting` before the reveal; `running` while the idle download is queued or under way; `skipped` when the gate said no (see
   * `skipped`); `direct` when the shell was already in play at the reveal and the whole plan went at `soon`; `off` for `?prefetch=0`.
   */
  state: PrefetchState;
  skipped: PrefetchSkip | null;
  /** Planned refs (`now` plus `soon`). */
  planned: number;
  missingAtStart: number;
  needBytes: number;
  /** Refs handed to the asset worker's `prefetch` (0 when skipped, off or still waiting). */
  sent: number;
  /** `performance.now()` when the download was queued; null before. */
  startedMs: number | null;
  /** Sum of what the two `promote` calls reported moving. */
  promoted: number;
  /** `performance.now()` of the mode start that promoted; null before. */
  promotedMs: number | null;
  /** From the mode start to the first `play(true)` after it; null before. */
  startToPlayMs: number | null;
}

/** The part of `AssetClient` the controller uses, so a test can pass a fake. */
export type PrefetchAssets = Pick<AssetClient, 'prefetch' | 'promote' | 'resolve' | 'has' | 'storeKind' | 'mode'>;

export interface BootPrefetchOptions {
  assets: PrefetchAssets;
  set: BootSet;
  /** False for `?prefetch=0` (QA builds): nothing speculative is requested at all. */
  enabled?: boolean;
  /** True while the shell is not in play (Title, menu, a page over them). */
  menu: () => boolean;
  now?: () => number;
  saveData?: () => boolean;
  estimate?: () => Promise<{ usage: number; quota: number } | null>;
}

export class BootPrefetch {
  private readonly o: BootPrefetchOptions;
  private readonly plan: BootPrefetchPlan;
  private readonly now: () => number;
  private stateValue: PrefetchState = 'waiting';
  private skippedValue: PrefetchSkip | null = null;
  private missing: { now: string[]; soon: string[] } = { now: [], soon: [] };
  private missingAtStart = 0;
  private needBytes = 0;
  private sent = 0;
  private startedMs: number | null = null;
  private promoted = 0;
  private promotedMs: number | null = null;
  private modeStartMs: number | null = null;
  private startToPlayMs: number | null = null;
  private starting = false;
  private promoteDone = false;
  /** A mode started while the figures were still being read: the promotion runs as soon as the download is queued. */
  private promoteAsked = false;

  constructor(o: BootPrefetchOptions) {
    this.o = o;
    this.plan = planBootPrefetch(o.set);
    this.now = o.now ?? ((): number => performance.now());
    if (o.enabled === false) this.stateValue = 'off';
  }

  get state(): PrefetchState {
    return this.stateValue;
  }

  /** The planned refs (QA bridge and tests). */
  get planned(): BootPrefetchPlan {
    return { now: [...this.plan.now], soon: [...this.plan.soon] };
  }

  /**
   * Called once at the world reveal. While the shell is in a menu: reads the Save-Data hint, the storage estimate, the store kind and the
   * tab mode, applies the gate and queues the plan at `idle`. Past the menu (the QA play bypass, or play started first): queues the plan
   * at `soon`, once. Never throws; a failed download is a miss the streamer will demand later.
   */
  async start(): Promise<void> {
    if (this.stateValue !== 'waiting' || this.starting) return;
    this.starting = true;
    const { now, soon } = this.plan;
    try {
      if (!this.o.menu()) {
        this.stateValue = 'direct';
        this.startedMs = this.now();
        this.missing = { now, soon };
        this.missingAtStart = now.length + soon.length;
        this.sent = now.length + soon.length;
        await this.o.assets.prefetch([...now, ...soon], 'soon');
        return;
      }
      const gate = await this.measure();
      // The shell may have moved on while the figures were read.
      if (!this.o.menu()) {
        this.stateValue = 'direct';
        this.startedMs = this.now();
        this.missing = { now, soon };
        this.missingAtStart = now.length + soon.length;
        this.sent = now.length + soon.length;
        await this.o.assets.prefetch([...now, ...soon], 'soon');
        return;
      }
      if (gate !== null) {
        this.stateValue = 'skipped';
        this.skippedValue = gate;
        return;
      }
      this.stateValue = 'running';
      this.startedMs = this.now();
      const queue = [...this.missing.now, ...this.missing.soon];
      this.sent = queue.length;
      if (queue.length > 0) await this.o.assets.prefetch(queue, 'idle');
      if (this.promoteAsked) await this.promote();
    } catch {
      /* the worker is gone or the catalog is not ready: the streamer demands what it needs */
    } finally {
      this.starting = false;
    }
  }

  /** Resolves the planned refs, finds what is missing and applies the gate. */
  private async measure(): Promise<PrefetchSkip | null> {
    const { assets } = this.o;
    const lookup = async (list: string[]): Promise<{ miss: string[]; bytes: number }> => {
      const refs: Array<PackRef | null> = await Promise.all(list.map((a) => assets.resolve(a).catch(() => null)));
      const have = await Promise.all(refs.map((r) => (r ? assets.has(r).catch(() => false) : Promise.resolve(true))));
      const miss: string[] = [];
      let bytes = 0;
      list.forEach((a, i) => {
        const r = refs[i];
        if (r && !have[i]) {
          miss.push(a);
          bytes += r.bytes;
        }
      });
      return { miss, bytes };
    };
    const [n, s] = await Promise.all([lookup(this.plan.now), lookup(this.plan.soon)]);
    this.missing = { now: n.miss, soon: s.miss };
    this.missingAtStart = n.miss.length + s.miss.length;
    this.needBytes = n.bytes + s.bytes;
    const estimate = await (this.o.estimate ?? readEstimate)();
    return prefetchGate({
      saveData: (this.o.saveData ?? readSaveData)(),
      estimate,
      needBytes: this.needBytes,
      storeKind: assets.storeKind,
      mode: assets.mode,
    });
  }

  /**
   * Called when a mode starts. Moves what is still queued up: the rings to `now`, `l1`, `l2` and `far` to `soon`. Runs once per page
   * session; a return to the menu demotes nothing. Does nothing unless the idle download is running.
   */
  async promote(): Promise<number> {
    this.modeStartMs ??= this.now();
    if (this.stateValue === 'waiting') this.promoteAsked = true;
    if (this.stateValue !== 'running' || this.promoteDone) return 0;
    this.promoteDone = true;
    this.promotedMs = this.now();
    try {
      const a = this.missing.now.length > 0 ? await this.o.assets.promote(this.missing.now, 'now') : 0;
      const b = this.missing.soon.length > 0 ? await this.o.assets.promote(this.missing.soon, 'soon') : 0;
      this.promoted += a + b;
    } catch {
      /* promotion is an optimisation */
    }
    return this.promoted;
  }

  /** Records the first `play(true)` after the mode start (the end of `startToPlayMs`). */
  markPlay(): void {
    if (this.startToPlayMs !== null || this.modeStartMs === null) return;
    this.startToPlayMs = Math.max(0, Math.round(this.now() - this.modeStartMs));
  }

  report(): PrefetchReport {
    return {
      state: this.stateValue,
      skipped: this.skippedValue,
      planned: this.plan.now.length + this.plan.soon.length,
      missingAtStart: this.missingAtStart,
      needBytes: this.needBytes,
      sent: this.sent,
      startedMs: this.startedMs === null ? null : Math.round(this.startedMs),
      promoted: this.promoted,
      promotedMs: this.promotedMs === null ? null : Math.round(this.promotedMs),
      startToPlayMs: this.startToPlayMs,
    };
  }
}
