import { describe, expect, it } from 'vitest';
import { createMissionGate, MISSION_GATE_DEADLINE_MS, type MissionGateOptions } from '../src/qa/mission-gate.ts';

/** A gate with hand-driven promises, clock and timer. */
function harness(deadlineMs?: number) {
  let t = 0;
  let timer: (() => void) | null = null;
  let armedMs = -1;
  let gesture: () => void = () => undefined;
  let reveal: () => void = () => undefined;
  const releases: number[] = [];
  const warnings: string[] = [];
  const o: MissionGateOptions = {
    gesture: new Promise<void>((r) => (gesture = r)),
    revealed: new Promise<void>((r) => (reveal = r)),
    release: () => releases.push(t),
    now: () => t,
    setTimeout: (fn, ms) => {
      timer = fn;
      armedMs = ms;
      return 1;
    },
    clearTimeout: () => {
      timer = null;
    },
    warn: (m) => warnings.push(m),
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
  };
  const gate = createMissionGate(o);
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return {
    gate,
    releases,
    warnings,
    armedMs: () => armedMs,
    at: (ms: number) => void (t = ms),
    gesture: async () => (gesture(), await settle()),
    reveal: async () => (reveal(), await settle()),
    expire: () => timer?.(),
  };
}

describe('the QA mission gate (DL-715 as amended)', () => {
  it('releases the boot mission once, after both the first gesture and the reveal, in either order', async () => {
    const h = harness();
    expect(h.armedMs()).toBe(MISSION_GATE_DEADLINE_MS);
    h.at(400);
    await h.reveal();
    expect(h.gate.state()).toMatchObject({ state: 'waiting', waiting: ['gesture'], after: { reveal: 400, gesture: null } });
    expect(h.releases).toEqual([]);
    h.at(9000);
    await h.gesture();
    expect(h.releases).toEqual([9000]);
    expect(h.gate.state()).toEqual({ state: 'released', waiting: [], reason: null, releasedAfterMs: 9000, after: { gesture: 9000, reveal: 400 } });
    // the deadline was disarmed
    h.expire();
    expect(h.gate.state().state).toBe('released');
    expect(h.warnings).toEqual([]);
  });

  it('waits for the reveal when the gesture came first', async () => {
    const h = harness();
    await h.gesture();
    expect(h.releases).toEqual([]);
    h.at(1200);
    await h.reveal();
    expect(h.releases).toEqual([1200]);
  });

  it('past the deadline does not start the mission and says what it still waits for', async () => {
    const h = harness(5000);
    await h.reveal();
    h.at(5000);
    h.expire();
    const st = h.gate.state();
    expect(st.state).toBe('expired');
    expect(st.waiting).toEqual(['gesture']);
    expect(st.reason).toContain('within 5000 ms');
    expect(st.reason).toContain('no first gesture reached the media unlock');
    expect(st.reason).not.toContain('not revealed');
    expect(h.warnings).toEqual([`QA mission gate: ${st.reason as string}`]);
    // a gesture after the deadline does not start it either
    await h.gesture();
    expect(h.releases).toEqual([]);
    expect(h.gate.state()).toMatchObject({ state: 'expired', reason: st.reason });
  });

  it('names both missing conditions', () => {
    const h = harness();
    h.expire();
    expect(h.gate.state().reason).toMatch(/no first gesture.*; the world was not revealed/);
  });
});
