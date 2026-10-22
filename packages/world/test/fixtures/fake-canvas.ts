/**
 * A recording Canvas 2D context for the map specs (no DOM): every method call is logged as `[name, ...args]`, every assignment to
 * `fillStyle` or `strokeStyle` adds a colour to `colors`, and the transform stack is replayed so `translate` calls can be read as
 * absolute screen positions when a test needs them.
 */
export interface Recorded {
  ops: [string, ...unknown[]][];
  colors: Set<string>;
  count(name: string): number;
  clear(): void;
}

export interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
  rec: Recorded;
}

export function fakeCanvas(width = 160, height = 160): FakeCanvas {
  const rec: Recorded = {
    ops: [],
    colors: new Set(),
    count(name) {
      return this.ops.filter((o) => o[0] === name).length;
    },
    clear() {
      this.ops.length = 0;
      this.colors.clear();
    },
  };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (prop === 'canvas') return { width, height };
      return (...args: unknown[]) => {
        rec.ops.push([prop, ...args]);
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      if ((prop === 'fillStyle' || prop === 'strokeStyle') && typeof value === 'string') rec.colors.add(value);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { width, height, getContext: () => ctx, rec };
}

/** A fake tile image. */
export interface FakeTile {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}
export function fakeTile(): FakeTile {
  return {
    width: 256,
    height: 256,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}
