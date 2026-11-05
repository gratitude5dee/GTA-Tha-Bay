import type { BootPayload, FrameSignal, LoopStats, SimConfig, SimHost, UiCommand } from '@dv/shared';
import type { SimEvent } from './events.ts';
import type { UiOut } from './ui/bridge.ts';
import type { DebugCommand, FromWorkerMessage, StatsReport } from './transport/envelope.ts';
import { createPmMain, type PortLike } from './transport/pm-transport.ts';
import { createSabMain, type SabInit } from './transport/sab-transport.ts';
import type { SnapshotRead } from './transport/snapshot-buffer.ts';
import type { MainTransport, TransportKind } from './transport/types.ts';

/** The part of `Worker` that the host uses. */
export interface WorkerLike extends PortLike {
  terminate(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void;
}

/** First message to a fresh worker. Not part of the steady-state protocol: it carries what the worker needs to start. */
export interface InitMessage {
  readonly v: 1;
  readonly t: 'init';
  readonly seq: 0;
  readonly p: {
    cfg: SimConfig;
    boot: BootPayload;
    transport: TransportKind;
    sab: SabInit | null;
    qa: boolean;
    /** Transferred ports and other extras by name (the world pack channel, M02b1); modules read them in `onInit`. */
    ports?: Record<string, unknown>;
  };
}

export function isInitMessage(x: unknown): x is InitMessage {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as { v?: unknown; t?: unknown; p?: unknown };
  return m.v === 1 && m.t === 'init' && typeof m.p === 'object' && m.p !== null;
}

export interface SimHostOptions {
  /** Creates a fresh sim worker. Called again on `restart`. */
  spawn(): WorkerLike;
  /** `crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'`: choose the SAB transport. */
  sab: boolean;
  /** Pass debug commands through to the worker. */
  qa?: boolean;
  /** How long `start`/`restart` wait for the worker's `ready` event. */
  readyTimeoutMs?: number;
  /** A promise that rejects after `ms` (the page supplies it: sim code has no timers). Without it, start waits forever. */
  timeoutAfter?(ms: number, what: string): Promise<never>;
  /** Called when the worker raised an error or stopped producing snapshots. The caller decides whether to restart. */
  onCrash?(reason: 'error' | 'stalled', detail: string): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  /** Receives every batch of sim events the worker reports (ownership transitions, audio cues, chunk loads), oldest first. */
  onSimEvents?(events: readonly SimEvent[]): void;
  /** Receives the view-model patches, toasts and overlay ops the sim-side UiBridge flushed (M04a2), in order. */
  onUi?(out: UiOut): void;
  /**
   * Called before every (re)start of the worker; the ports it returns travel in the init message (`InitMessage.p.ports`) and are
   * transferred. The world uses it to open a fresh `MessageChannel` to asset.worker for each worker generation (M02b1).
   */
  initExtras?(): { ports: Record<string, unknown>; transfer: unknown[] } | Promise<{ ports: Record<string, unknown>; transfer: unknown[] }>;
}

/** No fresh snapshot for this long while frames flow means the worker is gone (01-engine.md section 5). */
const STALL_MS = 2000;
/** A gap between two frame signals longer than this means the page was hidden; the stall timer starts over. */
const FRAME_GAP_RESET_MS = 1000;
/**
 * One frame adds at most this much to the stall timer (BD-REPAIR-M10d1-03). A page whose frames take 0.5 to 1 s (software GL, a
 * starved core) also starves the worker thread beside it, so wall-clock time between two frames says little about a worker that
 * answers every frame signal late; a dead worker still shows as `STALL_MS / STALL_FRAME_CAP_MS` frames without a fresh snapshot.
 */
const STALL_FRAME_CAP_MS = 250;

/**
 * The page's handle on sim.worker (C02 SimHost). It owns the worker and the transport, sends one `FrameSignal` per
 * rAF, reads the newest snapshot pair once per frame (the renderer then draws `view`), collects stats and events, and
 * detects a dead worker.
 */
export class SimHostImpl implements SimHost {
  transport: MainTransport | null = null;
  cfg: SimConfig | null = null;
  boot: BootPayload | null = null;
  /** The snapshot read by the latest `frame`; null before the first one. */
  view: SnapshotRead | null = null;
  report: StatsReport | null = null;
  /** Worker restarts: crash recoveries and profile switches. */
  restarts = 0;
  crashed: string | null = null;
  readonly events: FromWorkerMessage[] = [];
  /** The last 100 sim events (ownership transitions and refusals) the worker reported. */
  readonly simEvents: SimEvent[] = [];
  /** Test hook: the last 50 events (stats excluded). */
  qaResults = new Map<string, unknown>();

  private worker: WorkerLike | null = null;
  /** Stall time since the last fresh snapshot: frame gaps, each capped at `STALL_FRAME_CAP_MS`. */
  private staleMs = 0;
  private lastFrameMs = -1;
  private readyResolve: (() => void) | null = null;
  private generation = 0;

  constructor(private readonly opts: SimHostOptions) {}

