import { afterEach, describe, expect, it } from 'vitest';
import { installSchedulerYield, messageChannelYield, type YieldScope } from '../../src/platform/compile-yield.ts';
import { createWebGpuRenderer } from '../../src/platform/renderer-host.ts';

/** Node's MessageChannel, with every port it made closed after each case (an open port would keep the worker alive). */
const opened: MessagePort[] = [];
const NodeChannel = MessageChannel;
class TrackedChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
  constructor() {
    const c = new NodeChannel();
    this.port1 = c.port1;
    this.port2 = c.port2;
    opened.push(c.port1, c.port2);
  }
}
afterEach(() => {
  for (const p of opened.splice(0)) p.close();
});

const Channel = TrackedChannel as unknown as NonNullable<YieldScope['MessageChannel']>;

describe('scheduler.yield for three compileAsync (BD-FIX-WEBKIT-ATTACH-01)', () => {
  it('installs a MessageChannel yield where the scope has no scheduler (Safari)', async () => {
    const scope: YieldScope = { MessageChannel: Channel };
    expect(installSchedulerYield(scope)).toBe('installed');
    expect(typeof scope.scheduler?.yield).toBe('function');
    // three's yieldToMain reads it as `self.scheduler.yield()`
    await expect(scope.scheduler?.yield?.()).resolves.toBeUndefined();
  });

  it('keeps a native scheduler.yield (Chromium) untouched', () => {
    const native = (): Promise<void> => Promise.resolve();
    const scope: YieldScope = { scheduler: { yield: native }, MessageChannel: Channel };
    expect(installSchedulerYield(scope)).toBe('native');
    expect(scope.scheduler?.yield).toBe(native);
  });

  it('adds yield to a scheduler that lacks it and keeps what it has', () => {
    const postTask = (): void => undefined;
    const scheduler = { postTask } as { postTask: () => void; yield?: () => Promise<void> };
    const scope: YieldScope = { scheduler, MessageChannel: Channel };
    expect(installSchedulerYield(scope)).toBe('installed');
    expect(scope.scheduler).toBe(scheduler);
    expect(scheduler.postTask).toBe(postTask);
    expect(typeof scheduler.yield).toBe('function');
    // not enumerable: code that lists the scheduler's members sees what the browser put there
    expect(Object.keys(scheduler)).toEqual(['postTask']);
  });

  it('leaves a scope without MessageChannel alone (three keeps its frame yield there)', () => {
    const scope: YieldScope = {};
    expect(installSchedulerYield(scope)).toBe('unavailable');
    expect(scope.scheduler).toBeUndefined();
  });

  it('installs once: a second call finds the yield it installed', () => {
    const scope: YieldScope = { MessageChannel: Channel };
    expect(installSchedulerYield(scope)).toBe('installed');
    const first = scope.scheduler?.yield;
    expect(installSchedulerYield(scope)).toBe('native');
    expect(scope.scheduler?.yield).toBe(first);
  });

  it('is a task, not a microtask: queued microtasks run first, and calls resolve in order', async () => {
    const y = messageChannelYield(Channel);
    const order: string[] = [];
    const done = Promise.all([y().then(() => order.push('yield 1')), y().then(() => order.push('yield 2'))]);
    queueMicrotask(() => order.push('microtask'));
    await done;
    expect(order).toEqual(['microtask', 'yield 1', 'yield 2']);
  });

  it('does not wait for a frame: a long chain of yields finishes in well under one 60 Hz frame per yield', async () => {
    const y = messageChannelYield(Channel);
    const t0 = performance.now();
    for (let i = 0; i < 480; i++) await y();
    // 480 render objects of the desktop benchmark rung: one frame each would be 8 s at 60 Hz
    expect(performance.now() - t0).toBeLessThan(480 * 16.7 * 0.25);
  });

  it('Chromium 94 to 128 (a scheduler with postTask, without yield): the stand-in goes on the browser object (BD-FIX-WEBKIT-ATTACH-02)', async () => {
    const scheduler = { postTask: (cb: () => void): Promise<void> => Promise.resolve(cb()) } as { postTask: (cb: () => void) => Promise<void>; yield?: () => Promise<void> };
    const scope: YieldScope = { scheduler, MessageChannel: Channel };
    expect(installSchedulerYield(scope)).toBe('installed');
    await expect(scheduler.yield?.()).resolves.toBeUndefined();
  });

  it('never throws: a frozen scheduler or a throwing MessageChannel leaves the scope as it was (BD-FIX-WEBKIT-ATTACH-02)', () => {
    const frozen = Object.freeze({ postTask: (): void => undefined }) as NonNullable<YieldScope['scheduler']>;
    const a: YieldScope = { scheduler: frozen, MessageChannel: Channel };
    expect(installSchedulerYield(a)).toBe('failed');
    expect(a.scheduler).toBe(frozen);
    expect(frozen.yield).toBeUndefined();

    const Throwing = class {
      constructor() {
        throw new Error('MessageChannel unavailable');
      }
    } as unknown as NonNullable<YieldScope['MessageChannel']>;
    const b: YieldScope = { MessageChannel: Throwing };
    expect(installSchedulerYield(b)).toBe('failed');
    expect(b.scheduler).toBeUndefined();
  });
});

describe('the renderer factory installs the yield before three runs (BD-FIX-WEBKIT-ATTACH-02)', () => {
  it('createWebGpuRenderer leaves a scheduler.yield on a global scope that had none', () => {
    const g = globalThis as unknown as YieldScope;
    // Node has no `scheduler` global, as Safari has none; the test puts back whatever it finds.
    const before = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
    if (before) delete (globalThis as { scheduler?: unknown }).scheduler;
    // The installed yield's ports are tracked, so afterEach closes them.
    const NativeChannel = globalThis.MessageChannel;
    globalThis.MessageChannel = TrackedChannel as unknown as typeof MessageChannel;
    try {
      expect(g.scheduler).toBeUndefined();
      const canvas = { width: 640, height: 360, style: {}, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as HTMLCanvasElement;
      const renderer = createWebGpuRenderer({ canvas, forceWebGL: true, xr: false, multiview: false, hdr: false, trackTimestamp: false, requiredLimits: undefined });
      expect(renderer).toBeDefined();
      expect(typeof g.scheduler?.yield).toBe('function');
    } finally {
      globalThis.MessageChannel = NativeChannel;
      delete (globalThis as { scheduler?: unknown }).scheduler;
      if (before) Object.defineProperty(globalThis, 'scheduler', before);
    }
  });
});
