/**
 * Screen wake lock while a clip covers the screen on mobile tiers (11-platform-pwa.md section 7). Re-requested when the page becomes
 * visible again, because the browser releases the lock when the page is hidden. An absent API warns once and never throws.
 */

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', l: () => void): void;
}
export interface WakeLockNavigator { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }
export interface VisibilityDocument {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', l: () => void): void;
  removeEventListener(type: 'visibilitychange', l: () => void): void;
}

export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private warned = false;
  private requests = 0;

  constructor(
    private readonly nav: WakeLockNavigator,
    private readonly doc: VisibilityDocument,
    private readonly warn: (msg: string) => void = (m) => console.warn(m),
  ) {
    this.onVisible = this.onVisible.bind(this);
  }

  /** True while a sentinel is held. */
  get held(): boolean {
    return this.sentinel !== null;
  }

  /** How many `request('screen')` calls were made (tests, device notes). */
  get requestCount(): number {
    return this.requests;
  }

  async acquire(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    this.doc.addEventListener('visibilitychange', this.onVisible);
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    const s = this.sentinel;
    this.sentinel = null;
    if (s) {
      try {
        await s.release();
      } catch {
        // already released by the browser
      }
    }
  }

  private async request(): Promise<void> {
    const api = this.nav.wakeLock;
    if (!api) {
      if (!this.warned) {
        this.warned = true;
        this.warn('wake lock: navigator.wakeLock is not available; the screen may sleep during a cutscene');
      }
      return;
    }
    try {
      this.requests++;
      const s = await api.request('screen');
      if (!this.wanted) {
        await s.release().catch(() => undefined);
        return;
      }
      this.sentinel = s;
      s.addEventListener?.('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        this.warn(`wake lock: request refused (${(e as { name?: string } | null)?.name ?? 'Error'})`);
      }
    }
  }

  private onVisible(): void {
    if (this.wanted && this.doc.visibilityState === 'visible' && this.sentinel === null) void this.request();
  }
}
