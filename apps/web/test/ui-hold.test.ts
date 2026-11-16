/**
 * BD-FIX-MENU-BOOT-01: what the page notes on the engine's UiHold. A new page in the menus holds the 3D frames; input holds them only
 * while the gates are up; a running game never holds (play, the loading screen, recovery, and since the second round the pause page and
 * the phone over the game, and a quit the sim has not finished), and leaving the menus releases a hold in force. main.ts wires exactly
 * this (`wireUiHold`); the e2e gate timings (tests/e2e/ui/helpers.ts `passGates`) and the in-play case of tests/e2e/ui/hud.spec.ts
 * (@ui-pause) prove it in the browsers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATE_STATES, HOLD_INPUT, inMenus, MENU_STATES, wireUiHold, type UiHoldRoot, type UiHoldShell } from '../src/ui-hold.ts';

/** Every `ShellState` of packages/ui/src/shell/types.ts. */
const SHELL_STATES = ['Booting', 'Unsupported', 'Title', 'AgeGate', 'Blocked', 'Terms', 'Menu', 'Loading', 'InMode', 'Paused', 'Recovering', 'Error'];

class FakeShell implements UiHoldShell {
  state = 'Booting';
  page = 'boot';
  /** The `sys.mode` state of the engine's mode host. */
  modeState = 'Idle';
  private readonly subs = new Set<() => void>();
  currentPage(): string {
    return this.page;
  }
  mode(): { state: string } {
    return { state: this.modeState };
  }
  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }
  go(state: string, page: string, modeState = this.modeState): void {
    this.state = state;
    this.page = page;
    this.modeState = modeState;
    for (const cb of [...this.subs]) cb();
  }
  touch(): void {
    for (const cb of [...this.subs]) cb();
  }
  get listeners(): number {
    return this.subs.size;
  }
}

class FakeRoot implements UiHoldRoot {
  readonly handlers = new Map<string, () => void>();
  readonly options = new Map<string, AddEventListenerOptions>();
  addEventListener(type: string, cb: () => void, options: AddEventListenerOptions): void {
    this.handlers.set(type, cb);
    this.options.set(type, options);
  }
  removeEventListener(type: string): void {
    this.handlers.delete(type);
  }
  fire(type: string): void {
    this.handlers.get(type)?.();
  }
}

function wired() {
  const core = new FakeShell();
  const root = new FakeRoot();
  let notes = 0;
  let releases = 0;
  const off = wireUiHold({ core, root, hold: { note: () => void (notes += 1), release: () => void (releases += 1) } });
  return { core, root, off, notes: () => notes, releases: () => releases };
}