  get kind(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  get stats(): LoopStats {
    return (
      this.report?.stats ?? { tick: 0, ticksLastFrame: 0, tickMsP50: 0, tickMsP99: 0, droppedSec: 0, overruns: 0 }
    );
  }

  async start(cfg: SimConfig, boot: BootPayload): Promise<void> {
    this.cfg = cfg;
    this.boot = boot;
    this.crashed = null;
    this.report = null;
    this.view = null;
    this.lastFrameMs = -1;
    const generation = ++this.generation;
    const worker = this.opts.spawn();
    this.worker = worker;

    let transport: MainTransport;
    let sab: SabInit | null = null;
    if (this.opts.sab) {
      const made = createSabMain();
      transport = made.main;
      sab = made.init;
    } else {
      transport = createPmMain(worker);
    }
    this.transport = transport;

    const ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    worker.addEventListener('message', (ev) => {
      if (generation !== this.generation) return;
      const m = ev.data as { t?: unknown; p?: unknown } | null;
      if (m && typeof m === 'object' && m.t === 'ready') this.readyResolve?.();
      else if (m && typeof m === 'object' && m.t === 'error') this.fail('error', String((m.p as { message?: string } | undefined)?.message ?? 'worker error'));
    });
    worker.addEventListener('error', (ev) => {
      if (generation !== this.generation) return;
      const detail = ev && typeof ev === 'object' && 'message' in ev ? String((ev as { message: unknown }).message) : 'worker error';
      this.fail('error', detail);
    });

    const extras = this.opts.initExtras ? await this.opts.initExtras() : null;
    if (generation !== this.generation) return;
    const init: InitMessage = {
      v: 1, t: 'init', seq: 0,
      p: { cfg, boot, transport: transport.kind, sab, qa: this.opts.qa === true, ...(extras ? { ports: extras.ports } : {}) },
    };
    if (extras && extras.transfer.length > 0) worker.postMessage(init, extras.transfer);
    else worker.postMessage(init);
    const timeoutMs = this.opts.readyTimeoutMs ?? 30_000;
    await (this.opts.timeoutAfter ? Promise.race([ready, this.opts.timeoutAfter(timeoutMs, 'sim worker was not ready')]) : ready);
    this.staleMs = 0;
  }

  /** Send the frame signal, collect events, read the newest snapshot pair. Never blocks. */
  frame(sig: FrameSignal): void {
    const t = this.transport;
    if (!t || this.crashed) return;
    const gap = this.lastFrameMs < 0 ? 0 : sig.nowMs - this.lastFrameMs;
    if (sig.paused || this.lastFrameMs < 0 || gap > FRAME_GAP_RESET_MS) {
      this.staleMs = 0;
    } else {
      this.staleMs += Math.min(gap, STALL_FRAME_CAP_MS);
    }
    this.lastFrameMs = sig.nowMs;
    t.sendFrame(sig);
    t.drainEvents((m) => this.onEvent(m));
    const v = t.readSnapshot();
    if (v) {
      this.view = v;
      if (v.fresh) {
        this.staleMs = 0;
      }
    }
    if (this.staleMs > STALL_MS) this.fail('stalled', `no snapshot for ${Math.round(this.staleMs)} ms`);
  }

  /** Debug and headless only (C02): runs one tick while paused. Needs a QA build. */
  stepOnce(): void {
    this.transport?.sendDebug({ t: 'debug.step', n: 1 });
  }

  sendDebug(cmd: DebugCommand): boolean {
    return this.transport?.sendDebug(cmd) ?? false;
  }

  /** A UI command over the command ring (M04a2). False when there is no worker or the ring was full. */
  sendUi(cmd: UiCommand): boolean {
    return this.transport?.sendUi(cmd) ?? false;
  }

  /** Terminates the worker and starts a new one for `cfg` (profile switch, or crash recovery). */
  async restart(cfg: SimConfig): Promise<void> {
    this.restarts++;
    this.teardown();
    const boot = this.boot ?? { strings: [], prefabs: [], config: {} };
    await this.start(cfg, boot);
  }

  async dispose(): Promise<void> {
    this.generation++;
    this.teardown();
  }

  private teardown(): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.transport?.dispose();
    this.transport = null;
  }

  private fail(reason: 'error' | 'stalled', detail: string): void {
    if (this.crashed) return;
    this.crashed = `${reason}: ${detail}`;
    this.opts.onCrash?.(reason, detail);
  }

  private onEvent(m: FromWorkerMessage): void {
    switch (m.t) {
      case 'stats':
        this.report = m.p;
        break;
      case 'log':
        this.opts.onLog?.(m.p.level, m.p.message);
        break;
      case 'qa':
        this.qaResults.set(m.p.name, m.p.data);
        break;
      case 'ui':
        this.opts.onUi?.(m.p);
        break;
      case 'events':
        for (const e of m.p.events) {
          this.simEvents.push(e);
          if (this.simEvents.length > 100) this.simEvents.shift();
        }
        this.opts.onSimEvents?.(m.p.events);
        break;
      default:
        this.events.push(m);
        if (this.events.length > 50) this.events.shift();
    }
  }
}
