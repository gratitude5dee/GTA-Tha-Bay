import path from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * Lap lines for the CI log (BD-FIX-CI-PLAN-01): the seconds of the waits no log held (a boot's closing settle, a held settle, a capture,
 * a sky wait, a teleport's "shown" poll), printed in the style of the `curbs timing` lines of `avenue-curbs.spec.ts`:
 *
 *   lap <project> <spec file>:<line> <what>: <seconds and what the wait returned>
 *
 * A lap reads only the test process's clock and values the surrounding calls already return. It adds no page call, no wait and no poll:
 * at `desktop` on CI's software GL every extra round trip to the page costs 3 to 15 s. The project and the test's file and line come from
 * `test.info()`, the tier from the page's URL (`page.url()` is the test process's own copy).
 */
const origin = (): string => {
  try {
    const i = test.info();
    return `${i.project.name} ${path.basename(i.file)}:${i.line}`;
  } catch {
    return 'outside-a-test';
  }
};

/** Seconds from `sinceMs` to `untilMs` (now when left out), one decimal. */
export const secs = (sinceMs: number, untilMs = Date.now()): string => ((untilMs - sinceMs) / 1000).toFixed(1);

/** The `tier=` of the page's URL, `-` when it has none. */
export const tierOf = (page: Page): string => {
  try {
    return new URL(page.url()).searchParams.get('tier') ?? '-';
  } catch {
    return '-';
  }
};

export function lap(what: string, detail: string): void {
  console.log(`lap ${origin()} ${what}: ${detail}`);
}

/** Runs `run` as it is and prints its seconds (and `detail` of its result); a throw is printed and passed on unchanged. */
export async function timed<T>(what: string, run: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
  const t0 = Date.now();
  let r: T;
  try {
    r = await run();
  } catch (e) {
    lap(what, `threw after ${secs(t0)} s`);
    throw e;
  }
  lap(what, `${secs(t0)} s${detail ? `, ${detail(r)}` : ''}`);
  return r;
}

/** What `world.settle()` returned, for a lap line. */
export const settleText = (s: { settled: boolean; pending: number; queued: number }): string => `settled ${String(s.settled)}, pending ${s.pending}, queued ${s.queued}`;
