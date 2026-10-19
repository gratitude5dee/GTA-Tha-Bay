import { describe, expect, it } from 'vitest';
import { applyBoundaryFog } from '../src/client/boundary-fog.ts';
import { FADE_SAFETY_MS, TeleportFade, type FadeHost } from '../src/client/teleport-fade.ts';

/** Just enough DOM for the veil: an element with a style bag, a dataset, append and remove. */
function fakeParent(reducedMotion = false): { parent: HTMLElement; made: { style: Record<string, string>; dataset: Record<string, string>; removed: boolean }[] } {
  const made: { style: Record<string, string>; dataset: Record<string, string>; removed: boolean }[] = [];
  const doc = {
    createElement: () => {
      const el = { style: { cssText: '' } as Record<string, string>, dataset: {} as Record<string, string>, removed: false, setAttribute: () => undefined, remove() { this.removed = true; } };
      made.push(el);
      return el;
    },
    defaultView: { matchMedia: () => ({ matches: reducedMotion }) },
  };
  const parent = { ownerDocument: doc, append: () => undefined } as unknown as HTMLElement;
  return { parent, made };
}

function fakeTimers(): FadeHost & { fire(): void; pending(): number } {
  let next: (() => void) | null = null;
  return {
    setTimeout: (fn) => {
      next = fn;
      return 1;
    },
    clearTimeout: () => {
      next = null;
    },
    fire: () => {
      const f = next;
      next = null;
      f?.();
    },
    pending: () => (next ? 1 : 0),
  };
}

describe('TeleportFade', () => {
  it('goes black on out, clears on in, and keeps the order it was asked in', () => {
    const { parent, made } = fakeParent();
    const timers = fakeTimers();
    const fade = new TeleportFade(parent, timers);
    const el = made[0]!;
    expect(el.dataset['testid']).toBe('teleport-fade');
    expect(fade.state).toBe('clear');
    expect(el.style['cssText']).toContain('opacity:0');
    expect(el.style['cssText']).toContain('transition:opacity 200ms linear');
    fade.out();
    expect(fade.state).toBe('out');
    expect(el.style['opacity']).toBe('1');
    expect(timers.pending()).toBe(1);
    fade.in();
    expect(fade.state).toBe('in');
    expect(el.style['opacity']).toBe('0');
    expect(timers.pending()).toBe(0);
    expect(fade.log).toEqual(['out', 'in']);
  });

  it('lifts the veil by itself when the in event never comes', () => {
    const { parent, made } = fakeParent();
    const timers = fakeTimers();
    const fade = new TeleportFade(parent, timers);
    fade.out();
    expect(FADE_SAFETY_MS).toBeGreaterThan(5000);
    timers.fire();
    expect(fade.state).toBe('in');
    expect(made[0]!.style['opacity']).toBe('0');
    expect(fade.log).toEqual(['out', 'in']);
  });

  it('switches without a transition under reduced motion, and removes the element on dispose', () => {
    const { parent, made } = fakeParent(true);
    const fade = new TeleportFade(parent, fakeTimers());
    expect(made[0]!.style['cssText']).toContain('transition:none');
    fade.dispose();
    expect(made[0]!.removed).toBe(true);
  });
});

describe('applyBoundaryFog', () => {
  const nodes = (near: number, far: number) => ({ uFogNear: { value: near }, uFogFar: { value: far } });

  it('scales the far plane by the factor and keeps the near plane at most half of it', () => {
    const n = nodes(800, 20000);
    applyBoundaryFog(n as never, 0.4);
    expect(n.uFogFar.value).toBe(8000);
    expect(n.uFogNear.value).toBe(800);
    const tight = nodes(800, 1500);
    applyBoundaryFog(tight as never, 0.4);
    expect(tight.uFogFar.value).toBe(600);
    expect(tight.uFogNear.value).toBe(300);
  });

  it('does nothing at 1, above 1 or without a factor', () => {
    for (const f of [1, 1.5, undefined]) {
      const n = nodes(800, 20000);
      applyBoundaryFog(n as never, f);
      expect(n.uFogFar.value).toBe(20000);
      expect(n.uFogNear.value).toBe(800);
    }
  });

  it('never closes the fog to nothing', () => {
    const n = nodes(800, 20000);
    applyBoundaryFog(n as never, 0);
    expect(n.uFogFar.value).toBe(1000);
  });
});
