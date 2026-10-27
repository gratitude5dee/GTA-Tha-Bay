/**
 * The fight HUD (FX9): two health bars with names and round pips, the timer, Hype as three diamonds, Composure as six squares with a
 * hatched Rattled state, the combo counter with its scaling per cent, an optional input display and the round banner. The view model
 * (`hudModel`) is a pure function of `mode.fighter.view`; `HudView` draws it. Colour is never the only cue: stocks are filled or
 * outlined shapes, Rattled is a hatch pattern, the leader of a combo has a label. Colour palettes (deutan, protan, tritan) are CSS
 * variables set by `data-palette` on the root.
 */
import { fighterPack } from '../sim/data.ts';
import type { FightView } from '../sim/vm.ts';
import { tt } from './text.ts';

const PHASE = { Load: 0, Intro: 1, Ready: 2, Fight: 3, Ko: 4, TimeUp: 5, Shutdown: 6, Cinematic: 7, RoundEnd: 8, MatchEnd: 9 } as const;

export interface HudSide {
  name: string;
  hp: number;
  hpPct: number;
  /** One flag per round needed to win: true once won. */
  pips: boolean[];
  hypeStocks: number;
  hypeFrac: number;
  compFull: number;
  compFrac: number;
  rattled: boolean;
  /** The combo this side is landing on the other (hits and damage scaling per cent), 0 when none. */
  combo: number;
  scale: number;
  invuln: boolean;
}

export interface HudModel {
  sides: [HudSide, HudSide];
  timer: string;
  banner: string | null;
  phase: number;
  /** Inputs of slot 0 for the input display: `[word, frames held]`. */
  inputs: number[][];
}

const HEALTH_MAX = 10000;

function comboScale(hits: number): number {
  const t = fighterPack().tuning;
  if (hits <= 0) return 100;
  return Math.max(t.SCALE_FLOOR, t.COMBO_SCALE[Math.min(t.COMBO_SCALE.length, hits) - 1] as number);
}

export function bannerOf(phase: number, pf: number, round: number, win: 0 | 1 | -1): string | null {
  switch (phase) {
    case PHASE.Ready: return pf < 36 ? tt('fighter.hud.round', { n: round }) : tt('fighter.hud.fight');
    case PHASE.Fight: return pf < 40 ? tt('fighter.hud.fight') : null;
    case PHASE.Ko: case PHASE.RoundEnd: return pf < 80 ? tt('fighter.hud.ko') : null;
    case PHASE.TimeUp: return tt('fighter.hud.time');
    case PHASE.MatchEnd: return win === 0 ? tt('fighter.hud.win') : win === 1 ? tt('fighter.hud.lose') : null;
    default: return null;
  }
}

/**
 * The HUD model of a view. `names` are the display names of the two fighters, `roundsToWin` and `timerMax` come from the match rules
 * (the view carries them as `rtw` and `tmx`); `winner` is the slot that won the match once it ended.
 */
export function hudModel(v: FightView & { rtw?: number; tmx?: number; ih?: number[][]; wn?: number }, names: [string, string]): HudModel {
  const rtw = v.rtw ?? 2;
  const side = (i: 0 | 1): HudSide => {
    const f = v.f[i];
    const other = v.f[i === 0 ? 1 : 0];
    const hp = Math.max(0, f[7]);
    const full = Math.min(6, Math.floor(f[9] / 1000));
    return {
      name: names[i],
      hp,
      hpPct: Math.max(0, Math.min(100, (hp * 100) / HEALTH_MAX)),
      pips: Array.from({ length: rtw }, (_, k) => k < v.rw[i]),
      hypeStocks: Math.min(3, Math.floor(f[8] / 1000)),
      hypeFrac: (f[8] % 1000) / 1000,
      compFull: full,
      compFrac: full >= 6 ? 0 : (f[9] % 1000) / 1000,
      rattled: f[10] !== 0,
      combo: other[11] > 1 ? other[11] : 0,
      scale: comboScale(other[11]),
      invuln: f[14] !== 0,
    };
  };
  const tmx = v.tmx ?? 0;
  const timer = tmx === 0 ? '--' : String(Math.max(0, Math.ceil(v.tm / 60)));
  return {
    sides: [side(0), side(1)],
    timer,
    banner: bannerOf(v.ph, v.pf, v.rd, (v.wn ?? -1) as 0 | 1 | -1),
    phase: v.ph,
    inputs: v.ih ?? [],
  };
}

