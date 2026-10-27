/**
 * The screens of the mode (FX9): hub, character and stage select, the pause card with the move list for the player's scheme, and
 * the results card. Plain DOM built from the menu view model; every button sends a `mode.cmd` through `send`. A screen is rebuilt
 * when the model changes (they are small). Buttons are at least 44 px high, focusable, and labelled.
 */
import type { MenuVm } from '../sim/vm.ts';
import type { Send } from './training.ts';
import { tt } from './text.ts';

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, on: () => void, opts: { cls?: string; testid?: string; pressed?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  const b = node(doc, 'button', opts.cls ?? 'dvf-btnx');
  b.type = 'button';
  b.textContent = label;
  if (opts.testid) b.dataset['testid'] = opts.testid;
  if (opts.pressed !== undefined) { b.setAttribute('aria-pressed', opts.pressed ? 'true' : 'false'); b.dataset['on'] = opts.pressed ? '1' : '0'; }
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', on);
  return b;
}

const signed = (n: number | null): string => (n === null ? '-' : n > 0 ? `+${n}` : String(n));

function hub(doc: Document, m: MenuVm, send: Send): HTMLElement {
  const c = node(doc, 'div', 'dvf-card dvf-hub');
  c.dataset['testid'] = 'fighter-hub';
  c.append(node(doc, 'h2', '', tt('fighter.ui.title')));
  c.append(button(doc, tt('fighter.ui.versus'), () => send('hub.go', { to: 'versus' }), { testid: 'hub-versus' }));
  c.append(button(doc, tt('fighter.ui.training'), () => send('hub.go', { to: 'training' }), { testid: 'hub-training' }));
  c.append(node(doc, 'p', 'dvf-note', tt(m.scheme === 'classic' ? 'fighter.ui.hint.classic' : 'fighter.ui.hint.simple')));
  c.append(button(doc, tt('fighter.ui.leave'), () => send('exit'), { cls: 'dvf-btnx dvf-ghost', testid: 'hub-leave' }));
  return c;
}

function pickRow(doc: Document, m: MenuVm, slot: 0 | 1, send: Send): HTMLElement {
  const row = node(doc, 'div', 'dvf-pick');
  row.append(node(doc, 'h3', '', tt(slot === 0 ? 'fighter.ui.you' : 'fighter.ui.opponent')));
  const list = node(doc, 'div', 'dvf-fighters');
  const chosen = slot === 0 ? m.p1 : m.p2;
  for (const f of m.fighters) {
    const b = button(doc, f.locked ? `${tt(f.nameKey)} (${tt('fighter.ui.locked')})` : tt(f.nameKey), () => send('pick', { slot, id: f.id }), {
      cls: 'dvf-card-btn', testid: `pick-${slot}-${f.id}`, pressed: chosen === f.id, disabled: f.locked,
    });
    list.append(b);
  }
  row.append(list);
  const card = m.fighters.find((f) => f.id === chosen)?.card;
  if (card) {
    const p = node(doc, 'p', 'dvf-note dvf-likeness', tt(card));
    p.dataset['testid'] = `card-${slot}`;
    row.append(p);
  }
  return row;
}

function select(doc: Document, m: MenuVm, send: Send): HTMLElement {
  const c = node(doc, 'div', 'dvf-card dvf-select');
  c.dataset['testid'] = 'fighter-select';
  c.append(node(doc, 'h2', '', tt(m.kind === 'training' ? 'fighter.ui.training' : 'fighter.ui.versus')));
  const cols = node(doc, 'div', 'dvf-cols');
  cols.append(pickRow(doc, m, 0, send));
  if (m.kind !== 'training') cols.append(pickRow(doc, m, 1, send));
  c.append(cols);
  const opts = node(doc, 'div', 'dvf-opts');
  const group = (label: string, ...items: HTMLElement[]): void => {
    const g = node(doc, 'div', 'dvf-opt');
    g.append(node(doc, 'span', 'dvf-optl', label), ...items);
    opts.append(g);
  };
  group(tt('fighter.ui.stage'), ...m.stages.map((s) => button(doc, tt(s.nameKey), () => send('stage', { id: s.id }), { cls: 'dvf-chip', pressed: m.stage === s.id, testid: `stage-${s.id}` })));
  group(`${tt('fighter.ui.day')} / ${tt('fighter.ui.night')}`,
    button(doc, tt('fighter.ui.day'), () => send('stage', { id: m.stage, night: false }), { cls: 'dvf-chip', pressed: !m.night, testid: 'stage-day' }),
    button(doc, tt('fighter.ui.night'), () => send('stage', { id: m.stage, night: true }), { cls: 'dvf-chip', pressed: m.night, testid: 'stage-night' }));
  if (m.kind !== 'training') {
    group(tt('fighter.ui.difficulty'), ...[0, 1, 2, 3].map((l) => button(doc, tt(`fighter.ui.level.${l}`), () => send('cpu', { level: l }), { cls: 'dvf-chip', pressed: m.cpu === l, testid: `cpu-${l}` })));
    group(tt('fighter.ui.rounds'), ...[1, 2, 3].map((n) => button(doc, String(n), () => send('rounds', { n }), { cls: 'dvf-chip', pressed: m.rounds === n, testid: `rounds-${n}` })));
  }
  group(tt('fighter.ui.scheme'),
    button(doc, tt('fighter.ui.scheme.classic'), () => send('scheme', { scheme: 'classic' }), { cls: 'dvf-chip', pressed: m.scheme === 'classic', testid: 'scheme-classic' }),
    button(doc, tt('fighter.ui.scheme.simple'), () => send('scheme', { scheme: 'simple' }), { cls: 'dvf-chip', pressed: m.scheme === 'simple', testid: 'scheme-simple' }));
  c.append(opts);
  c.append(node(doc, 'p', 'dvf-note', tt(m.scheme === 'classic' ? 'fighter.ui.hint.classic' : 'fighter.ui.hint.simple')));
  const actions = node(doc, 'div', 'dvf-actions');
  actions.append(button(doc, tt('fighter.ui.back'), () => send('back'), { cls: 'dvf-btnx dvf-ghost', testid: 'select-back' }));
  actions.append(button(doc, tt('fighter.ui.start'), () => send('begin'), { cls: 'dvf-btnx dvf-go', testid: 'select-start' }));
  c.append(actions);
  return c;
}

