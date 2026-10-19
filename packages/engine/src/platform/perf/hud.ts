import type { QualityTierId, RenderBackend } from '@dv/shared';
import { type PerfProbe, type MemoryCounters } from './probe.ts';

/**
 * PerfHud (11-platform-perf.md section 3): the `?perf=1` overlay with fps, p95, objects, triangles, texture and GPU MB, accounted
 * heap, tier, backend and governor state, plus an "Export" button that downloads `perf.json` and `notes.json`. QA builds only.
 */
export interface HudReading {
  tier: QualityTierId;
  backend: RenderBackend;
  frameMs: PerfProbe;
  renderObjects: number;
  triangles: number;
  memory: MemoryCounters;
  governor: 'on' | 'off';
  running: boolean;
}

export interface PerfHudOptions {
  read: () => HudReading;
  onExport: () => void;
  parent?: HTMLElement;
  intervalMs?: number;
}

export class PerfHud {
  readonly element: HTMLElement;
  private readonly lines: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: PerfHudOptions) {
    const root = document.createElement('div');
    root.id = 'dv-perf-hud';
    root.setAttribute('role', 'status');
    root.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:2147483000;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;' +
      'color:#d8ffd8;background:rgba(0,0,0,.72);border-radius:6px;max-width:60vw;pointer-events:auto';
    this.lines = document.createElement('pre');
    this.lines.style.cssText = 'margin:0;white-space:pre-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Export';
    btn.id = 'dv-perf-export';
    btn.style.cssText = 'margin-top:4px;font:inherit;padding:2px 8px';
    btn.addEventListener('click', () => this.o.onExport());
    root.append(this.lines, btn);
    (o.parent ?? document.body).append(root);
    this.element = root;
    this.update();
    this.timer = setInterval(() => this.update(), o.intervalMs ?? 500);
  }

  update(): void {
    const r = this.o.read();
    const p50 = r.frameMs.percentile(0.5);
    const p95 = r.frameMs.percentile(0.95);
    const fps = p50 > 0 ? 1000 / p50 : 0;
    this.lines.textContent = [
      `${r.tier}  ${r.backend}  governor ${r.governor}${r.running ? '  RUN' : ''}`,
      `fps ${fps.toFixed(1)}  p95 ${p95.toFixed(1)} ms`,
      `objects ${r.renderObjects}  tris ${Math.round(r.triangles).toLocaleString('en-US')}`,
      `tex ${r.memory.texturesMB.toFixed(1)} MB  gpu ${r.memory.gpuMB.toFixed(1)} MB  heap ${r.memory.wasmMB.toFixed(1)} MB`,
    ].join('\n');
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.element.remove();
  }
}