// ---- DOM ------------------------------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = cls;
  parent?.append(e);
  return e;
}

/** A numpad arrow label of a FighterInput word as seen by a fighter facing `facing` (+1 right): the glyph is drawn with CSS, this is its data. */
export function numpad(word: number, facing: number): number {
  const up = (word & 1) !== 0, down = (word & 2) !== 0 && !up;
  let h = 0;
  if ((word & 8) !== 0) h += 1;
  if ((word & 4) !== 0) h -= 1;
  if (facing < 0) h = -h;
  return (up ? 7 : down ? 1 : 4) + (h + 1);
}

const BUTTON_LABELS: [number, string][] = [[16, 'LP'], [32, 'MP'], [64, 'HP'], [128, 'LK'], [256, 'MK'], [512, 'HK'], [1024, 'SP'], [2048, 'AS'], [4096, 'HY'], [8192, 'TA'], [16384, 'BL'], [32768, 'DA']];
export const buttonsOf = (word: number): string => BUTTON_LABELS.filter(([b]) => (word & b) !== 0).map(([, n]) => n).join('+');

export class HudView {
  readonly root: HTMLElement;
  private readonly bars: { name: HTMLElement; hp: HTMLElement; hpText: HTMLElement; pips: HTMLElement; hype: HTMLElement; comp: HTMLElement; tag: HTMLElement }[] = [];
  private timer!: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly combos: HTMLElement[] = [];
  private readonly inputs: HTMLElement;
  private lastBanner = '';
  private bannerAt = 0;

  constructor(doc: Document) {
    this.root = el(doc, 'div', 'dvf-hud');
    this.root.setAttribute('aria-hidden', 'false');
    const top = el(doc, 'div', 'dvf-top', this.root);
    for (let i = 0; i < 2; i++) {
      const side = el(doc, 'div', `dvf-side dvf-s${i}`, top);
      const name = el(doc, 'div', 'dvf-name', side);
      const hpWrap = el(doc, 'div', 'dvf-hpwrap', side);
      hpWrap.setAttribute('role', 'progressbar');
      hpWrap.setAttribute('aria-label', tt('fighter.hud.health'));
      const hp = el(doc, 'div', 'dvf-hp', hpWrap);
      const hpText = el(doc, 'span', 'dvf-hptext', hpWrap);
      const pips = el(doc, 'div', 'dvf-pips', side);
      const meters = el(doc, 'div', 'dvf-meters', side);
      const hype = el(doc, 'div', 'dvf-hype', meters);
      hype.setAttribute('aria-label', tt('fighter.hud.hype'));
      const comp = el(doc, 'div', 'dvf-comp', meters);
      comp.setAttribute('aria-label', tt('fighter.hud.composure'));
      const tag = el(doc, 'div', 'dvf-tag', side);
      this.bars.push({ name, hp, hpText, pips, hype, comp, tag });
      if (i === 0) {
        this.timer = el(doc, 'div', 'dvf-timer', top);
        this.timer.setAttribute('aria-label', tt('fighter.hud.timer'));
      }
    }
    for (let i = 0; i < 2; i++) this.combos.push(el(doc, 'div', `dvf-combo dvf-c${i}`, this.root));
    this.banner = el(doc, 'div', 'dvf-banner', this.root);
    this.banner.setAttribute('role', 'status');
    this.inputs = el(doc, 'div', 'dvf-inputs', this.root);
  }