function pause(doc: Document, m: MenuVm, send: Send): HTMLElement {
  const c = node(doc, 'div', 'dvf-card dvf-pause');
  c.dataset['testid'] = 'fighter-pause';
  c.append(node(doc, 'h2', '', tt('fighter.hud.paused')));
  const table = node(doc, 'table', 'dvf-moves');
  table.setAttribute('aria-label', tt('fighter.ui.moveList'));
  const head = node(doc, 'tr');
  for (const h of [tt('fighter.ui.moves'), tt('fighter.ui.move.input'), tt('fighter.ui.move.frames'), tt('fighter.ui.move.adv')]) head.append(node(doc, 'th', '', h));
  table.append(head);
  for (const mv of m.moveList) {
    const r = node(doc, 'tr');
    r.append(node(doc, 'td', '', tt(mv.nameKey)), node(doc, 'td', 'dvf-mono', mv.input), node(doc, 'td', 'dvf-mono', `${mv.S}/${mv.A}/${mv.R}`),
      node(doc, 'td', 'dvf-mono', `${signed(mv.advHit)} / ${signed(mv.advBlock)}`));
    table.append(r);
  }
  const scroll = node(doc, 'div', 'dvf-scroll');
  scroll.append(table);
  c.append(scroll);
  const actions = node(doc, 'div', 'dvf-actions');
  actions.append(button(doc, tt('fighter.ui.resume'), () => send('pause', { on: false }), { cls: 'dvf-btnx dvf-go', testid: 'pause-resume' }));
  actions.append(button(doc, tt('fighter.ui.restart'), () => send('rematch'), { testid: 'pause-restart' }));
  actions.append(button(doc, tt('fighter.ui.back'), () => send('back'), { cls: 'dvf-btnx dvf-ghost', testid: 'pause-back' }));
  c.append(actions);
  return c;
}

function results(doc: Document, m: MenuVm, send: Send): HTMLElement {
  const r = m.results;
  const c = node(doc, 'div', 'dvf-card dvf-results');
  c.dataset['testid'] = 'fighter-results';
  c.dataset['outcome'] = r?.outcome ?? '';
  c.append(node(doc, 'h2', '', r ? tt(`fighter.ui.result.${r.outcome}`) : ''));
  if (r) {
    c.append(node(doc, 'p', '', tt('fighter.ui.result.line', { a: r.rounds[0], b: r.rounds[1], sec: r.durationSec })));
    c.append(node(doc, 'p', 'dvf-note', tt('fighter.ui.result.xp', { xp: r.xp })));
  }
  const actions = node(doc, 'div', 'dvf-actions');
  if (m.origin === 'menu') {
    actions.append(button(doc, tt('fighter.ui.rematch'), () => send('rematch'), { cls: 'dvf-btnx dvf-go', testid: 'results-rematch' }));
    actions.append(button(doc, tt('fighter.ui.back'), () => send('back'), { testid: 'results-back' }));
    actions.append(button(doc, tt('fighter.ui.leave'), () => send('exit'), { cls: 'dvf-btnx dvf-ghost', testid: 'results-leave' }));
  } else {
    actions.append(button(doc, tt('fighter.ui.leave'), () => send('exit'), { cls: 'dvf-btnx dvf-go', testid: 'results-leave' }));
  }
  c.append(actions);
  return c;
}

/** The card of the current screen, or null when the match is on and nothing covers it. */
export function menuCard(doc: Document, m: MenuVm, send: Send): HTMLElement | null {
  switch (m.screen) {
    case 'hub': return hub(doc, m, send);
    case 'select': return select(doc, m, send);
    case 'results': return results(doc, m, send);
    case 'match': return m.paused ? pause(doc, m, send) : null;
  }
}
