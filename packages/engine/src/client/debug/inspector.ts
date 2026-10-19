/**
 * The entity inspector panel (QA builds with `?debug=1`; 01-engine.md 2.11; M03a1). A DOM panel that asks the sim for the
 * components of the player's vehicle (or the player, or any handle) and lists their fields; a field can be edited, which is a
 * `debug.edit` command on the same channel as every other debug command. Toggle with F7.
 *
 * Reachable only through a dynamic import behind `VITE_DV_QA === '1'`; a production dist contains neither it nor its strings.
 */
export interface InspectorOptions {
  container: HTMLElement;
  /** Sends a debug command and resolves with the sim's `qa` reply of that name. */
  ask(cmd: { t: 'debug.inspect'; handle?: number } | { t: 'debug.edit'; handle: number; component: string; field: string; lane?: number; value: number }): Promise<InspectReply | null>;
}

export interface InspectReply {
  ok: boolean;
  reason?: string;
  handle?: number;
  key?: string | null;
  components?: Record<string, Record<string, number | number[]>>;
  value?: number;
}

const STYLE = `
.dv-inspector{position:fixed;left:.75rem;top:4.5rem;inline-size:min(22rem,calc(100vw - 1.5rem));max-block-size:70vh;overflow:auto;padding:.6rem .75rem;border-radius:.6rem;
background:rgba(10,14,22,.92);color:#e6eaf0;font:12px/1.35 ui-monospace,monospace;z-index:40}
.dv-inspector[hidden]{display:none}
.dv-inspector h3{margin:.4rem 0 .15rem;font-size:12px;color:#f2c230}
.dv-inspector dl{display:grid;grid-template-columns:auto 1fr;gap:0 .6rem;margin:0}
.dv-inspector dt{opacity:.75}
.dv-inspector dd{margin:0;text-align:end}
.dv-inspector input{inline-size:5.5rem;background:#1b2330;color:inherit;border:1px solid #39465c;border-radius:.25rem;text-align:end;font:inherit}
.dv-inspector__head{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
`;

export class Inspector {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly body: HTMLDivElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handle: number | undefined;
  private busy = false;
  private editing = false;
  /** Component names listed by the last refresh (the bridge and the e2e read it). */
  components: string[] = [];

  constructor(private readonly o: InspectorOptions) {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.append(this.style);
    this.root = document.createElement('div');
    this.root.className = 'dv-inspector';
    this.root.dataset['testid'] = 'dv-inspector';
    this.root.hidden = true;
    const head = document.createElement('div');
    head.className = 'dv-inspector__head';
    const title = document.createElement('strong');
    title.textContent = 'Entity inspector';
    const input = document.createElement('input');
    input.placeholder = 'handle';
    input.setAttribute('aria-label', 'Entity handle');
    input.addEventListener('change', () => {
      const n = Number(input.value);
      this.handle = Number.isInteger(n) && n > 0 ? n : undefined;
      void this.refresh();
    });
    head.append(title, input);
    this.body = document.createElement('div');
    this.root.append(head, this.body);
    o.container.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(on?: boolean): void {
    const show = on ?? this.root.hidden;
    this.root.hidden = !show;
    if (show) {
      void this.refresh();
      this.timer ??= setInterval(() => void this.refresh(), 500);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(): Promise<void> {
    if (this.busy || this.editing || this.root.hidden) return;
    this.busy = true;
    try {
      const r = await this.o.ask({ t: 'debug.inspect', ...(this.handle !== undefined ? { handle: this.handle } : {}) });
      this.render(r);
    } finally {
      this.busy = false;
    }
  }

  private render(r: InspectReply | null): void {
    this.body.replaceChildren();
    if (!r || !r.ok || !r.components) {
      this.components = [];
      this.body.textContent = r?.reason ?? 'no answer';
      return;
    }
    this.components = Object.keys(r.components);
    this.root.dataset['entity'] = String(r.handle ?? '');
    const sub = document.createElement('div');
    sub.textContent = `handle ${r.handle ?? '?'}${r.key ? `  ${r.key}` : ''}`;
    this.body.append(sub);
    for (const [name, fields] of Object.entries(r.components)) {
      const h = document.createElement('h3');
      h.textContent = name;
      h.dataset['component'] = name;
      const dl = document.createElement('dl');
      for (const [field, value] of Object.entries(fields)) {
        const dt = document.createElement('dt');
        dt.textContent = field;
        const dd = document.createElement('dd');
        if (typeof value === 'number') {
          const inp = document.createElement('input');
          inp.value = String(Math.round(value * 1000) / 1000);
          inp.setAttribute('aria-label', `${name}.${field}`);
          inp.addEventListener('focus', () => { this.editing = true; });
          inp.addEventListener('blur', () => { this.editing = false; });
          inp.addEventListener('change', () => {
            const v = Number(inp.value);
            if (r.handle !== undefined && Number.isFinite(v)) void this.o.ask({ t: 'debug.edit', handle: r.handle, component: name, field, value: v });
          });
          dd.append(inp);
        } else dd.textContent = value.map((x) => Math.round(x * 1000) / 1000).join(', ');
        dl.append(dt, dd);
      }
      this.body.append(h, dl);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.root.remove();
    this.style.remove();
  }
}
