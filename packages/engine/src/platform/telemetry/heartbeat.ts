import type { QualityTierId, RenderBackend } from '@dv/shared';
import type { HeartbeatSink, TimerApi } from './client.ts';

/**
 * Heartbeat and abnormal-exit detection (11-platform-pwa.md section 9; R-PLAT-01). iOS gives no crash reports, so the page
 * writes `localStorage['dv.hb']` every 5 s while visible. At the next boot a `running` record means the page died without a
 * lifecycle event (`app.abnormal_exit`); a `hidden` record is a normal background kill (`app.cold_resume`). The record is
 * always written locally; it is sent only with Diagnostics consent (the telemetry client drops the event otherwise).
 */
export interface HeartbeatRecord {
  v: 1;
  sid: string;
  t: number;
  state: 'running' | 'hidden' | 'closed';
  scene: string;
  mode: string;
  chunkKey: string | null;
  tier: QualityTierId;
  backend: RenderBackend;
  memEstMB: number;
  gpuEstMB: number;
  build: string;
  /** At most 20 events; the whole record stays under 4 KB. */
  ring: string[];
}

export const HB_KEY = 'dv.hb';
/** Abnormal exits of the last 24 h, for the demotion rule. */
export const HB_EXITS_KEY = 'dv.hb.exits';
const MAX_RING = 20;
const MAX_RECORD_BYTES = 4096;
export const DEMOTION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BEAT_MS = 5000;
/** A demotion needs memEstMB above this share of (maxAccountedHeapMB + maxGpuResourceMB). */
export const DEMOTION_MEM_SHARE = 0.8;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Emits telemetry events; `TelemetryClient.emit` satisfies it. */
export interface HeartbeatEmitter {
  emit(name: 'app.abnormal_exit' | 'app.cold_resume', props?: Record<string, string | number | boolean>): void;
}

export interface MemoryReading {
  memEstMB: number;
  gpuEstMB: number;
}

export interface HeartbeatOptions {
  storage: KeyValueStorage | null;
  sid: string;
  build: string;
  now: () => number;
  timers: TimerApi;
  emitter?: HeartbeatEmitter;
  /** Accounted-heap and GPU caps of a tier, for the demotion threshold. */
  capsOf: (tier: QualityTierId) => { maxAccountedHeapMB: number; maxGpuResourceMB: number };
  /** Current memory estimates, read on every beat. */
  memory?: () => MemoryReading;
}

export type BootKind = 'first' | 'abnormal_exit' | 'cold_resume' | 'clean';
export interface BootAnalysis {
  kind: BootKind;
  previous: HeartbeatRecord | null;
  /** The tier to demote from (one rung down), when the rule fired at this boot. */
  demoteFrom: QualityTierId | null;
}

interface ExitEntry {
  t: number;
  tier: QualityTierId;
  memEstMB: number;
}

function parseRecord(raw: string | null): HeartbeatRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<HeartbeatRecord>;
    if (r.v !== 1 || typeof r.sid !== 'string' || typeof r.t !== 'number') return null;
    if (r.state !== 'running' && r.state !== 'hidden' && r.state !== 'closed') return null;
    return r as HeartbeatRecord;
  } catch {
    return null;
  }
}

function parseExits(raw: string | null): ExitEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is ExitEntry =>
        typeof e === 'object' && e !== null && typeof (e as ExitEntry).t === 'number' && typeof (e as ExitEntry).tier === 'string' && typeof (e as ExitEntry).memEstMB === 'number',
    );
  } catch {
    return [];
  }
}

export class Heartbeat implements HeartbeatSink {
  private readonly o: HeartbeatOptions;
  private rec: HeartbeatRecord;
  private timer: unknown = null;
  private visible = true;

  constructor(o: HeartbeatOptions) {
    this.o = o;
    this.rec = {
      v: 1,
      sid: o.sid,
      t: o.now(),
      state: 'running',
      scene: 'boot',
      mode: 'none',
      chunkKey: null,
      tier: 'desktop',
      backend: 'webgl2',
      memEstMB: 0,
      gpuEstMB: 0,
      build: o.build,
      ring: [],
    };
  }

  get record(): Readonly<HeartbeatRecord> {
    return this.rec;
  }

  /**
   * Reads the previous session's record (synchronously, before this session writes its own), emits `app.abnormal_exit` or
   * `app.cold_resume`, and applies the demotion rule. Call once per boot, before `start()`.
   */
  analyzePrevious(): BootAnalysis {
    const prev = this.read();
    if (!prev) return { kind: 'first', previous: null, demoteFrom: null };
    if (prev.state === 'hidden') {
      this.o.emitter?.emit('app.cold_resume');
      return { kind: 'cold_resume', previous: prev, demoteFrom: null };
    }
    if (prev.state === 'closed') return { kind: 'clean', previous: prev, demoteFrom: null };
    // `running`: the page died without a lifecycle event.
    const now = this.o.now();
    this.o.emitter?.emit('app.abnormal_exit', {
      prevSid: prev.sid.slice(0, 64),
      lastBeatAgoMs: Math.max(0, Math.round(now - prev.t)),
      scene: prev.scene.slice(0, 64),
      mode: prev.mode.slice(0, 64),
      chunkKey: (prev.chunkKey ?? '').slice(0, 64),
      memEstMB: Math.round(prev.memEstMB),
      gpuEstMB: Math.round(prev.gpuEstMB),
    });
    return { kind: 'abnormal_exit', previous: prev, demoteFrom: this.recordExit(prev, now) };
  }

