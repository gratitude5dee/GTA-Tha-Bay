import type { NpcIntent, NPCIntentRequest, NPCIntentResponse } from '@dv/shared/contracts/c10-npc';
import { validateNpcIntent } from '@dv/shared/npc';
import { BRAIN_CONFIG } from '../brains/config.ts';

/**
 * The client intent driver (04-npc-builder.md section C8; M06c). It lives on the page, outside `sim/`: the sim writes an `NPCIntentRequest`
 * for a hero and publishes it on the view-model key `sys.npc.intents`; this driver decides whether to send it to route 32, and hands the
 * answer back to `sim.worker` as a `mode.cmd` of the reserved owner `npc` (the sim records it with `TimelineRecorder.external`, so a replay
 * reads the recording and never asks again).
 *
 * Throttles, from `config/npc.json`: at least 60 s between two requests for one NPC, one request in flight, six requests a minute for the
 * client. No request at all while the browser is offline or on a tier that turns intents off (`mobile-low`), or without a play token.
 * Whatever goes wrong - the network, a status, an answer that is not an intent - the NPC simply keeps to its schedule.
 */
export type IntentDrop = 'stale' | 'offline' | 'tier' | 'no_auth' | 'npc_gap' | 'in_flight' | 'rate';

export type IntentOutcome =
  | { sent: false; drop: IntentDrop }
  | { sent: true; result: 'applied' | 'default' | 'cache' | 'failed' };

export interface IntentMessage {
  rid: number;
  req: NPCIntentRequest;
}

export interface IntentDriverOptions {
  /** Origin of the API; empty for the page's own origin. */
  apiBase?: string;
  fetch?: typeof fetch;
  /** The play-token header, or null when the player has none. */
  auth: () => Promise<{ Authorization: string } | null>;
  /** Milliseconds; default `Date.now` (page code, not sim code). */
  now?: () => number;
  /** `navigator.onLine`. */
  online: () => boolean;
  /** The quality tier id (`mobile-low` turns intents off). */
  tier: () => string;
  /** Hands an answer to the sim: `sendUi({ t: 'mode.cmd', mode: 'npc', name: 'intent', args })`. */
  deliver(npcId: string, intent: NpcIntent, rid: number): void;
  /** Overrides the config (tests). */
  limits?: Partial<{ gapMs: number; perMinute: number; inFlight: number; timeoutMs: number; offTiers: readonly string[] }>;
}

export class IntentDriver {
  private readonly o: IntentDriverOptions;
  private lastRid = 0;
  private inFlight = 0;
  private readonly lastSent = new Map<string, number>();
  private window: number[] = [];
  /** Counters for the QA panel and the tests. */
  readonly stats = { offered: 0, sent: 0, applied: 0, dropped: 0, failed: 0 };
  readonly drops: Record<IntentDrop, number> = { stale: 0, offline: 0, tier: 0, no_auth: 0, npc_gap: 0, in_flight: 0, rate: 0 };

  constructor(options: IntentDriverOptions) {
    this.o = options;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private limit<K extends 'gapMs' | 'perMinute' | 'inFlight' | 'timeoutMs'>(k: K): number {
    const t = BRAIN_CONFIG.throttles;
    const def = { gapMs: t.intentMinSecondsPerNpc * 1000, perMinute: t.intentMaxPerMinute, inFlight: t.intentMaxInFlight, timeoutMs: BRAIN_CONFIG.intent.clientTimeoutMs };
    return this.o.limits?.[k] ?? def[k];
  }

  private drop(d: IntentDrop): IntentOutcome {
    this.drops[d]++;
    this.stats.dropped++;
    return { sent: false, drop: d };
  }

  /** A request the sim published. Resolves when the request was dropped or has been answered. */
  async offer(msg: IntentMessage): Promise<IntentOutcome> {
    this.stats.offered++;
    if (msg.rid <= this.lastRid) return this.drop('stale');
    this.lastRid = msg.rid;
    if (!this.o.online()) return this.drop('offline');
    const offTiers = this.o.limits?.offTiers ?? BRAIN_CONFIG.intent.offTiers;
    if (offTiers.includes(this.o.tier())) return this.drop('tier');
    const t = this.now();
    const npcId = msg.req.npcId;
    const last = this.lastSent.get(npcId);
    if (last !== undefined && t - last < this.limit('gapMs')) return this.drop('npc_gap');
    if (this.inFlight >= this.limit('inFlight')) return this.drop('in_flight');
    this.window = this.window.filter((s) => t - s < 60_000);
    if (this.window.length >= this.limit('perMinute')) return this.drop('rate');

    // Reserve the slot before the first await: a second offer in the same turn of the event loop sees it taken.
    this.inFlight++;
    this.lastSent.set(npcId, t);
    this.window.push(t);
    this.stats.sent++;
    try {
      const auth = await this.o.auth().catch(() => null);
      if (auth === null) {
        // nothing left the device: give the slot back
        this.lastSent.delete(npcId);
        this.window.pop();
        this.stats.sent--;
        return this.drop('no_auth');
      }
      return { sent: true, result: await this.post(msg, auth) };
    } finally {
      this.inFlight--;
    }
  }

  private async post(msg: IntentMessage, auth: { Authorization: string }): Promise<'applied' | 'default' | 'cache' | 'failed'> {
    const doFetch = this.o.fetch ?? fetch;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.limit('timeoutMs'));
    try {
      const res = await doFetch(`${this.o.apiBase ?? ''}/api/v1/npc/${encodeURIComponent(msg.req.npcId)}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...auth },
        body: JSON.stringify(msg.req),
        signal: ac.signal,
      });
      if (!res.ok) {
        this.stats.failed++;
        return 'failed';
      }
      const body = (await res.json()) as Partial<NPCIntentResponse>;
      if (body.intent === undefined || validateNpcIntent(body.intent).length > 0) {
        this.stats.failed++;
        return 'failed';
      }
      // The server's own fallback needs no round trip through the sim: the NPC is already on its schedule.
      if (body.source === 'default') return 'default';
      this.o.deliver(msg.req.npcId, body.intent, msg.rid);
      this.stats.applied++;
      return body.source === 'cache' ? 'cache' : 'applied';
    } catch {
      this.stats.failed++;
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The view-model key the sim publishes requests on, and the shape of its value. */
export const INTENT_VM_KEY = 'sys.npc.intents' as const;

/** Wires the driver to the view model: every published request is offered once. */
export function attachIntentDriver(
  vm: { subscribe(key: typeof INTENT_VM_KEY, cb: (v: unknown) => void): () => void },
  driver: IntentDriver,
): () => void {
  return vm.subscribe(INTENT_VM_KEY, (v) => {
    const m = v as Partial<IntentMessage> | undefined;
    if (m && typeof m.rid === 'number' && m.req && typeof m.req.npcId === 'string') void driver.offer(m as IntentMessage);
  });
}