describe('wireUiHold', () => {
  it('a new page in the menus holds; the same page again (a redraw) does not', () => {
    const w = wired();
    w.core.go('Title', 'title');
    w.core.go('AgeGate', 'age');
    w.core.go('Terms', 'terms');
    w.core.go('Menu', 'main');
    expect(w.notes()).toBe(4);
    w.core.touch();
    w.core.touch();
    expect(w.notes()).toBe(4);
    w.core.go('Menu', 'new');
    w.core.go('Menu', 'creator');
    expect(w.notes()).toBe(6);
    expect(w.releases()).toBe(0);
  });

  it('the menus are the boot screen, the gates and the main menu; every state of a running game is outside them', () => {
    expect([...MENU_STATES].sort()).toEqual(['AgeGate', 'Blocked', 'Booting', 'Menu', 'Terms', 'Title']);
    for (const s of MENU_STATES) expect(SHELL_STATES).toContain(s);
    for (const s of ['Loading', 'InMode', 'Paused', 'Recovering']) {
      expect(MENU_STATES.has(s)).toBe(false);
      expect(inMenus({ state: s, mode: () => ({ state: 'Idle' }) })).toBe(false);
    }
    // a menu state while the sim still runs a mode (a quit on its way) is outside the menus too
    expect(inMenus({ state: 'Menu', mode: () => ({ state: 'Idle' }) })).toBe(true);
    for (const m of ['Loading', 'Entering', 'Running', 'Exiting', 'Suspended']) expect(inMenus({ state: 'Menu', mode: () => ({ state: m }) })).toBe(false);
  });

  it('play, the loading screen and recovery never hold', () => {
    const w = wired();
    w.core.go('Loading', 'loading');
    w.core.go('InMode', 'main', 'Running');
    w.core.go('Recovering', 'loading');
    w.core.go('Loading', 'loading');
    expect(w.notes()).toBe(0);
  });

  it('the pause page and the phone over a running game hold nothing (CI run 41518357422, sandbox-world.spec.ts)', () => {
    // Escape, the phone, its Sandbox app (the same page), Settings from Pause, back to Pause, Resume: what the in-play specs do
    const w = wired();
    w.core.go('InMode', 'main', 'Running');
    w.core.go('Paused', 'pause');
    w.core.go('Paused', 'phone');
    w.core.touch();
    w.core.go('Paused', 'pause');
    w.core.go('Paused', 'settings');
    w.core.go('Paused', 'pause');
    w.core.go('InMode', 'main');
    expect(w.notes()).toBe(0);
    // and no press or key in play holds either (Escape, the phone key)
    for (const state of ['InMode', 'Paused']) {
      w.core.state = state;
      for (const type of HOLD_INPUT) w.root.fire(type);
    }
    expect(w.notes()).toBe(0);
  });

  it('a hold in force when the shell leaves the menus is released at once', () => {
    const w = wired();
    w.core.go('Menu', 'main');
    w.core.go('Menu', 'creator');
    expect(w.notes()).toBe(2);
    // New Game's Start: the page closes and the shell is Loading in the same call (ShellCore.startMode)
    w.core.go('Loading', 'loading');
    expect(w.releases()).toBe(1);
    expect(w.notes()).toBe(2);
  });

  it('a quit opens the main menu without a hold while the sim still runs the mode; once the mode is idle the menus hold again', () => {
    const w = wired();
    w.core.go('InMode', 'main', 'Running');
    w.core.go('Paused', 'pause');
    // Quit: the shell is in Menu at once, the sim exits the mode afterwards
    w.core.go('Menu', 'main', 'Exiting');
    expect(w.notes()).toBe(0);
    w.core.go('Menu', 'main', 'Idle');
    expect(w.notes()).toBe(0);
    w.core.go('Menu', 'load');
    expect(w.notes()).toBe(1);
  });

  it('input holds while the gates are up, and nowhere else', () => {
    const w = wired();
    for (const state of ['Booting', 'Title', 'AgeGate', 'Terms', 'Blocked']) {
      w.core.state = state;
      for (const type of HOLD_INPUT) w.root.fire(type);
    }
    expect(w.notes()).toBe(5 * HOLD_INPUT.length);
    for (const state of ['Menu', 'InMode', 'Paused', 'Loading', 'Recovering']) {
      expect(GATE_STATES.has(state)).toBe(false);
      w.core.state = state;
      for (const type of HOLD_INPUT) w.root.fire(type);
    }
    expect(w.notes()).toBe(5 * HOLD_INPUT.length);
  });

  it('listens to presses, keys and typed text only, passive and in the capture phase; dispose removes everything', () => {
    const w = wired();
    expect([...w.root.handlers.keys()].sort()).toEqual(['input', 'keydown', 'pointerdown']);
    for (const o of w.root.options.values()) expect(o).toMatchObject({ capture: true, passive: true });
    expect(w.core.listeners).toBe(1);
    w.off();
    expect(w.root.handlers.size).toBe(0);
    expect(w.core.listeners).toBe(0);
  });

  it('main.ts creates the hold, wires it to the shell and hands it to createPlatform', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/const uiHold = new UiHold\(\);/);
    expect(main).toMatch(/wireUiHold\(\{ core: shell\.core, root, hold: uiHold \}\);/);
    expect(main).toMatch(/^\s+uiHold,$/m);
  });
});

describe('main.ts: the early sim worker (BD-FIX-WEBKIT-ATTACH-01/-02)', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  it('spawns it right after asset.worker through createPlatform, outside the asset worker factory', () => {
    expect(main).toMatch(/earlySimWorker\(\s*\(\) => new Worker\(new URL\('\.\/workers\/sim\.worker\.ts', import\.meta\.url\)/);
    expect(main).toMatch(/afterAssetWorker: \(\) => simWorker\.start\(\),/);
    const factory = /spawnAssetWorker: ([^\n]+)/.exec(main)?.[1] ?? '';
    expect(factory).toContain('asset.worker.ts');
    expect(factory).not.toContain('simWorker');
  });
  it('hands it to the first engine start, and disposes an untaken one on every failure path', () => {
    expect(main).toMatch(/spawn: \(\) => simWorker\.spawn\(\),/);
    // the platform failing, the engine failing, and anything thrown between them (boot's catch)
    expect(main.match(/simWorker\.dispose\(\);/g)?.length).toBe(3);
    expect(main).toMatch(/await bootPlatformAndEngine\(simWorker\);\s*\} catch \(error\) \{[^}]*simWorker\.dispose\(\);\s*throw error;/);
  });
});

