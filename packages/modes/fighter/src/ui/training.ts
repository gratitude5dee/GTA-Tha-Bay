/**
 * The Training panel (FC11): the frame meter of the last move (startup, active, recovery, the result of the contact and the
 * advantage, derived from the data and measured), the dummy's behaviour, record and playback, reset and refill, the overlay switches
 * and the damage readout. A plain DOM panel over the arena; every number carries a `data-*` attribute so the specs read it
 * without parsing text. It sends `mode.cmd` commands through `send(name, args)` and keeps no state of its own.
 */
import type { TrainVm } from '../sim/vm.ts';
import { tt } from './text.ts';

export type Send = (name: string, args?: Record<string, string | number | boolean>) => void;

const DUMMIES: TrainVm['dummy'][] = ['stand', 'crouch', 'blockAll', 'blockFirst', 'jump', 'cpu', 'playback'];

const signed = (n: number | null): string => (n === null ? '-' : n > 0 ? `+${n}` : String(n));

function btn(doc: Document, parent: HTMLElement, label: string, cls: string, on: () => void, testid?: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  if (testid) b.dataset['testid'] = testid;
  b.addEventListener('click', on);
  parent.append(b);
  return b;
}

export class TrainingPanel {
  readonly root: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly dummy: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly toggles: HTMLElement;
  private readonly last: HTMLElement;
  private sig = '';

  constructor(doc: Document, private readonly send: Send) {
    this.root = doc.createElement('aside');
    this.root.className = 'dvf-train';
    this.root.dataset['testid'] = 'train-panel';
    const h = doc.createElement('h3');
    h.textContent = tt('fighter.train.title');
    this.meter = doc.createElement('div');
    this.meter.className = 'dvf-meter';
    this.meter.dataset['testid'] = 'train-meter';
    this.dummy = doc.createElement('div');
    this.dummy.className = 'dvf-tdummy';
    this.rec = doc.createElement('div');
    this.rec.className = 'dvf-trec';
    this.toggles = doc.createElement('div');
    this.toggles.className = 'dvf-ttoggles';
    this.last = doc.createElement('div');
    this.last.className = 'dvf-tlast';
    this.last.dataset['testid'] = 'train-last';
    this.root.append(h, this.meter, this.dummy, this.rec, this.toggles, this.last);
  }

