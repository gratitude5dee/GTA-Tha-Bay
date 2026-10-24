/**
 * The time source of the Durable Objects and the SSE transport (M06a1). Production reads `Date.now()`. A Workers-pool test cannot
 * fake timers inside a Durable Object, so it replaces the source here and drives time by hand (milestone Risks: "inject a Clock").
 * The override is module state and is never set by production code.
 */
let source: (() => number) | null = null;

export function now(): number {
  return source === null ? Date.now() : source();
}

/** Test seam: pass a function to fix the clock, or null to restore `Date.now`. */
export function setClockForTests(fn: (() => number) | null): void {
  source = fn;
}

/** Epoch ms of the next 00:00 UTC after `ms` (the quota day rolls over there). */
export function nextUtcMidnight(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000 + 86_400_000;
}

/** `yyyy-mm-dd` in UTC. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