  /** Draws a model. Cheap enough for every tick: it touches text and styles only when they change. */
  render(m: HudModel, now: number, facing: number): void {
    const doc = this.root.ownerDocument;
    for (let i = 0; i < 2; i++) {
      const s = m.sides[i as 0 | 1];
      const b = this.bars[i] as (typeof this.bars)[number];
      if (b.name.textContent !== s.name) b.name.textContent = s.name;
      b.hp.style.width = `${s.hpPct.toFixed(1)}%`;
      b.hpText.textContent = String(Math.round(s.hp / 100));
      b.hp.dataset['low'] = s.hpPct < 25 ? '1' : '0';
      if (b.pips.childElementCount !== s.pips.length) {
        b.pips.textContent = '';
        for (let k = 0; k < s.pips.length; k++) el(doc, 'i', 'dvf-pip', b.pips);
      }
      for (let k = 0; k < s.pips.length; k++) (b.pips.children[k] as HTMLElement).dataset['on'] = s.pips[k] ? '1' : '0';
      if (b.hype.childElementCount !== 3) {
        b.hype.textContent = '';
        for (let k = 0; k < 3; k++) el(doc, 'i', 'dvf-dia', b.hype);
      }
      for (let k = 0; k < 3; k++) {
        const d = b.hype.children[k] as HTMLElement;
        d.dataset['on'] = k < s.hypeStocks ? '1' : '0';
        d.style.setProperty('--fill', k === s.hypeStocks ? s.hypeFrac.toFixed(2) : k < s.hypeStocks ? '1' : '0');
      }
      if (b.comp.childElementCount !== 6) {
        b.comp.textContent = '';
        for (let k = 0; k < 6; k++) el(doc, 'i', 'dvf-sq', b.comp);
      }
      b.comp.dataset['rattled'] = s.rattled ? '1' : '0';
      for (let k = 0; k < 6; k++) {
        const q = b.comp.children[k] as HTMLElement;
        q.dataset['on'] = k < s.compFull ? '1' : '0';
        q.style.setProperty('--fill', k === s.compFull ? s.compFrac.toFixed(2) : k < s.compFull ? '1' : '0');
      }
      const tag = s.rattled ? tt('fighter.hud.rattled') : '';
      if (b.tag.textContent !== tag) b.tag.textContent = tag;
      const c = this.combos[i] as HTMLElement;
      if (s.combo > 1) {
        c.textContent = `${tt('fighter.hud.hits', { n: s.combo })}  ${tt('fighter.hud.scale', { pct: s.scale })}`;
        c.dataset['on'] = '1';
      } else c.dataset['on'] = '0';
    }
    if (this.timer.textContent !== m.timer) this.timer.textContent = m.timer;
    const text = m.banner ?? '';
    if (text !== this.lastBanner) { this.lastBanner = text; this.bannerAt = now; this.banner.textContent = text; }
    this.banner.dataset['on'] = text ? '1' : '0';
    void this.bannerAt;
    // input display: the last inputs as numpad digit + buttons
    if (m.inputs.length === 0) { this.inputs.dataset['on'] = '0'; return; }
    this.inputs.dataset['on'] = '1';
    const rows = m.inputs.slice(-8).reverse();
    const sig = rows.map((r) => `${r[0]}:${Math.min(99, r[1] as number)}`).join(',');
    if (this.inputs.dataset['sig'] === sig) return;
    this.inputs.dataset['sig'] = sig;
    this.inputs.textContent = '';
    for (const r of rows) {
      const row = el(doc, 'div', 'dvf-in', this.inputs);
      const dir = numpad(r[0] as number, facing);
      el(doc, 'b', `dvf-dir dvf-d${dir}`, row).textContent = String(dir);
      el(doc, 'span', 'dvf-btn', row).textContent = buttonsOf(r[0] as number);
      el(doc, 'em', 'dvf-age', row).textContent = String(Math.min(99, r[1] as number));
    }
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }
}
