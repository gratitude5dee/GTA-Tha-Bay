import type { LoopStats } from '@dv/shared';

/**
 * The F3 sim panel (QA builds with `?debug=1`; 01-engine.md section 2.11). It reads what the page already has: the rendered frame
 * rate as the median of the last 120 rAF deltas (a median ignores the one long frame of a GC pause), and the sim's own stats.
 */
export const FPS_WINDOW = 120;

/** Median of a list of numbers; 0 for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Frames per second from a window of rAF deltas in milliseconds: 1000 over the median delta. */
export function fpsFromDeltas(deltasMs: readonly number[]): number {
  const m = median(deltasMs);
  return m > 0 ? 1000 / m : 0;
}

export interface PanelMetrics {
  fps: number;
  ticksPerFrame: number;
  tickMsP50: number;
  tickMsP99: number;
  droppedSec: number;
  entities: number;
  transport: string;
  build: string;
  tier: string;
  backend: string;
}

export interface SimPanelOptions {
  container: HTMLElement;
  build: string;
  stats: () => { stats: LoopStats; entities: number };
  transport: () => string;
  tier: () => string;
  backend: () => string;
  /** How often the text is rewritten, milliseconds. */
  refreshMs?: number;
}

export class SimPanel {
  readonly root: HTMLElement;
  private readonly deltas: number[] = [];
  private last = -1;
  private sinceRefresh = 0;
  private shown = false;
  private readonly refreshMs: number;

  constructor(private readonly opts: SimPanelOptions) {
    this.refreshMs = opts.refreshMs ?? 250;
    const root = opts.container.ownerDocument.createElement('pre');
    root.className = 'dv-sim-panel';
    root.dataset['dvSimPanel'] = '';
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;
    Object.assign(root.style, {
      position: 'fixed', insetBlockStart: '8px', insetInlineStart: '8px', margin: '0', padding: '6px 8px', zIndex: '9',
      font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#d8f5d0', background: 'rgb(0 0 0 / 0.7)',
      borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre',
    });
    opts.container.append(root);
    this.root = root;
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): boolean {
    this.shown = !this.shown;
    this.root.hidden = !this.shown;
    if (this.shown) this.refresh();
    return this.shown;
  }

  /** Records one rAF delta; call once per rendered frame with the frame timestamp in milliseconds. */
  frame(nowMs: number): void {
    if (this.last >= 0) {
      const d = nowMs - this.last;
      // A hidden tab produces one huge delta; it is not a frame time.
      if (d > 0 && d < 1000) {
        this.deltas.push(d);
        if (this.deltas.length > FPS_WINDOW) this.deltas.shift();
        this.sinceRefresh += d;
      }
    }
    this.last = nowMs;
    if (this.shown && this.sinceRefresh >= this.refreshMs) this.refresh();
  }

  metrics(): PanelMetrics {
    const { stats, entities } = this.opts.stats();
    return {
      fps: fpsFromDeltas(this.deltas),
      ticksPerFrame: stats.ticksLastFrame,
      tickMsP50: stats.tickMsP50,
      tickMsP99: stats.tickMsP99,
      droppedSec: stats.droppedSec,
      entities,
      transport: this.opts.transport(),
      build: this.opts.build,
      tier: this.opts.tier(),
      backend: this.opts.backend(),
    };
  }

  refresh(): void {
    this.sinceRefresh = 0;
    const m = this.metrics();
    this.root.dataset['fps'] = m.fps.toFixed(1);
    this.root.dataset['tickP99'] = m.tickMsP99.toFixed(2);
    this.root.textContent = [
      `fps ${m.fps.toFixed(1)}  (median of ${this.deltas.length})`,
      `ticks/frame ${m.ticksPerFrame}  tick p50 ${m.tickMsP50.toFixed(2)} ms  p99 ${m.tickMsP99.toFixed(2)} ms`,
      `dropped ${m.droppedSec.toFixed(2)} s  entities ${m.entities}`,
      `${m.transport}  ${m.backend}  ${m.tier}  build ${m.build}`,
    ].join('\n');
  }

  dispose(): void {
    this.root.remove();
  }
}
