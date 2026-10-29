import { stepDownTier, type DynamicQuality, type QualityTier, type QualityTierId, type TierDecisionSource } from '@dv/shared';
import { FrameSignals } from './signals.ts';
import { allAtFloor, applyMove, nextDown, nextUp, type KnobContext, type KnobId } from './knobs.ts';

/**
 * QualityGovernor (11-platform.md section 5.5, P-10). It watches the rendered-frame times and moves the C13 `DynamicQuality` knobs
 * in the fixed order of `knobs.ts`:
 *
 * - downgrade when the p90 of the last 120 frames is above budget x 1.15 for 2 s;
 * - upgrade when it is below budget x 0.70 for 10 s;
 * - at most one change per 5 s and one upgrade per 30 s;
 * - once every knob has sat at its floor for 20 s while the frames are still over, ask for the next tier down, and do it only at a
 *   safe point (`QualityService.setTier` queues until one opens; the governor also holds the request while none is open).
 *
 * Time is the sum of the frame times it was given, so a test (or the QA bridge) can feed it a series and get the same decisions the
 * game would. A frame of 500 ms or more is a stall (a hidden tab, a long task): it clears the window and counts for nothing.
 */
export const DOWNGRADE_RATIO = 1.15;
export const UPGRADE_RATIO = 0.7;
export const DOWNGRADE_AFTER_MS = 2000;
export const UPGRADE_AFTER_MS = 10_000;
export const MIN_CHANGE_GAP_MS = 5000;
export const MIN_UPGRADE_GAP_MS = 30_000;
export const DEMOTE_AFTER_MS = 20_000;
export const STALL_MS = 500;
/** The window needs this many frames before a decision is made. */
export const MIN_FRAMES = 20;
/** XR framebuffer scale steps down by this much per request for the next entry (Quest 1.0 to 0.85). */
export const XR_ENTRY_SCALE_STEP = 0.15;

/** The part of `QualityServiceImpl` the governor uses. */
export interface GovernorQuality {
  readonly tier: QualityTier;
  readonly dynamic: Readonly<DynamicQuality>;
  readonly isSafe: boolean;
  setDynamic(q: DynamicQuality): void;
  setTier(id: QualityTierId, reason: TierDecisionSource): Promise<void>;
  onTierChange(fn: (next: QualityTier, prev: QualityTier) => void): () => void;
}

export interface GovernorOptions {
  quality: GovernorQuality;
  /** False starts it disabled (`?governor=off`). Default true. */
  enabled?: boolean;
  /** `look.json` `postLevelCap`. */
  postLevelCap?: number | null;
  /** A line for the heartbeat trail and the console, one per change. */
  note?: (line: string) => void;
}

export interface GovernorChange {
  knob: KnobId;
  dir: 'down' | 'up';
  from: number;
  to: number;
  /** Governor time, ms. */
  atMs: number;
}

export interface GovernorState {
  enabled: boolean;
  xr: boolean;
  /** Moving average and p90 of the frame time, ms. */
  emaMs: number;
  p90Ms: number;
  windowFrames: number;
  budgetMs: number;
  dynamic: Readonly<DynamicQuality>;
  renderScalePinned: boolean;
  fpsCap: number | null;
  /** Governor time (the sum of the frame times it accepted), ms. */
  timeMs: number;
  changes: number;
  /** Of `changes`, the downgrades and the upgrades. */
  downgrades: number;
  upgrades: number;
  lastChange: GovernorChange | null;
  /** How long every knob has been at its floor, ms (0 while one can still move). */
  atFloorMs: number;
  demotionRequested: boolean;
  /** The framebuffer scale to ask for at the next XR entry (M11b1 consumes it), or null. */
  nextEntryFramebufferScale: number | null;
}

export class QualityGovernor {
  private readonly signals = new FrameSignals();
  private readonly q: GovernorQuality;
  private readonly note: (line: string) => void;
  private enabled_: boolean;
  private xr_ = false;
  private pinned = false;
  private cap: number | null = null;
  private postCap: number | null;
  private live: ReadonlySet<KnobId> | null = null;

