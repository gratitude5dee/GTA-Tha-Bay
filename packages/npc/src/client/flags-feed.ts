import type { RosterFlags } from '@dv/shared';

/**
 * Hands the roster kill flags (route 30, `GET /api/v1/roster`, ETag) to `sim.worker` (M06c): the sim removes a `spawn`-killed NPC from the
 * world and refuses Talk, `ModeContext.npc.isKilled` answers from the same flags. It reads once on start, then every 30 s while the page
 * is visible and when it becomes visible again, and sends the flags only when the ETag changed. The route needs no token. A failed read
 * keeps the last flags (offline play stays as it was).
 */
export interface FlagsFeedOptions {
  /** Origin of the API; empty for the page's own origin. */
  apiBase?: string;
  fetch?: typeof fetch;
  /** Receives flags whose ETag differs from the last one sent. */
  send(flags: RosterFlags): void;
  /** Page visibility; default `document.visibilityState === 'visible'`. */
  visible?: () => boolean;
  intervalMs?: number;
  timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
  /** Registers a callback for the page turning visible; returns the unregister function. */
  onVisible?: (fn: () => void) => () => void;
}

export interface FlagsFeed {
  refresh(): Promise<void>;
  stop(): void;
}

export function startFlagsFeed(o: FlagsFeedOptions): FlagsFeed {
  let etag = '';
  let sent = false;
  const visible = o.visible ?? ((): boolean => typeof document === 'undefined' || document.visibilityState === 'visible');
  const timers = o.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

  async function refresh(): Promise<void> {
    const doFetch = o.fetch ?? fetch;
    try {
      const res = await doFetch(`${o.apiBase ?? ''}/api/v1/roster`, etag === '' ? {} : { headers: { 'If-None-Match': `"${etag}"` } });
      if (res.status !== 200) return;
      const body = (await res.json()) as RosterFlags;
      if (typeof body.etag !== 'string' || typeof body.killed !== 'object' || body.killed === null) return;
      if (sent && body.etag === etag) return;
      etag = body.etag;
      sent = true;
      o.send(body);
    } catch {
      // offline or the Worker is down: the last flags stand
    }
  }

  void refresh();
  const handle = timers.setInterval(() => {
    if (visible()) void refresh();
  }, o.intervalMs ?? 30_000);
  const off = o.onVisible?.(() => void refresh());
  return {
    refresh,
    stop() {
      timers.clearInterval(handle);
      off?.();
    },
  };
}
