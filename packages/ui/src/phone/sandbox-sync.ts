/**
 * "Match my clock" of the Sandbox app (M04e1), page side. The sim never reads wall time (C02), so while the stored sync is on the page
 * sends the device's local time of day as `mode.cmd {mode: 'sandbox', name: 'time.sync', args: {hour}}`: at once, then every
 * `everyMs`. It sends only while the running mode is the sandbox and the session is offline; in a room the stored sync stays
 * published but nothing is sent, so the refusal toast never fires on a timer.
 */
import type { UiCommand } from '@dv/shared';

export interface SandboxSyncState {
  /** The running top-level mode is the sandbox. */
  sandbox: boolean;
  /** `mode.sandbox.world.sync`. */
  sync: boolean;
  /** `mode.sandbox.world.online`. */
  online: boolean;
}

export interface SandboxClockSyncOptions {
  send(cmd: UiCommand): void;
  /** The device's clock. */
  now(): Date;
  /** Default 60 000 ms. */
  everyMs?: number;
}

export interface SandboxClockSync {
  /** Tell it the present state; idempotent. */
  update(s: SandboxSyncState): void;
  dispose(): void;
}

/** Local hours + minutes / 60, rounded to 1/60. */
export function localHour(d: Date): number {
  return Math.round((d.getHours() + d.getMinutes() / 60) * 60) / 60;
}

export function createSandboxClockSync(o: SandboxClockSyncOptions): SandboxClockSync {
  const every = o.everyMs ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  const fire = (): void => o.send({ t: 'mode.cmd', mode: 'sandbox', name: 'time.sync', args: { hour: localHour(o.now()) } });
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    update(s) {
      const want = s.sandbox && s.sync && !s.online;
      if (want && timer === null) {
        fire();
        timer = setInterval(fire, every);
      } else if (!want) stop();
    },
    dispose: stop,
  };
}
