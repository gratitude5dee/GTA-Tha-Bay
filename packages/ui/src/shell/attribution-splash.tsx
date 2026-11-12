/**
 * The OSM line of the boot splash (M02c2; 02-world-maps.md section 6 rule 1): the OpenStreetMap credit is shown for 3 s from the
 * first paint of the shell, on top of whatever page is up, then removed. The text is the `osm` entry of `config/attribution.world.json`.
 */
import { useEffect, useState } from 'preact/hooks';
import attribution from '../../../../config/attribution.world.json';

export const SPLASH_ATTRIBUTION_MS = 3000;

export function splashLine(entries: readonly { id: string; text: string }[] = (attribution as { entries: { id: string; text: string }[] }).entries): string {
  return entries.find((e) => e.id === 'osm')?.text ?? '© OpenStreetMap contributors';
}

/** The clock `scheduleSplashEnd` reads (the browser's by default; tests pass their own). */
export interface SplashClock {
  now(): number;
  raf(cb: () => void): number;
  caf(id: number): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserClock: SplashClock = {
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Calls `done` once `ms` have passed since the call: on the first animation frame at or after that moment, or from a timer when no frame
 * comes (a hidden page draws none), whichever is first, and once. Returns the cancel.
 *
 * The frame check is what ends the splash on a busy boot (BD-FIX-FLAKE-SPLASH-01). While the splash is up the main thread draws the
 * world's first frames, which link the render programs (on software GL and on drivers without KHR_parallel_shader_compile each link
 * blocks), and the cast kit's `compileAsync` (DL-715) runs as a chain of `scheduler.yield()` continuations, which Chromium runs ahead of
 * timer tasks: a 3 s `setTimeout` fired after 5.7 to 6.9 s. Animation frames keep running through it, so the splash leaves with the
 * first frame after its 3 s; only the length of one frame can still stretch it.
 */
export function scheduleSplashEnd(done: () => void, ms = SPLASH_ATTRIBUTION_MS, clock: SplashClock = browserClock): () => void {
  const t0 = clock.now();
  let over = false;
  let frame = 0;
  let timer: unknown = null;
  const stop = (): void => {
    over = true;
    clock.caf(frame);
    if (timer !== null) clock.clearTimeout(timer);
  };
  const end = (): void => {
    if (over) return;
    stop();
    done();
  };
  const tick = (): void => {
    if (over) return;
    if (clock.now() - t0 >= ms) end();
    else frame = clock.raf(tick);
  };
  frame = clock.raf(tick);
  timer = clock.setTimeout(end, ms);
  return stop;
}

export function AttributionSplash() {
  const [on, setOn] = useState(true);
  useEffect(() => scheduleSplashEnd(() => setOn(false)), []);
  if (!on) return null;
  return (
    <div class="dv-splash-attrib" data-testid="attribution-splash" role="status">
      {splashLine()}
    </div>
  );
}
