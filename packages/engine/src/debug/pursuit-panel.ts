/**
 * The pursuit panel (QA builds only, M03c): a small box in the top-left corner with the heat readout (level, phase, cooldown, units) and
 * the sandbox toggles "heat 0 to 5", "never wanted", and two scene helpers that stand a roadblock or a spike strip in front of the car.
 * M04b2 brings the real `HeatStars` widget; this file is reached only through a dynamic import behind `VITE_DV_QA === '1'`, so a
 * production dist does not contain it (apps/web/scripts/verify-dist.mjs).
 *
 * Plain DOM; every element has a `data-testid`.
 */
import type { PursuitSide } from '../client/snapshot/reader.ts';

export interface PursuitPanelOptions {
  container: HTMLElement;
  /** Sets the heat (0 clears). */
  onHeat(level: number): void;
  onNeverWanted(on: boolean): void;
  onBlock(): void;
  onStrip(): void;
}

const STYLE = `
.dv-pursuit{position:fixed;left:calc(env(safe-area-inset-left,0px) + .5rem);top:calc(env(safe-area-inset-top,0px) + .5rem);z-index:35;max-inline-size:min(22rem,70vw);
padding:.4rem .5rem;border-radius:.5rem;background:rgba(14,18,26,.82);color:#f3f5f8;font:600 .8rem/1.25 system-ui,sans-serif;pointer-events:none}
.dv-pursuit button,.dv-pursuit label{pointer-events:auto}
.dv-pursuit__line{display:block;font-variant-numeric:tabular-nums;white-space:nowrap}
.dv-pursuit__stars{letter-spacing:.1em;color:#f2c230}
.dv-pursuit__row{display:flex;flex-wrap:wrap;gap:.25rem;margin-block-start:.3rem}
.dv-pursuit button{min-inline-size:1.9rem;min-block-size:1.9rem;border:1px solid rgba(255,255,255,.35);border-radius:.3rem;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}
.dv-pursuit button[aria-pressed="true"]{background:#f2c230;color:#10141c}
.dv-pursuit label{display:inline-flex;align-items:center;gap:.25rem}
`;

export class PursuitPanel {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly stars: HTMLSpanElement;
  private readonly line: HTMLSpanElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private shown = '';

  constructor(private readonly o: PursuitPanelOptions) {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.append(this.style);
    const root = document.createElement('div');
    root.className = 'dv-pursuit';
    root.dataset['testid'] = 'pursuit-panel';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Pursuit debug');
    this.stars = document.createElement('span');
    this.stars.className = 'dv-pursuit__line dv-pursuit__stars';
    this.stars.dataset['testid'] = 'pursuit-stars';
    this.line = document.createElement('span');
    this.line.className = 'dv-pursuit__line';
    this.line.dataset['testid'] = 'pursuit-line';
    root.append(this.stars, this.line);

    const row = document.createElement('div');
    row.className = 'dv-pursuit__row';
    for (let l = 0; l <= 5; l++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(l);
      b.title = l === 0 ? 'clear heat' : `heat ${l}`;
      b.dataset['testid'] = `pursuit-heat-${l}`;
      b.addEventListener('click', () => this.o.onHeat(l));
      this.buttons.push(b);
      row.append(b);
    }
    root.append(row);

    const row2 = document.createElement('div');
    row2.className = 'dv-pursuit__row';
    const never = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset['testid'] = 'pursuit-never';
    box.addEventListener('change', () => this.o.onNeverWanted(box.checked));
    never.append(box, document.createTextNode('never wanted'));
    const block = document.createElement('button');
    block.type = 'button';
    block.textContent = 'roadblock';
    block.dataset['testid'] = 'pursuit-block';
    block.addEventListener('click', () => this.o.onBlock());
    const strip = document.createElement('button');
    strip.type = 'button';
    strip.textContent = 'spikes';
    strip.dataset['testid'] = 'pursuit-strip';
    strip.addEventListener('click', () => this.o.onStrip());
    row2.append(never, block, strip);
    root.append(row2);

    this.root = root;
    o.container.append(root);
    this.update(null);
  }

  /** Redraws from the `pursuit` side block (null means level 0, phase clear). */
  update(s: PursuitSide | null): void {
    const level = s?.level ?? 0;
    const phase = s?.phase ?? 'clear';
    const key = `${level}|${phase}|${s?.fine ?? 0}|${s?.strikes ?? 0}|${s ? Math.round(s.cooldown * 100) : 0}|${s?.units ?? 0}|${s?.radius ?? 0}|${s?.seen ? 1 : 0}`;
    if (key === this.shown) return;
    this.shown = key;
    this.stars.textContent = `${'★'.repeat(Math.min(level, 5))}${'☆'.repeat(Math.max(0, 5 - level))}`;
    const cd = s && (phase === 'cooldown' || phase === 'search') ? ` cooldown ${Math.round(s.cooldown * 100)}%` : '';
    const circle = s && s.radius > 0 ? ` circle ${s.radius} m` : '';
    const bust = phase === 'busted' ? ` fine $${((s?.fine ?? 0) / 100).toFixed(0)} strike ${s?.strikes ?? 0}` : '';
    this.line.textContent = `HEAT ${level} ${phase}${cd}${circle} units ${s?.units ?? 0}${s?.seen ? ' SEEN' : ''}${bust}`;
    this.buttons.forEach((b, l) => b.setAttribute('aria-pressed', String(l === level)));
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