  /** Logs an abnormal exit; returns the tier to demote when two qualifying exits sit within 24 h on that tier. */
  private recordExit(prev: HeartbeatRecord, now: number): QualityTierId | null {
    const caps = this.o.capsOf(prev.tier);
    const threshold = DEMOTION_MEM_SHARE * (caps.maxAccountedHeapMB + caps.maxGpuResourceMB);
    const entries = parseExits(this.o.storage?.getItem(HB_EXITS_KEY) ?? null).filter((e) => now - e.t <= DEMOTION_WINDOW_MS);
    entries.push({ t: now, tier: prev.tier, memEstMB: prev.memEstMB });
    const qualifying = entries.filter((e) => e.tier === prev.tier && e.memEstMB > threshold);
    let demote: QualityTierId | null = null;
    let keep = entries;
    if (qualifying.length >= 2) {
      demote = prev.tier;
      // The demoted tier starts a fresh count.
      keep = entries.filter((e) => e.tier !== prev.tier);
    }
    this.write(HB_EXITS_KEY, JSON.stringify(keep.slice(-10)));
    return demote;
  }

  private read(): HeartbeatRecord | null {
    try {
      return parseRecord(this.o.storage?.getItem(HB_KEY) ?? null);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.o.storage?.setItem(key, value);
    } catch {
      // Storage may be full or blocked; the heartbeat is best effort.
    }
  }

  private persist(): void {
    this.rec.t = this.o.now();
    let text = JSON.stringify(this.rec);
    while (text.length > MAX_RECORD_BYTES && this.rec.ring.length > 0) {
      this.rec.ring.shift();
      text = JSON.stringify(this.rec);
    }
    this.write(HB_KEY, text);
  }

  /** Writes the first `running` record and starts the 5 s beat. */
  start(init: { tier: QualityTierId; backend: RenderBackend }): void {
    this.rec.tier = init.tier;
    this.rec.backend = init.backend;
    this.rec.state = 'running';
    this.visible = true;
    this.persist();
    if (this.timer === null) this.timer = this.o.timers.setInterval(() => this.beat(), BEAT_MS);
  }

  stop(): void {
    if (this.timer !== null) this.o.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** One beat: refresh the memory estimate and rewrite the record while visible. */
  beat(): void {
    if (!this.visible) return;
    const m = this.o.memory?.();
    if (m) {
      this.rec.memEstMB = m.memEstMB;
      this.rec.gpuEstMB = m.gpuEstMB;
    }
    this.persist();
  }

  /** Updates scene, mode, chunk, tier or backend and rewrites the record at once. */
  patch(p: Record<string, unknown>): void {
    const r = this.rec as unknown as Record<string, unknown>;
    for (const k of ['scene', 'mode', 'chunkKey', 'tier', 'backend', 'memEstMB', 'gpuEstMB'] as const) {
      if (k in p) r[k] = p[k];
    }
    if (this.visible) this.persist();
  }

  /** Adds an event to the ring (at most 20). */
  note(event: string): void {
    this.rec.ring.push(event.slice(0, 64));
    if (this.rec.ring.length > MAX_RING) this.rec.ring.shift();
  }

  markHidden(): void {
    this.visible = false;
    this.rec.state = 'hidden';
    this.persist();
  }

  markVisible(): void {
    this.visible = true;
    this.rec.state = 'running';
    this.persist();
  }

  markClosed(): void {
    this.visible = false;
    this.rec.state = 'closed';
    this.persist();
  }
}

/**
 * rAF stall watchdog: when the page is visible and no frame arrived for 5 s, `raf.stall` goes to the ring. A stall that is
 * followed by a kill is then visible in the next boot's `app.abnormal_exit` context.
 */
export const STALL_MS = 5000;

export class RafWatchdog {
  private last: number;
  private stalled = false;
  private timer: unknown = null;
  visible = true;

  constructor(
    private readonly now: () => number,
    private readonly timers: TimerApi,
    private readonly onStall: () => void,
  ) {
    this.last = now();
  }

  /** Call from the frame loop. */
  frame(): void {
    this.last = this.now();
    this.stalled = false;
  }

  start(): void {
    if (this.timer !== null) return;
    this.last = this.now();
    this.timer = this.timers.setInterval(() => this.check(), 1000);
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  check(): void {
    if (!this.visible || this.stalled) return;
    if (this.now() - this.last >= STALL_MS) {
      this.stalled = true;
      this.onStall();
    }
  }
}
