import type { EnvState, LoopStats, WeatherPreset } from '@dv/shared';

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
  private readonly companions: HTMLElement[] = [];

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

  /** An element that shows and hides with the panel (the sky controls). `visible` sets how it starts (default: with the panel). */
  addCompanion(el: HTMLElement, visible = this.shown): void {
    el.hidden = !visible;
    this.companions.push(el);
  }

  toggle(): boolean {
    this.shown = !this.shown;
    this.root.hidden = !this.shown;
    for (const c of this.companions) c.hidden = !this.shown;
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

export const SKY_PRESETS: readonly WeatherPreset[] = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'];

export interface SkyControlsOptions {
  container: HTMLElement;
  /** Set the hour of the game day (0..24). */
  onHour(h: number): void;
  /** Switch to a weather preset at once. */
  onWeather(w: WeatherPreset): void;
  onBlackout(on: boolean): void;
  /** Force rain on (a streak intensity 0..255) whatever the preset says, or null for the preset's own rain. */
  onRain(rain: number | null): void;
  /** Freeze or release the clock. */
  onFreeze(on: boolean): void;
  /** M02e: the look switch and the post nodes running; absent on a view without a look pass. */
  look?: { available(): boolean; isOn(): boolean; setOn(on: boolean): boolean; nodes(): readonly string[] };
}

/** Forced rain intensity of the panel's Rain switch (the `rain` preset's own value). */
export const SKY_RAIN_FORCED = 200;

/**
 * The sky controls of the QA debug panel (M02b2): hour slider, weather preset, blackout, rain and a clock freeze. They are what the
 * `M02b2-iphone15` checklist uses to reach "rain at 21:30 with Karl fog" (the Rain switch forces streaks on top of the preset).
 * Built from plain DOM so a phone with `?debug=1` has them without a keyboard.
 */
export class SkyControls {
  readonly root: HTMLElement;
  private readonly hour: HTMLInputElement;
  private readonly hourText: HTMLElement;
  private readonly preset: HTMLSelectElement;
  private readonly blackout: HTMLInputElement;
  private readonly rain: HTMLInputElement;
  private readonly freeze: HTMLInputElement;
  private readonly lookBox: HTMLInputElement | null = null;
  private readonly lookText: HTMLElement | null = null;
  private readonly lookApi: SkyControlsOptions['look'];
  private dragging = false;

  constructor(opts: SkyControlsOptions) {
    const doc = opts.container.ownerDocument;
    // The root is a plain block so the `hidden` attribute works (an inline `display: grid` would override it); the grid is inside.
    const root = doc.createElement('div');
    root.className = 'dv-sky-controls';
    root.dataset['dvSkyControls'] = '';
    Object.assign(root.style, {
      position: 'fixed', insetBlockStart: '92px', insetInlineStart: '8px', zIndex: '9', padding: '6px 8px',
      font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#d8f5d0', background: 'rgb(0 0 0 / 0.7)', borderRadius: '6px',
    });
    root.hidden = true;
    const grid = doc.createElement('div');
    grid.style.cssText = 'display:grid;gap:4px';
    root.append(grid);
    const row = (label: string, el: HTMLElement): void => {
      const l = doc.createElement('label');
      l.style.cssText = 'display:flex;gap:6px;align-items:center';
      const t = doc.createElement('span');
      t.textContent = label;
      t.style.minWidth = '56px';
      l.append(t, el);
      grid.append(l);
    };
    this.hour = doc.createElement('input');
    this.hour.type = 'range';
    this.hour.min = '0';
    this.hour.max = '24';
    this.hour.step = '0.25';
    this.hour.value = '9';
    this.hour.dataset['testid'] = 'sky-hour';
    this.hour.style.width = '140px';
    this.hourText = doc.createElement('span');
    this.hourText.dataset['testid'] = 'sky-hour-text';
    this.hourText.textContent = '09:00';
    const hourWrap = doc.createElement('span');
    hourWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    hourWrap.append(this.hour, this.hourText);
    row('hour', hourWrap);
    this.hour.addEventListener('pointerdown', () => void (this.dragging = true));
    this.hour.addEventListener('pointerup', () => void (this.dragging = false));
    this.hour.addEventListener('change', () => void (this.dragging = false));
    this.hour.addEventListener('input', () => {
      this.hourText.textContent = formatHour(Number(this.hour.value));
      opts.onHour(Number(this.hour.value));
    });
    this.preset = doc.createElement('select');
    this.preset.dataset['testid'] = 'sky-preset';
    for (const p of SKY_PRESETS) {
      const o = doc.createElement('option');
      o.value = p;
      o.textContent = p;
      this.preset.append(o);
    }
    this.preset.addEventListener('change', () => opts.onWeather(this.preset.value as WeatherPreset));
    row('weather', this.preset);
    const toggle = (testid: string, label: string, on: (v: boolean) => void): HTMLInputElement => {
      const c = doc.createElement('input');
      c.type = 'checkbox';
      c.dataset['testid'] = testid;
      c.addEventListener('change', () => on(c.checked));
      row(label, c);
      return c;
    };
    this.blackout = toggle('sky-blackout', 'blackout', (v) => opts.onBlackout(v));
    this.rain = toggle('sky-rain', 'rain', (v) => opts.onRain(v ? SKY_RAIN_FORCED : null));
    this.freeze = toggle('sky-freeze', 'freeze', (v) => opts.onFreeze(v));
    this.lookApi = opts.look;
    if (opts.look?.available()) {
      const api = opts.look;
      this.lookBox = toggle('look-toggle', 'look', (v) => {
        const ok = api.setOn(v);
        if (!ok) this.lookBox!.checked = api.isOn();
      });
      this.lookBox.checked = api.isOn();
      this.lookText = doc.createElement('div');
      this.lookText.dataset['testid'] = 'look-nodes';
      this.lookText.style.cssText = 'opacity:0.8;max-width:200px;overflow-wrap:anywhere';
      grid.append(this.lookText);
    }
    opts.container.append(root);
    this.root = root;
  }

  /** The switches as set. */
  state(): { blackout: boolean; rain: boolean; freeze: boolean } {
    return { blackout: this.blackout.checked, rain: this.rain.checked, freeze: this.freeze.checked };
  }

  /** Follows the clock: the slider and the preset show the live values unless the player is dragging. Call once per frame. */
  sync(env: EnvState | null, blackout: boolean): void {
    if (this.root.hidden) return;
    this.blackout.checked = blackout;
    if (this.lookApi && this.lookBox && this.lookText && this.lookBox.ownerDocument.activeElement !== this.lookBox) {
      this.lookBox.checked = this.lookApi.isOn();
      const nodes = this.lookApi.nodes();
      this.lookText.textContent = nodes.length > 0 ? `nodes: ${nodes.join(' > ')}` : 'nodes: none';
    }
    if (!env || this.dragging) return;
    this.hour.value = String(env.hour);
    this.hourText.textContent = formatHour(env.hour);
    if (this.preset.ownerDocument.activeElement !== this.preset) this.preset.value = env.weather;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** `hh:mm` of an hour of day. */
export function formatHour(h: number): string {
  const total = Math.round((h - Math.floor(h / 24) * 24) * 60) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total - hh * 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
