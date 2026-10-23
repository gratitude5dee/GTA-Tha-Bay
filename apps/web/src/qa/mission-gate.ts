/**
 * QA builds only (DL-715 as amended, M05b2 AC-8): when the boot mission of `?mission=<id>` starts on a streamed world.
 *
 * A player's game runs in this order: the Title's first gesture runs the product's `FirstGestureUnlock` (the shared AudioContext and
 * the pool of three `<video>` elements), the world reveals, and only then does a mission start and trigger its first beat. A QA page
 * keeps that order: the story mode holds the boot mission (`QaMissionBoot.hold`) and this gate sends `debug.release` once both
 *
 * - `gesture`: the unlock's `ready` has resolved, which it does only after a real first gesture was handled (a trusted pointer or key
 *   event on the window, or the Title's Start, which a spec presses as a player does); nothing here calls the unlock itself, and
 * - `reveal`: the world view's first reveal at the spawn,
 *
 * have happened. When the deadline passes first, the mission is not started: the gate says why (`expired`, with what it still waits
 * for) through `window.__dvBridge.missionGate.state()` and a console warning, so a spec fails on that reason instead of on a later
 * symptom such as a clip falling back with `start_stall` or `not_permitted`.
 */

export type MissionGateWait = 'gesture' | 'reveal';

export interface MissionGateState {
  state: 'waiting' | 'released' | 'expired';
  /** What the gate still waits for (empty once released). */
  waiting: MissionGateWait[];
  /** Why the boot mission did not start; set when the deadline passed, null otherwise. */
  reason: string | null;
  /** Milliseconds from the gate's creation to the release, null before it. */
  releasedAfterMs: number | null;
}

export interface MissionGateOptions {
  /** Resolves after the first gesture has been handled (`FirstGestureUnlock.ready`). */
  gesture: Promise<unknown>;
  /** Resolves once the world is revealed (`WorldView.whenRevealed()`). */
  revealed: Promise<unknown>;
  /** Starts the held boot mission (the story mode's `debug.release`). */
  release: () => void;
  deadlineMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  warn?: (message: string) => void;
}

export interface MissionGate {
  state(): MissionGateState;
}

/** How long a QA boot mission waits for the first gesture and the reveal before the gate reports why it did not start. */
export const MISSION_GATE_DEADLINE_MS = 90_000;

const WHY: Record<MissionGateWait, string> = {
  gesture: 'no first gesture reached the media unlock (press the Title Start or send a trusted click or key press)',
  reveal: 'the world was not revealed',
};

export function createMissionGate(o: MissionGateOptions): MissionGate {
  const now = o.now ?? ((): number => performance.now());
  const arm = o.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const disarm = o.clearTimeout ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  const warn = o.warn ?? ((m: string): void => console.warn(m));
  const deadlineMs = o.deadlineMs ?? MISSION_GATE_DEADLINE_MS;
  const t0 = now();
  const waiting = new Set<MissionGateWait>(['gesture', 'reveal']);
  let state: MissionGateState['state'] = 'waiting';
  let reason: string | null = null;
  let releasedAfterMs: number | null = null;

  const timer = arm(() => {
    if (state !== 'waiting') return;
    state = 'expired';
    const missing = [...waiting];
    reason = `the boot mission did not start within ${deadlineMs} ms: ${missing.map((w) => WHY[w]).join('; ')}`;
    warn(`QA mission gate: ${reason}`);
  }, deadlineMs);

  const done = (what: MissionGateWait): void => {
    waiting.delete(what);
    if (state !== 'waiting' || waiting.size > 0) return;
    state = 'released';
    releasedAfterMs = Math.round(now() - t0);
    disarm(timer);
    o.release();
  };
  void o.gesture.then(() => done('gesture'), () => done('gesture'));
  void o.revealed.then(() => done('reveal'), () => undefined);

  return {
    state: () => ({ state, waiting: [...waiting], reason, releasedAfterMs }),
  };
}
