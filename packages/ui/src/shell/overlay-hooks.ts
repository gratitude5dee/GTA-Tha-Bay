import type { JsonValue } from '@dv/shared';
import type { SettingRef } from '../screen/types.ts';

/**
 * The shell's read-only signal stream (10-ui-hud-xr.md section 2.14 rule 5, M04b5). Translators and accessibility tools listen to it
 * instead of scraping the DOM. One shape for every signal: a `ShellSignal` with `v: 1`, dispatched as a `dv-shell` event on the window
 * and posted on `BroadcastChannel('dv-shell')`. Signals carry no names, saves or free text, and nothing on the page listens to them.
 */
export const SHELL_SIGNAL_EVENT = 'dv-shell';
export const SHELL_SIGNAL_CHANNEL = 'dv-shell';
/** The least time between two `fps` signals. */
export const FPS_SIGNAL_PERIOD_MS = 1000;

export type ShellSignalValue = string | number | boolean | null;

export type ShellSignal =
  | { v: 1; kind: 'setting'; ref: string; value?: ShellSignalValue }
  | { v: 1; kind: 'profile'; profileId: string }
  | { v: 1; kind: 'fps'; fps: number; tier: string }
  | { v: 1; kind: 'state'; state: string }
  | { v: 1; kind: 'page'; page: string };

/** The part of a `BroadcastChannel` the hooks use. */
export interface SignalChannel {
  postMessage(message: unknown): void;
  close?(): void;
}

/** The part of `window` the hooks use. */
export interface SignalTarget {
  dispatchEvent(event: Event): boolean;
}

export interface OverlayHooksOptions {
  target: SignalTarget | null;
  channel: SignalChannel | null;
  now: () => number;
}

export interface OverlayHooks {
  /** After a player write through the settings binder: `ref` is `<scope>:<path>`. */
  setting(ref: SettingRef, value: JsonValue): void;
  /** The `sys.profile` view-model id; a repeat of the last id gives no signal. */
  profile(profileId: string): void;
  /** A frame-rate sample; at most one signal per second reaches the stream. */
  fps(fps: number, tier: string): void;
  state(state: string): void;
  page(page: string): void;
  dispose(): void;
}

const primitive = (v: JsonValue): v is ShellSignalValue => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function makeEvent(signal: ShellSignal): Event {
  if (typeof CustomEvent === 'function') return new CustomEvent(SHELL_SIGNAL_EVENT, { detail: signal });
  const e = new Event(SHELL_SIGNAL_EVENT);
  (e as Event & { detail?: ShellSignal }).detail = signal;
  return e;
}

export function createOverlayHooks(o: OverlayHooksOptions): OverlayHooks {
  let lastProfile: string | null = null;
  let lastFps = Number.NEGATIVE_INFINITY;
  const send = (signal: ShellSignal): void => {
    try {
      o.target?.dispatchEvent(makeEvent(signal));
    } catch {
      // a listener that throws must not break the shell
    }
    try {
      o.channel?.postMessage(signal);
    } catch {
      // a closed channel or a failed clone drops the signal
    }
  };
  return {
    setting(ref, value) {
      const id = `${ref.scope}:${ref.path}`;
      send(primitive(value) ? { v: 1, kind: 'setting', ref: id, value } : { v: 1, kind: 'setting', ref: id });
    },
    profile(profileId) {
      if (profileId === lastProfile) return;
      lastProfile = profileId;
      send({ v: 1, kind: 'profile', profileId });
    },
    fps(fps, tier) {
      const at = o.now();
      if (at - lastFps < FPS_SIGNAL_PERIOD_MS) return;
      lastFps = at;
      send({ v: 1, kind: 'fps', fps, tier });
    },
    state: (state) => send({ v: 1, kind: 'state', state }),
    page: (page) => send({ v: 1, kind: 'page', page }),
    dispose() {
      try {
        o.channel?.close?.();
      } catch {
        // already closed
      }
    },
  };
}

/** The hooks on the real window and `BroadcastChannel`; either one missing is left out (the guard pattern of the tab lock). */
export function defaultOverlayHooks(): OverlayHooks {
  let channel: SignalChannel | null = null;
  try {
    if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(SHELL_SIGNAL_CHANNEL);
  } catch {
    channel = null;
  }
  return createOverlayHooks({ target: typeof window === 'undefined' ? null : window, channel, now: () => Date.now() });
}