  private now = 0;
  private overSince: number | null = null;
  private underSince: number | null = null;
  private floorSince: number | null = null;
  private lastChangeAt = Number.NEGATIVE_INFINITY;
  private lastUpgradeAt = Number.NEGATIVE_INFINITY;
  private changes_ = 0;
  private downs = 0;
  private ups = 0;
  private last: GovernorChange | null = null;
  private demotion = false;
  private entryScale: number | null = null;
  private readonly off: () => void;

  constructor(o: GovernorOptions) {
    this.q = o.quality;
    this.note = o.note ?? (() => {});
    this.enabled_ = o.enabled ?? true;
    this.postCap = o.postLevelCap ?? null;
    this.off = this.q.onTierChange(() => this.onTier());
  }

  get enabled(): boolean {
    return this.enabled_;
  }

  setEnabled(on: boolean): void {
    if (this.enabled_ === on) return;
    this.enabled_ = on;
    this.clearTimers();
  }

  /** An XR session is presenting: the governor never touches `renderScale` and works the XR knobs instead. */
  setXr(on: boolean): void {
    if (this.xr_ === on) return;
    this.xr_ = on;
    this.clearTimers();
  }

  /** The player fixed the render scale (DL-727): the knob is skipped. */
  setRenderScalePinned(on: boolean): void {
    if (this.pinned === on) return;
    this.pinned = on;
    this.clearTimers();
  }

  /** `look.json` `postLevelCap`, once the look is known (levels above it draw the same as the cap). */
  setPostLevelCap(cap: number | null): void {
    this.postCap = cap;
    this.clearTimers();
  }

  /** The knobs something consumes; the governor leaves the others alone. Null (the default) means all ten. */
  setLiveKnobs(knobs: readonly KnobId[] | null): void {
    this.live = knobs === null ? null : new Set(knobs);
    this.clearTimers();
  }

  /** The player's frame cap, 30 or 60, or null for automatic. It lowers the target and is never raised by the governor. */
  setFpsCap(cap: number | null): void {
    if (this.cap === cap) return;
    this.cap = cap;
    this.clearTimers();
  }

  /** Frames per second the display should be rendered at now: the knob, held under the player's cap (XR ignores the cap). */
  targetFps(): number {
    const t = this.q.dynamic.targetFps;
    return this.cap !== null && !this.xr_ ? Math.min(t, this.cap) : t;
  }

  /** The frame time the thresholds are measured against, ms. */
  budgetMs(): number {
    return 1000 / this.targetFps();
  }

  private ctx(): KnobContext {
    return { range: this.q.tier.dynamic, xr: this.xr_, renderScalePinned: this.pinned, fpsCap: this.cap, postLevelCap: this.postCap, live: this.live };
  }

  private clearTimers(): void {
    this.signals.clearWindow();
    this.overSince = null;
    this.underSince = null;
    this.floorSince = null;
  }

  private onTier(): void {
    this.clearTimers();
    this.demotion = false;
    this.lastChangeAt = this.now;
  }

  /** Forgets the window and the clocks (after a hidden tab or a long pause). */
  resetClock(): void {
    this.clearTimers();
  }

  /** Feeds one rendered frame time, ms. Does nothing while disabled. */
  frame(ms: number): void {
    if (!this.enabled_ || !Number.isFinite(ms) || ms <= 0) return;
    if (ms >= STALL_MS) {
      this.clearTimers();
      return;
    }
    this.now += ms;
    this.signals.push(ms);
    const budget = this.budgetMs();
    const p90 = this.signals.p90();
    const over = p90 > budget * DOWNGRADE_RATIO;
    const under = p90 < budget * UPGRADE_RATIO;
    this.overSince = over ? (this.overSince ?? this.now - ms) : null;
    this.underSince = under ? (this.underSince ?? this.now - ms) : null;

    const ctx = this.ctx();
    const dyn = this.q.dynamic as DynamicQuality;
    const floored = allAtFloor(dyn, ctx);
    this.floorSince = floored ? (this.floorSince ?? this.now) : null;

    if (this.signals.count < MIN_FRAMES) return;
    const sinceChange = this.now - this.lastChangeAt;
    if (over && this.overSince !== null && this.now - this.overSince >= DOWNGRADE_AFTER_MS) {
      if (floored) {
        this.maybeDemote(ctx);
      } else if (sinceChange >= MIN_CHANGE_GAP_MS) {
        this.downgrade(ctx);
      }
      return;
    }
    if (under && this.underSince !== null && this.now - this.underSince >= UPGRADE_AFTER_MS && sinceChange >= MIN_CHANGE_GAP_MS && this.now - this.lastUpgradeAt >= MIN_UPGRADE_GAP_MS) {
      this.upgrade(ctx);
    }
  }

