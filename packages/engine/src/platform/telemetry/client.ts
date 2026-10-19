import {
  CLIENT_TELEMETRY_NAMES,
  TELEMETRY_LIMITS,
  type TelemetryBatch,
  type TelemetryEnvelope,
  type TelemetryEvent,
  type TelemetryName,
} from '@dv/shared';

/**
 * Telemetry client (11-platform-pwa.md section 9, C16 1.1). Batches at most 50 events and 64 KiB to `POST /api/v1/t` with the
 * C16 envelope; `sendBeacon` on `hidden` and `pagehide`. Consent comes from `PlatformSettings` (both toggles default on,
 * DL-140): an event whose class is switched off is dropped here, before it is queued. No user agent, IP, profile id or free text
 * is sent; the envelope carries tier, device class, OS major, display mode and backend only.
 */
export type TelemetryProps = Record<string, string | number | boolean>;

export interface HeartbeatSink {
  patch(p: Record<string, unknown>): void;
}

export interface Telemetry {
  emit(name: TelemetryName, props?: TelemetryProps): void;
  heartbeat(patch: Record<string, unknown>): void;
  setConsent(c: { diagnostics: boolean; analytics: boolean }): void;
  flush(reason: 'hidden' | 'pagehide' | 'interval'): void;
}

const MAX_SCRUBBED_CHARS = 512;
const ENCODER = new TextEncoder();

/** C16 privacy scrub (mirrors services/edge/src/scrub.ts): bearer tokens, emails, query strings, long hex and base64 runs. */
export function scrub(input: string): string {
  return input
    .replace(/\bBearer\s+\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/\?[^\s#"']*/g, '')
    .replace(/\b[0-9a-fA-F]{24,}\b/g, '[redacted]')
    .replace(/[A-Za-z0-9+/]{24,}={0,2}/g, '[redacted]')
    .slice(0, MAX_SCRUBBED_CHARS);
}

/** Events about the app's health and performance. Everything else (gameplay, UI funnels) is analytics. */
const DIAGNOSTIC = /^(app|err|perf|tier|storage|xr|settings|pwa|net|world)\./;
const ALLOWED: ReadonlySet<string> = new Set(CLIENT_TELEMETRY_NAMES);

export function isDiagnostic(name: string): boolean {
  return DIAGNOSTIC.test(name);
}

/** OS major version from a UA string (iOS, Android, macOS, Windows); 0 when unknown. The UA itself is never sent. */
export function osMajorOf(userAgent: string): number {
  const ios = /\b(?:iPhone )?OS (\d+)[_.]/.exec(userAgent);
  if (ios && /iPhone|iPad|iPod/.test(userAgent)) return Number(ios[1]);
  const android = /Android (\d+)/.exec(userAgent);
  if (android) return Number(android[1]);
  const mac = /Mac OS X (\d+)[_.]/.exec(userAgent);
  if (mac) return Number(mac[1]);
  const win = /Windows NT (\d+)/.exec(userAgent);
  if (win) return Number(win[1]);
  return 0;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

const GLOBAL_TIMERS: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as number),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as number),
};

export interface TelemetryClientOptions {
  build: string;
  sessionId: string;
  env: () => TelemetryEnvelope;
  consent?: { diagnostics: boolean; analytics: boolean };
  now?: () => number;
  /** Transport. Return value ignored; failures drop the batch (telemetry is best effort). */
  send?: (body: string, viaBeacon: boolean) => void;
  intervalMs?: number;
  timers?: TimerApi;
  endpoint?: string;
}

function defaultSend(endpoint: string): (body: string, viaBeacon: boolean) => void {
  return (body, viaBeacon) => {
    try {
      if (viaBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return;
      }
      void fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch {
      // Telemetry never throws into the app.
    }
  };
}

export class TelemetryClient implements Telemetry {
  readonly sessionId: string;
  private readonly o: TelemetryClientOptions;
  private readonly timers: TimerApi;
  private readonly sendBody: (body: string, viaBeacon: boolean) => void;
  private queue: TelemetryEvent[] = [];
  private seq = 0;
  private consent: { diagnostics: boolean; analytics: boolean };
  private sink: HeartbeatSink | null = null;
  private interval: unknown = null;
  private soon: unknown = null;
  /** Number of batches handed to the transport. */
  batches = 0;

  constructor(o: TelemetryClientOptions) {
    this.o = o;
    this.sessionId = o.sessionId;
    this.timers = o.timers ?? GLOBAL_TIMERS;
    this.consent = o.consent ?? { diagnostics: true, analytics: true };
    this.sendBody = o.send ?? defaultSend(o.endpoint ?? '/api/v1/t');
  }

  attachHeartbeat(sink: HeartbeatSink): void {
    this.sink = sink;
  }

  heartbeat(patch: Record<string, unknown>): void {
    this.sink?.patch(patch);
  }

  setConsent(c: { diagnostics: boolean; analytics: boolean }): void {
    this.consent = { ...c };
    // Withdrawn consent also drops what is already queued for that class.
    this.queue = this.queue.filter((e) => (isDiagnostic(e.name) ? c.diagnostics : c.analytics));
  }

  /** Starts the interval flush. */
  start(): void {
    if (this.interval !== null) return;
    this.interval = this.timers.setInterval(() => this.flush('interval'), this.o.intervalMs ?? 10_000);
  }

  stop(): void {
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    if (this.soon !== null) this.timers.clearTimeout(this.soon);
    this.interval = null;
    this.soon = null;
  }

  get pending(): number {
    return this.queue.length;
  }

  emit(name: TelemetryName, props: TelemetryProps = {}): void {
    if (!ALLOWED.has(name)) return;
    if (!(isDiagnostic(name) ? this.consent.diagnostics : this.consent.analytics)) return;
    const clean: TelemetryProps = {};
    let keys = 0;
    for (const [k, v] of Object.entries(props)) {
      if (keys >= TELEMETRY_LIMITS.maxPropKeys) break;
      keys += 1;
      clean[k] = typeof v === 'string' ? scrub(v).slice(0, TELEMETRY_LIMITS.maxStringChars) : v;
    }
    this.queue.push({ name, ts: (this.o.now ?? Date.now)(), sessionId: this.sessionId, props: clean });
    if (this.queue.length >= TELEMETRY_LIMITS.maxEvents) this.flush('interval');
  }

  /** Flush shortly (200 ms) so events emitted back to back go out in one batch. */
  flushSoon(): void {
    if (this.soon !== null) return;
    this.soon = this.timers.setTimeout(() => {
      this.soon = null;
      this.flush('interval');
    }, 200);
  }

  flush(reason: 'hidden' | 'pagehide' | 'interval'): void {
    const beacon = reason !== 'interval';
    while (this.queue.length > 0) {
      const events: TelemetryEvent[] = [];
      let body = '';
      while (this.queue.length > 0 && events.length < TELEMETRY_LIMITS.maxEvents) {
        const next = this.queue[0] as TelemetryEvent;
        const trial: TelemetryBatch = { v: 1, build: this.o.build, seq0: this.seq, env: this.o.env(), events: [...events, next] };
        const text = JSON.stringify(trial);
        if (ENCODER.encode(text).length > TELEMETRY_LIMITS.maxBodyBytes) {
          if (events.length === 0) this.queue.shift();
          break;
        }
        events.push(next);
        body = text;
        this.queue.shift();
      }
      if (events.length === 0) continue;
      this.seq += events.length;
      this.batches += 1;
      this.sendBody(body, beacon);
    }
  }
}