  render(t: TrainVm | null): void {
    const doc = this.root.ownerDocument;
    if (!t) { this.root.style.display = 'none'; return; }
    this.root.style.display = '';
    const sig = JSON.stringify([t.dummy, t.recording, t.recLen, t.overlay, t.meter, t.last, t.invuln]);
    if (sig === this.sig) return;
    this.sig = sig;

    // the frame meter
    this.meter.textContent = '';
    this.meter.style.display = t.overlay.meter ? '' : 'none';
    const m = t.meter;
    this.meter.dataset['move'] = m?.move ?? '';
    this.meter.dataset['startup'] = m ? String(m.S) : '';
    this.meter.dataset['active'] = m ? String(m.A) : '';
    this.meter.dataset['recovery'] = m ? String(m.R) : '';
    this.meter.dataset['result'] = m?.result ?? '';
    this.meter.dataset['adv'] = m && m.adv !== null ? String(m.adv) : '';
    this.meter.dataset['measured'] = m && m.measured !== null ? String(m.measured) : '';
    const head = doc.createElement('div');
    head.className = 'dvf-mhead';
    head.textContent = `${tt('fighter.train.meter')}: ${m ? m.move : tt('fighter.train.none')}`;
    this.meter.append(head);
    if (m) {
      const bar = doc.createElement('div');
      bar.className = 'dvf-mbar';
      const seg = (cls: string, n: number): void => {
        const s = doc.createElement('i');
        s.className = cls;
        s.style.flexGrow = String(Math.max(1, n));
        s.textContent = String(n);
        bar.append(s);
      };
      seg('dvf-mS', m.S);
      seg('dvf-mA', m.A);
      seg('dvf-mR', m.R);
      this.meter.append(bar);
      const rows = doc.createElement('div');
      rows.className = 'dvf-mrows';
      const row = (label: string, value: string, id: string): void => {
        const r = doc.createElement('span');
        r.dataset['testid'] = id;
        r.textContent = `${label} ${value}`;
        rows.append(r);
      };
      row(tt('fighter.train.startup'), String(m.S), 'meter-startup');
      row(tt('fighter.train.active'), String(m.A), 'meter-active');
      row(tt('fighter.train.recovery'), String(m.R), 'meter-recovery');
      row(tt(`fighter.train.result.${m.result}`), m.result === 'whiff' ? '' : signed(m.adv), 'meter-adv');
      if (m.measured !== null) row(tt('fighter.train.measured'), signed(m.measured), 'meter-measured');
      this.meter.append(rows);
    }

    // the dummy
    this.dummy.textContent = '';
    const dl = doc.createElement('div');
    dl.className = 'dvf-tlabel';
    dl.textContent = tt('fighter.train.dummy');
    this.dummy.append(dl);
    for (const d of DUMMIES) {
      const b = btn(doc, this.dummy, tt(`fighter.train.dummy.${d}`), 'dvf-chip', () => this.send('train.dummy', { mode: d }), `dummy-${d}`);
      b.dataset['on'] = t.dummy === d ? '1' : '0';
      b.setAttribute('aria-pressed', t.dummy === d ? 'true' : 'false');
    }

    // record, play, reset, refill
    this.rec.textContent = '';
    const recBtn = btn(doc, this.rec, t.recording ? tt('fighter.train.stop') : tt('fighter.train.record'), 'dvf-chip', () => {
      this.send('train.rec', { on: !t.recording });
      if (t.recording) this.send('train.dummy', { mode: 'playback' });
    }, 'train-rec');
    recBtn.dataset['on'] = t.recording ? '1' : '0';
    btn(doc, this.rec, tt('fighter.train.play'), 'dvf-chip', () => this.send('train.dummy', { mode: 'playback' }), 'train-play');
    btn(doc, this.rec, tt('fighter.train.reset'), 'dvf-chip', () => this.send('train.reset'), 'train-reset');
    btn(doc, this.rec, tt('fighter.train.refill'), 'dvf-chip', () => this.send('train.refill'), 'train-refill');
    const rl = doc.createElement('span');
    rl.className = 'dvf-trecn';
    rl.dataset['testid'] = 'train-reclen';
    rl.textContent = tt('fighter.train.recorded', { n: t.recLen });
    this.rec.append(rl);

    // overlay switches
    this.toggles.textContent = '';
    const toggle = (key: 'boxes' | 'meter' | 'input' | 'damage', label: string): void => {
      const b = btn(doc, this.toggles, label, 'dvf-chip', () => this.send('train.overlay', { key, on: !t.overlay[key] }), `toggle-${key}`);
      b.dataset['on'] = t.overlay[key] ? '1' : '0';
      b.setAttribute('aria-pressed', t.overlay[key] ? 'true' : 'false');
    };
    toggle('boxes', tt('fighter.train.boxes'));
    toggle('meter', tt('fighter.train.meterToggle'));
    toggle('input', tt('fighter.train.inputs'));
    toggle('damage', tt('fighter.train.damage'));

    // the damage readout and the invulnerability display
    this.last.style.display = t.overlay.damage ? '' : 'none';
    this.last.dataset['damage'] = String(t.last.damage);
    this.last.dataset['combo'] = String(t.last.combo);
    this.last.dataset['scale'] = String(t.last.scale);
    this.last.textContent = `${tt('fighter.train.last', { dmg: t.last.damage, hits: t.last.combo, pct: t.last.scale })}${t.invuln[0] !== 0 ? `  ${tt('fighter.train.invuln')}` : ''}`;
  }
}
