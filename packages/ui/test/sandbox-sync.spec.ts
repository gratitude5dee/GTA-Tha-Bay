import type { UiCommand } from '@dv/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSandboxClockSync, localHour } from '../src/phone/sandbox-sync.ts';

afterEach(() => vi.useRealTimers());

const NOW = (): Date => new Date(2026, 9, 24, 7, 42, 10);
const ON = { sandbox: true, sync: true, online: false } as const;

function make(): { sent: UiCommand[]; sync: ReturnType<typeof createSandboxClockSync> } {
  const sent: UiCommand[] = [];
  return { sent, sync: createSandboxClockSync({ send: (c) => void sent.push(c), now: NOW }) };
}

describe('createSandboxClockSync (AC-10)', () => {
  it('sends the local hour at once and every minute: 4 commands in 3 minutes, each 7.7', () => {
    vi.useFakeTimers();
    const { sent, sync } = make();
    sync.update(ON);
    vi.advanceTimersByTime(180_000);
    expect(sent).toHaveLength(4);
    for (const c of sent) expect(c).toEqual({ t: 'mode.cmd', mode: 'sandbox', name: 'time.sync', args: { hour: 7.7 } });
    // update is idempotent: the same state does not start a second timer
    sync.update(ON);
    sync.update(ON);
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(5);
    sync.dispose();
  });

  it('stops when sync is turned off, in another mode, or online with sync still on', () => {
    vi.useFakeTimers();
    for (const off of [{ ...ON, sync: false }, { ...ON, sandbox: false }, { ...ON, online: true }]) {
      const { sent, sync } = make();
      sync.update(ON);
      expect(sent).toHaveLength(1);
      sync.update(off);
      vi.advanceTimersByTime(300_000);
      expect(sent).toHaveLength(1);
      sync.dispose();
    }
  });

  it('sends nothing while it never starts: online with sync on', () => {
    vi.useFakeTimers();
    const { sent, sync } = make();
    sync.update({ sandbox: true, sync: true, online: true });
    vi.advanceTimersByTime(300_000);
    expect(sent).toHaveLength(0);
    sync.dispose();
  });

  it('starts again with an immediate command when the sync comes back on', () => {
    vi.useFakeTimers();
    const { sent, sync } = make();
    sync.update(ON);
    sync.update({ ...ON, sync: false });
    sync.update(ON);
    expect(sent).toHaveLength(2);
    sync.dispose();
  });

  it('dispose clears the interval', () => {
    vi.useFakeTimers();
    const { sent, sync } = make();
    sync.update(ON);
    expect(vi.getTimerCount()).toBe(1);
    sync.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(300_000);
    expect(sent).toHaveLength(1);
  });

  it('rounds the hour to 1/60', () => {
    expect(localHour(new Date(2026, 0, 1, 0, 0))).toBe(0);
    expect(localHour(new Date(2026, 0, 1, 23, 59))).toBeCloseTo(23 + 59 / 60, 10);
    expect(localHour(new Date(2026, 0, 1, 18, 30))).toBe(18.5);
  });
});
