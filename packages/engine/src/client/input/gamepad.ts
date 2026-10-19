import type { Binder, BinderTarget, ControlId, DeviceKind, RawInputState } from '@dv/shared';

/** The part of a `Gamepad` the binder reads. */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  /** `'standard'` for the W3C standard mapping; `''` for anything else. */
  readonly mapping: string;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
  readonly axes: ReadonlyArray<number>;
}

export interface GamepadOptions {
  /** `navigator.getGamepads()`. */
  getPads: () => ArrayLike<GamepadLike | null>;
  /** Console warnings. */
  warn?: (message: string) => void;
}

/** An axis must move this far from rest before it counts as activity for the "last device" rule. */
const ACTIVITY_AXIS = 0.3;

/**
 * Gamepad binder (C03): the W3C `standard` mapping only. A pad with another mapping gets one console warning and is
 * ignored. Buttons are `pad:bN` (0 to 1, analog for triggers), axes are `pad:aN` (-1 to 1). When the pad goes away every
 * `pad:` control is released. The first standard pad wins.
 */
export class GamepadBinder implements Binder {
  readonly device: DeviceKind = 'gamepad';
  private target: BinderTarget | null = null;
  private readonly warned = new Set<string>();
  private readonly written = new Set<ControlId>();
  private readonly prevDown = new Set<ControlId>();
  private live = false;

  constructor(private readonly opts: GamepadOptions) {}

  get connected(): boolean {
    return this.live;
  }

  get attached(): boolean {
    return this.target !== null;
  }

  /** Pads are read by polling `getPads`, so a pad that disappears is noticed at the next poll without any event. */
  attach(target: BinderTarget): void {
    this.target = target;
  }

  detach(): void {
    this.target = null;
  }

  poll(into: RawInputState, _nowMs: number): void {
    const pad = this.pick();
    if (!pad) {
      this.release(into);
      this.live = false;
      return;
    }
    this.live = true;
    const seen = new Set<ControlId>();
    let activity = false;
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      if (!b) continue;
      const id = `pad:b${i}` as ControlId;
      const value = b.value > 0 ? b.value : b.pressed ? 1 : 0;
      if (value > 0) {
        into.controls.set(id, value);
        seen.add(id);
      }
      const isDown = value > 0.5 || b.pressed;
      if (isDown) {
        if (!this.prevDown.has(id)) {
          into.latchedPress.add(id);
          activity = true;
        }
        this.prevDown.add(id);
      } else {
        this.prevDown.delete(id);
      }
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i] ?? 0;
      const id = `pad:a${i}` as ControlId;
      if (v !== 0) {
        into.controls.set(id, v);
        seen.add(id);
        if (Math.abs(v) > ACTIVITY_AXIS) activity = true;
      }
    }
    for (const c of [...this.written]) {
      if (!seen.has(c)) {
        into.controls.delete(c);
        this.written.delete(c);
        this.prevDown.delete(c);
      }
    }
    for (const c of seen) this.written.add(c);
    if (activity) into.lastActiveDevice = 'gamepad';
  }

  /** The first connected pad with the standard mapping; any other connected pad is warned about once. */
  private pick(): GamepadLike | null {
    const pads = this.opts.getPads();
    let chosen: GamepadLike | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      if (p.mapping !== 'standard') {
        const key = `${p.index}:${p.id}`;
        if (!this.warned.has(key)) {
          this.warned.add(key);
          this.opts.warn?.(`Gamepad "${p.id}" does not use the standard mapping and is ignored`);
        }
        continue;
      }
      if (!chosen) chosen = p;
    }
    return chosen;
  }

  private release(into: RawInputState): void {
    for (const c of this.written) into.controls.delete(c);
    this.written.clear();
    this.prevDown.clear();
  }
}