  /** QA: feeds a series of frame times as if they were rendered one after the other. */
  inject(frameMs: readonly number[]): void {
    for (const ms of frameMs) this.frame(ms);
  }

  private downgrade(ctx: KnobContext): void {
    const dyn = this.q.dynamic as DynamicQuality;
    // In XR the render scale cannot change mid-session: a sustained miss asks for a lower framebuffer scale at the next entry instead.
    if (this.xr_) this.requestEntryScale();
    const move = nextDown(dyn, ctx);
    if (!move) return;
    this.commit(applyMove(dyn, move), { knob: move.knob, dir: 'down', from: move.from, to: move.to, atMs: this.now });
  }

  private upgrade(ctx: KnobContext): void {
    const dyn = this.q.dynamic as DynamicQuality;
    const move = nextUp(dyn, ctx);
    if (!move) return;
    this.lastUpgradeAt = this.now;
    this.commit(applyMove(dyn, move), { knob: move.knob, dir: 'up', from: move.from, to: move.to, atMs: this.now });
  }

  private requestEntryScale(): void {
    const xr = this.q.tier.xr;
    if (!xr) return;
    const cur = this.entryScale ?? xr.framebufferScale;
    const next = Math.max(xr.framebufferScaleNextEntryFloor, Math.round((cur - XR_ENTRY_SCALE_STEP) * 100) / 100);
    if (next < cur) {
      this.entryScale = next;
      this.note(`governor next-entry framebufferScale ${next}`);
    }
  }

  private commit(next: DynamicQuality, change: GovernorChange): void {
    // The state is final before the listeners hear of it, so an onDynamicChange handler reads the change that caused it.
    this.changes_ += 1;
    if (change.dir === 'down') this.downs += 1;
    else this.ups += 1;
    this.last = change;
    this.lastChangeAt = this.now;
    this.clearTimers();
    this.q.setDynamic(next);
    this.note(`governor ${change.dir} ${change.knob} ${change.from}>${change.to}`);
  }

  /** Every knob has been at its floor and the frames are still over: after 20 s ask for the next tier down, at a safe point. */
  private maybeDemote(ctx: KnobContext): void {
    if (this.demotion || this.floorSince === null || this.now - this.floorSince < DEMOTE_AFTER_MS || !this.q.isSafe) return;
    if (ctx.xr) return;
    const next = stepDownTier(this.q.tier.id);
    if (next === null) return;
    this.demotion = true;
    this.note(`governor demotion ${this.q.tier.id}>${next}`);
    this.q.setTier(next, 'governor-demotion').catch(() => {
      this.demotion = false;
    });
  }

  state(): GovernorState {
    return {
      enabled: this.enabled_,
      xr: this.xr_,
      emaMs: Math.round(this.signals.ema * 100) / 100,
      p90Ms: Math.round(this.signals.p90() * 100) / 100,
      windowFrames: this.signals.count,
      budgetMs: Math.round(this.budgetMs() * 100) / 100,
      dynamic: this.q.dynamic,
      renderScalePinned: this.pinned,
      fpsCap: this.cap,
      timeMs: Math.round(this.now),
      changes: this.changes_,
      downgrades: this.downs,
      upgrades: this.ups,
      lastChange: this.last,
      atFloorMs: this.floorSince === null ? 0 : Math.round(this.now - this.floorSince),
      demotionRequested: this.demotion,
      nextEntryFramebufferScale: this.entryScale,
    };
  }

  dispose(): void {
    this.off();
  }
}
