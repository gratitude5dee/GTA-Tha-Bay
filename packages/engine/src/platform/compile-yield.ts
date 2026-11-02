/**
 * The yield three's `compileAsync` takes between render objects, on browsers without `scheduler.yield` (BD-FIX-WEBKIT-ATTACH-01).
 *
 * three r186's `Renderer.compileAsync(scene, camera)` builds the render objects it collected one after another and awaits
 * `yieldToMain()` (three/src/utils.js) after each: `self.scheduler.yield()` where the browser has it, otherwise one
 * `requestAnimationFrame`. Safari has no `scheduler.yield` on macOS or iOS (research/stack-rendering-platform.md section 2), so there
 * every compiled object waits for the next display frame, whether or not it needs a new program: the 480 objects of the desktop
 * benchmark rung took 2.4 s on webkit-webgl2 against 0.13 s on Chromium, which has `scheduler.yield`. At 60 Hz the 120 and 80 objects
 * of the mobile and mobile-low rungs, the iPhone's path (Q-10), would wait about 2.0 and 1.3 s of frames before their 3 s windows
 * start (an estimate: one frame per object). The work itself is not slower on WebKit; the frames are the wait.
 *
 * 11-platform-pwa.md section 6 answers the missing API on iOS with a wrapper over `MessageChannel`. This installs one as
 * `scheduler.yield` where the browser has none: each call resolves from a `MessageChannel` task, a macrotask yield like the native one,
 * without the frame. On WebKit timers and frames keep running through a chain of them (unlike Chromium's native `scheduler.yield`,
 * whose continuations run ahead of timers). A browser that has `scheduler.yield` keeps its own. Only three reads `scheduler.yield` in
 * the client bundle; nothing in it reads `scheduler.postTask`.
 */

/** The part of `scheduler` this module reads and writes. */
export interface YieldScheduler {
  yield?: () => Promise<void>;
}

/** The part of the global scope this module reads and writes (`globalThis` in a page). */
export interface YieldScope {
  scheduler?: YieldScheduler;
  MessageChannel?: new () => { port1: MessagePortLike; port2: MessagePortLike };
}

export interface MessagePortLike {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
}

/**
 * A `scheduler.yield` stand-in over one `MessageChannel`: each call posts a message and resolves when that message is delivered, in
 * call order. The port is started by setting `onmessage`.
 */
export function messageChannelYield(Channel: NonNullable<YieldScope['MessageChannel']>): () => Promise<void> {
  const { port1, port2 } = new Channel();
  const waiting: (() => void)[] = [];
  port1.onmessage = () => waiting.shift()?.();
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      port2.postMessage(null);
    });
}

/**
 * Installs `scheduler.yield` on `scope` when it has none. Returns `native` when the scope already had one (left as it is), `installed`
 * when this added it, `unavailable` when the scope has no `MessageChannel` (three keeps its frame yield there).
 */
export function installSchedulerYield(scope: YieldScope): 'native' | 'installed' | 'unavailable' {
  if (typeof scope.scheduler?.yield === 'function') return 'native';
  if (typeof scope.MessageChannel !== 'function') return 'unavailable';
  const yieldNow = messageChannelYield(scope.MessageChannel);
  if (scope.scheduler && typeof scope.scheduler === 'object') {
    Object.defineProperty(scope.scheduler, 'yield', { value: yieldNow, configurable: true, writable: true, enumerable: false });
  } else {
    const scheduler: YieldScheduler = {};
    Object.defineProperty(scheduler, 'yield', { value: yieldNow, configurable: true, writable: true, enumerable: false });
    Object.defineProperty(scope, 'scheduler', { value: scheduler, configurable: true, writable: true, enumerable: false });
  }
  return 'installed';
}
