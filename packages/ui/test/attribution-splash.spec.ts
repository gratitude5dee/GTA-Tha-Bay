import { describe, expect, it } from 'vitest';
import { scheduleSplashEnd, SPLASH_ATTRIBUTION_MS, splashLine, type SplashClock } from '../src/shell/attribution-splash.tsx';

/** A clock whose frames and timers run only when the test says so. */
function fakeClock(): SplashClock & { t: number; frame(at: number): void; fireTimers(at: number): void; frames: number; timers: number } {
  let nextId = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  const c = {
    t: 0,
    now: () => c.t,
    raf: (cb: () => void) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id: number) => void frames.delete(id),
    setTimeout: (cb: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: c.t + ms, cb });
      return id;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    /** One animation frame at time `at`: runs the callbacks queued before it. */
    frame(at: number) {
      c.t = at;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb();
    },
    /** The timer tasks get to run at `at` (the main thread was busy until then). */
    fireTimers(at: number) {
      c.t = at;
      for (const [id, x] of [...timers]) {
        if (x.at <= at) {
          timers.delete(id);
          x.cb();
        }
      }
    },
    get frames() {
      return frames.size;
    },
    get timers() {
      return timers.size;
    },
  };
  return c;
}

describe('the boot splash end (M02c2 AC-8, BD-FIX-FLAKE-SPLASH-01)', () => {
  it('shows the OSM line', () => {
    expect(splashLine([{ id: 'osm', text: '© OpenStreetMap contributors' }])).toBe('© OpenStreetMap contributors');
  });

  it('ends on the first animation frame at or after 3 s, while the timer tasks are held up', () => {
    const c = fakeClock();
    const ended: number[] = [];
    scheduleSplashEnd(() => ended.push(c.t), SPLASH_ATTRIBUTION_MS, c);
    for (const at of [16, 700, 1500, 2999]) c.frame(at);
    expect(ended).toEqual([]);
    c.frame(3000 + 340);
    expect(ended).toEqual([3340]);
    // the held-up timer fires later and changes nothing; nothing stays scheduled
    c.fireTimers(5747);
    expect(ended).toEqual([3340]);
    expect(c.frames).toBe(0);
    expect(c.timers).toBe(0);
  });

  it('ends from the timer when no frame comes (a hidden page)', () => {
    const c = fakeClock();
    const ended: number[] = [];
    scheduleSplashEnd(() => ended.push(c.t), SPLASH_ATTRIBUTION_MS, c);
    c.fireTimers(2999);
    expect(ended).toEqual([]);
    c.fireTimers(3000);
    expect(ended).toEqual([3000]);
    c.frame(3016);
    expect(ended).toEqual([3000]);
    expect(c.frames).toBe(0);
  });

  it('a cancel before the end calls nothing', () => {
    const c = fakeClock();
    const ended: number[] = [];
    const cancel = scheduleSplashEnd(() => ended.push(c.t), SPLASH_ATTRIBUTION_MS, c);
    c.frame(1000);
    cancel();
    c.frame(3500);
    c.fireTimers(4000);
    expect(ended).toEqual([]);
    expect(c.frames).toBe(0);
    expect(c.timers).toBe(0);
  });
});
