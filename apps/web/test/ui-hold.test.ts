/**
 * BD-FIX-MENU-BOOT-01: what the page notes on the engine's UiHold. A new page outside play holds the 3D frames; input holds them only
 * while the gates are up; play, the loading screen and recovery never hold. main.ts wires exactly this (`wireUiHold`), and the e2e gate
 * timings (tests/e2e/ui/helpers.ts `passGates`) prove it in the browsers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATE_STATES, HOLD_INPUT, PLAY_STATES, wireUiHold, type UiHoldRoot, type UiHoldShell } from '../src/ui-hold.ts';

class FakeShell implements UiHoldShell {
  state = 'Booting';
  page = 'boot';
  private readonly subs = new Set<() => void>();
  currentPage(): string {
    return this.page;
  }
  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }
  go(state: string, page: string): void {
    this.state = state;
    this.page = page;
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
  const off = wireUiHold({ core, root, hold: { note: () => void (notes += 1) } });
  return { core, root, off, notes: () => notes };
}

describe('wireUiHold', () => {
  it('a new page outside play holds; the same page again (a redraw) does not', () => {
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
    w.core.go('Paused', 'pause');
    expect(w.notes()).toBe(6);
  });

  it('play, the loading screen and recovery never hold, not even for the phone over the game', () => {
    const w = wired();
    w.core.go('Loading', 'loading');
    w.core.go('InMode', 'main');
    w.core.go('InMode', 'phone');
    w.core.go('Recovering', 'loading');
    expect(w.notes()).toBe(0);
    for (const s of ['InMode', 'Loading', 'Recovering']) expect(PLAY_STATES.has(s)).toBe(true);
  });

  it('input holds while the gates are up, and nowhere else', () => {
    const w = wired();
    for (const state of ['Booting', 'Title', 'AgeGate', 'Terms', 'Blocked']) {
      w.core.state = state;
      for (const type of HOLD_INPUT) w.root.fire(type);
    }
    expect(w.notes()).toBe(5 * HOLD_INPUT.length);
    for (const state of ['Menu', 'InMode', 'Paused', 'Loading']) {
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

