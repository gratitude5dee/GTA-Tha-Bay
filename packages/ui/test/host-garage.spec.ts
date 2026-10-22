import { describe, expect, it, vi } from 'vitest';
import type { GameModeUI, UiCommand, ViewModelSource } from '@dv/shared';
import { mountModeUi } from '../src/host/mode-ui-host.ts';
import { cardAction, cardTitle, garageCards, garageScreen } from '../src/pages/garage.tsx';

/** A DOM stand-in just big enough for the failure panel. */
class FakeEl {
  children: FakeEl[] = [];
  text = '';
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  type = '';
  attrs: Record<string, string> = {};
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  addEventListener(t: string, cb: () => void): void {
    this.listeners.set(t, cb);
  }
  find(testid: string): FakeEl | null {
    if (this.dataset['testid'] === testid) return this;
    for (const c of this.children) {
      const f = c.find(testid);
      if (f) return f;
    }
    return null;
  }
}
const fakeDoc = { createElement: () => new FakeEl() } as unknown as Document;
const vm: ViewModelSource = { get: () => undefined, subscribe: () => () => undefined, rev: 0 };

describe('GameModeUI host (AC-10)', () => {
  it('a mounting view receives root, vm and send, and unmount runs the view unmount', () => {
    const seen: { root: unknown; vm: unknown; send: unknown }[] = [];
    const ui: GameModeUI = { mount: (h) => void seen.push(h), unmount: vi.fn(), inputContexts: ['onFoot'] };
    const root = new FakeEl();
    const send = vi.fn();
    const m = mountModeUi(ui, root as unknown as HTMLElement, { vm, send, report: vi.fn(), doc: fakeDoc });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.root).toBe(root);
    expect(seen[0]!.vm).toBe(vm);
    expect(typeof seen[0]!.send).toBe('function');
    expect(m.failed).toBe(false);
    m.unmount();
    expect(ui.unmount).toHaveBeenCalledTimes(1);
  });

  it('a throwing mount shows the failure panel and one err.js, and the button quits the mode', () => {
    const ui: GameModeUI = { mount: () => { throw new Error('boom'); }, unmount: vi.fn(), inputContexts: [] };
    const root = new FakeEl();
    const report = vi.fn();
    const send = vi.fn<(c: UiCommand) => void>();
    const onFail = vi.fn();
    const m = mountModeUi(ui, root as unknown as HTMLElement, { vm, send, report, onFail, doc: fakeDoc });
    expect(m.failed).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toBe('err.js');
    expect(report.mock.calls[0]![1]).toMatchObject({ msg: 'Error: boom' });
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('This screen failed');
    root.find('mode-ui-back')!.listeners.get('click')!();
    expect(send).toHaveBeenCalledWith({ t: 'mode.quit' });
    m.unmount();
    expect(ui.unmount).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a throwing unmount is reported once too', () => {
    const ui: GameModeUI = { mount: () => undefined, unmount: () => { throw new Error('late'); }, inputContexts: [] };
    const report = vi.fn();
    const m = mountModeUi(ui, new FakeEl() as unknown as HTMLElement, { vm, send: vi.fn(), report, doc: fakeDoc });
    m.unmount();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('garage frame (AC-10)', () => {
  it('cards render from partial VehicleInstance objects and skip entries without a key', () => {
    const cards = garageCards([
      { key: 'veh:1', prefab: 'vehicle.sedan', class: 'c', damage: 0.25, vehicleHeat: 2, impoundStrikes: 1, plate: 'BAY 123' },
      { key: 'veh:2' },
      { prefab: 'no key' },
      null,
      7,
      { key: 'veh:3', nickname: 'Fog Horn', class: 'zz', damage: 40 },
    ]);
    expect(cards.map((c) => c.key)).toEqual(['veh:1', 'veh:2', 'veh:3']);
    expect(cards[0]).toMatchObject({ cls: 'C', damagePct: 25, heat: 2, strikes: 1, plate: 'BAY 123' });
    expect(cards[1]).toMatchObject({ cls: null, damagePct: 0, heat: 0, strikes: 0 });
    expect(cards[2]).toMatchObject({ cls: null, damagePct: 40 });
    expect(cardTitle(cards[0]!)).toBe('sedan');
    expect(cardTitle(cards[2]!)).toBe('Fog Horn');
    expect(cardTitle(cards[1]!)).toBe('Unnamed car');
  });

  it('the empty state shows the "no vehicle" text', () => {
    for (const raw of [undefined, null, [], {}]) {
      const s = garageScreen(garageCards(raw), false);
      expect(s.children.some((w) => w.k === 'text' && w.text === 'garage.empty')).toBe(true);
    }
  });

  it('Call and Set as favourite each send exactly one command with the card vehicleKey', () => {
    const cards = garageCards([{ key: 'veh:7', prefab: 'vehicle.coupe' }]);
    const world = garageScreen(cards, true);
    const menu = garageScreen(cards, false);
    const rowsOf = (s: ReturnType<typeof garageScreen>): string[] => s.children.flatMap((w) => (w.k === 'list' ? w.rows.map((r) => r.id) : []));
    expect(rowsOf(world)).toEqual(['call:veh:7']);
    expect(rowsOf(menu)).toEqual(['fav:veh:7']);
    expect(cardAction('call:veh:7')).toEqual({ t: 'garage.call', vehicleKey: 'veh:7' });
    expect(cardAction('fav:veh:7')).toEqual({ t: 'garage.favorite', vehicleKey: 'veh:7' });
    expect(cardAction('nope:veh:7')).toBeNull();
    expect(cardAction('call:')).toBeNull();
  });
});
