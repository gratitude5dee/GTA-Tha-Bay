// Test doubles for the media modules (the unit environment is node: no DOM).
export class FakeVideo {
  attrs = new Map<string, string>();
  muted = false;
  playsInline = false;
  disableRemotePlayback = false;
  crossOrigin: string | null = null;
  preload = '';
  src = '';
  srcObject: unknown = null;
  style: Record<string, string> = {};
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  rejectPlay: string | null = null;
  constructor(public readonly canPlay: (type: string) => string = () => 'probably') {}
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
    if (n === 'src') this.src = v;
  }
  getAttribute(n: string): string | null {
    return this.attrs.get(n) ?? null;
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
    if (n === 'src') this.src = '';
  }
  canPlayType(t: string): string {
    return this.canPlay(t);
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(Object.assign(new Error('x'), { name: this.rejectPlay }));
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
  }
  load(): void {
    this.loadCalls++;
  }
}

export class FakeEl {
  children: unknown[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  appendChild(c: unknown): unknown {
    this.children = this.children.filter((x) => x !== c);
    this.children.push(c);
    return c;
  }
  removeChild(c: unknown): unknown {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
}

export class FakeTarget {
  listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(t: string, l: (e: unknown) => void): void {
    (this.listeners.get(t) ?? this.listeners.set(t, new Set()).get(t))?.add(l);
  }
  removeEventListener(t: string, l: (e: unknown) => void): void {
    this.listeners.get(t)?.delete(l);
  }
  fire(t: string): void {
    for (const l of [...(this.listeners.get(t) ?? [])]) l({ type: t });
  }
  count(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}
