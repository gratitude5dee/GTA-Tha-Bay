import {
  Axis, ClientAction, SimButton,
  type ActionId, type Binder, type Binding, type ControlId, type ControlsSettings, type DeviceKind, type InputContextId,
  type InputFrame, type InputMap, type InputRouter, type RawInputState,
} from '@dv/shared';
import {
  DEFAULT_CONTROLS, DEFAULT_MAPS, MOUSE_RAD_PER_PX, PAD_RAD_PER_SEC, PITCH_LIMIT,
} from './defaults.ts';
import { GestureTracker } from './gestures.ts';
import { pitchToI16, quantAxis, quantTrigger, yawToU16 } from './quantize.ts';
import { createRawInputState } from './raw-state.ts';

/** Order of `InputContextId` in the C03 type: the u8 `context` in an InputFrame is an index into it. */
export const CONTEXT_ORDER: readonly InputContextId[] = [
  'onFoot', 'vehicle', 'fighter', 'menu', 'phone', 'map', 'cutscene', 'photo', 'tycoon', 'xrMenu', 'debug',
];
/** Order of `DeviceKind` in C03 1.1. */
export const DEVICE_ORDER: readonly DeviceKind[] = ['kbm', 'gamepad', 'touch', 'xr-controller', 'xr-hand', 'xr-transient', 'pose', 'bot'];

// `const enum` members have no runtime names, so the action tables are spelled out. router.spec.ts checks them against the enums.
export const SIM_BITS: Readonly<Record<string, number>> = {
  Jump: SimButton.Jump, Sprint: SimButton.Sprint, Interact: SimButton.Interact, Enter: SimButton.Enter, Attack: SimButton.Attack,
  Block: SimButton.Block, Special: SimButton.Special, Handbrake: SimButton.Handbrake, Nitro: SimButton.Nitro, Ability: SimButton.Ability,
  LookBehind: SimButton.LookBehind, Horn: SimButton.Horn, FightHeavy: SimButton.FightHeavy, FightAssist: SimButton.FightAssist,
  Teleport: SimButton.Teleport, Crouch: SimButton.Crouch, Respray: SimButton.Respray, Emote: SimButton.Emote, PhoneQuick: SimButton.PhoneQuick,
};
export const CLIENT_ACTIONS: Readonly<Record<string, ClientAction>> = {
  Look: ClientAction.Look, Camera: ClientAction.Camera, ShoulderSwap: ClientAction.ShoulderSwap, Map: ClientAction.Map,
  Phone: ClientAction.Phone, Pause: ClientAction.Pause, SnapTurnLeft: ClientAction.SnapTurnLeft, SnapTurnRight: ClientAction.SnapTurnRight,
  UiAccept: ClientAction.UiAccept, UiBack: ClientAction.UiBack, UiUp: ClientAction.UiUp, UiDown: ClientAction.UiDown,
  UiLeft: ClientAction.UiLeft, UiRight: ClientAction.UiRight, UiTabPrev: ClientAction.UiTabPrev, UiTabNext: ClientAction.UiTabNext,
  PhotoShutter: ClientAction.PhotoShutter, DebugToggle: ClientAction.DebugToggle,
};
export const AXES: Readonly<Record<string, Axis>> = {
  MoveX: Axis.MoveX, MoveY: Axis.MoveY, Throttle: Axis.Throttle, Brake: Axis.Brake, Steer: Axis.Steer, LookX: Axis.LookX, LookY: Axis.LookY,
};

type ActionKind = 'sim' | 'client' | 'axis';

/** One action in one context, with its bindings and a gesture tracker per binding. */
class BoundAction {
  readonly trackers: GestureTracker[];
  /** hold-to-toggle latch. */
  toggled = false;
  constructor(
    readonly id: ActionId,
    readonly kind: ActionKind,
    readonly name: string,
    readonly bindings: readonly Binding[],
  ) {
    this.trackers = bindings.map(() => new GestureTracker());
  }
  reset(): void {
    for (let i = 0; i < this.trackers.length; i++) this.trackers[i] = new GestureTracker();
    this.toggled = false;
  }
}

interface Aggregate {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

export interface RouterOptions {
  /** Default maps; the kbm and gamepad files from config/input. */
  maps?: readonly InputMap[];
  /** Binders the router polls on every `sample`. */
  binders?: readonly Binder[];
  /** Milliseconds; defaults to `performance.now`. Tests inject a manual clock. */
  now?: () => number;
  /** Starts a one-shot timer and returns its cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** The raw state shared with the binders. */
  raw?: RawInputState;
  settings?: ControlsSettings;
}

const clampPitch = (p: number): number => (p < -PITCH_LIMIT ? -PITCH_LIMIT : p > PITCH_LIMIT ? PITCH_LIMIT : p);

/**
 * The C03 input router: device bindings per context, resolved into `SimButton` bits, quantized axes and `ClientAction`s.
 * Gestures (hold, double tap, chord, hold-to-toggle) are resolved here, before quantization, so the sim sees only bits.
 *
 * Per render frame the page calls `applyLook(dt, look)`, then `sample(frame, look)`, and writes the frame into the
 * input block. Client actions fire synchronously from `sample`.
 */
export class InputRouterImpl implements InputRouter {
  readonly raw: RawInputState;
  private readonly binders: readonly Binder[];
  private readonly maps: readonly InputMap[];
  private readonly nowFn: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private settings: ControlsSettings;
  private compiled = new Map<InputContextId, BoundAction[]>();
  private pause: BoundAction | null = null;
  private stack: InputContextId[] = ['onFoot'];
  private readonly listeners = new Set<(a: ClientAction, phase: 'pressed' | 'released') => void>();
  private prevButtons = 0;
  private poseHybrid = false;
  private capture: { device: DeviceKind; finish: (c: ControlId | null) => void } | null = null;

  constructor(opts: RouterOptions = {}) {
    this.maps = opts.maps ?? DEFAULT_MAPS;
    this.binders = opts.binders ?? [];
    this.raw = opts.raw ?? createRawInputState();
    this.nowFn = opts.now ?? ((): number => performance.now());
    this.schedule = opts.schedule ?? ((fn, ms): (() => void) => {
      const h = setTimeout(fn, ms);
      return (): void => clearTimeout(h);
    });
    this.settings = opts.settings ?? DEFAULT_CONTROLS;
    this.compile();
  }

  // ------------------------------------------------------------------ InputRouter

  get active(): DeviceKind {
    return this.raw.lastActiveDevice;
  }

  get poseHybridOn(): boolean {
    return this.poseHybrid;
  }

  push(ctx: InputContextId): void {
    this.stack.push(ctx);
    this.resetContext(ctx);
  }

  pop(ctx: InputContextId): void {
    for (let i = this.stack.length - 1; i > 0; i--) {
      if (this.stack[i] === ctx) {
        this.stack.splice(i, 1);
        break;
      }
    }
    this.resetContext(this.top());
  }

  top(): InputContextId {
    return this.stack[this.stack.length - 1] as InputContextId;
  }

  setOverrides(s: ControlsSettings): void {
    this.settings = s;
    this.compile();
  }

  setPoseHybrid(on: boolean): void {
    this.poseHybrid = on;
  }

  onClientAction(cb: (a: ClientAction, phase: 'pressed' | 'released') => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  rebindCapture(device: DeviceKind, timeoutMs: number): Promise<ControlId | null> {
    this.capture?.finish(null);
    return new Promise<ControlId | null>((resolve) => {
      const cancel = this.schedule(() => finish(null), timeoutMs);
      const finish = (c: ControlId | null): void => {
        if (this.capture?.finish === finish) this.capture = null;
        cancel();
        resolve(c);
      };
      this.capture = { device, finish };
    });
  }

  /** Raises a client action that did not come from a binding (Pointer Lock lost). */
  raiseClientAction(a: ClientAction): void {
    this.emit(a, 'pressed');
    this.emit(a, 'released');
  }

  // ------------------------------------------------------------------ look

  /**
   * Applies the look bindings to `look` (radians, mutated in place) and consumes the raw look delta. Mouse: 0.0022 rad per
   * pixel, gamepad: 3.0 rad/s at full deflection, both times the sensitivity setting; pitch is clamped to +/- 70 degrees.
   * Only the on-foot style contexts look around; elsewhere the delta is dropped.
   */
  applyLook(dtSec: number, look: { yaw: number; pitch: number }): void {
    const ctx = this.top();
    const dx = this.raw.lookDelta[0];
    const dy = this.raw.lookDelta[1];
    this.raw.lookDelta[0] = 0;
    this.raw.lookDelta[1] = 0;
    const actions = this.compiled.get(ctx);
    if (!actions) return;
    let yaw = 0;
    let pitch = 0;
    for (const a of actions) {
      if (a.kind !== 'axis') continue;
      const axis = a.name === 'LookX' ? 0 : a.name === 'LookY' ? 1 : -1;
      if (axis < 0) continue;
      for (const b of a.bindings) {
        const sign = b.invert ? -1 : 1;
        const scale = (b.scale ?? 1) * sign;
        if (b.control === 'mouse:dx' || b.control === 'mouse:dy') {
          const px = b.control === 'mouse:dx' ? dx : dy;
          const v = px * MOUSE_RAD_PER_PX * this.settings.lookSensitivity.kbm * scale;
          if (axis === 0) yaw += v;
          else pitch += v;
        } else {
          const v = this.analog(b.control, b.deadzone ?? this.settings.deadzones.stickInner);
          if (v === 0) continue;
          const r = v * PAD_RAD_PER_SEC * dtSec * this.settings.lookSensitivity.gamepad * scale;
          if (axis === 0) yaw += r;
          else pitch += r;
        }
      }
    }
    // Moving right (positive dx or stick x) turns the view right, which is a smaller yaw; moving down looks down.
    look.yaw -= yaw;
    look.pitch = clampPitch(look.pitch - (this.settings.invertY ? -pitch : pitch));
  }

  // ------------------------------------------------------------------ sample

  sample(tick: number, cam: { yaw: number; pitch: number }): InputFrame {
    const now = this.nowFn();
    for (const b of this.binders) b.poll(this.raw, now);
    const ctx = this.top();

    if (this.capture) {
      const hit = this.captured(this.capture.device);
      if (hit) this.capture.finish(hit);
      this.raw.latchedPress.clear();
      this.prevButtons = 0;
      return this.frame(tick, ctx, cam, 0, 0, 0, [0, 0, 0, 0, 0]);
    }

    let buttons = 0;
    let pressedBits = 0;
    let releasedBits = 0;
    const axes = [0, 0, 0, 0, 0];
    const clientEvents: [ClientAction, 'pressed' | 'released'][] = [];

    for (const a of this.compiled.get(ctx) ?? []) {
      if (a.kind === 'axis') {
        const idx = AXES[a.name];
        if (idx === undefined || idx > Axis.Steer) continue; // look axes go through applyLook
        let v = 0;
        for (const b of a.bindings) v += this.axisValue(b);
        axes[idx] = (axes[idx] as number) + v;
        continue;
      }
      const r = this.digital(a, now);
      if (a.kind === 'sim') {
        const bit = 1 << (SIM_BITS[a.name] as number);
        if (r.held) buttons |= bit;
        if (r.pressed) pressedBits |= bit;
        if (r.released) releasedBits |= bit;
      } else if (a.name !== 'Pause') {
        if (r.pressed) clientEvents.push([CLIENT_ACTIONS[a.name] as ClientAction, 'pressed']);
        if (r.released) clientEvents.push([CLIENT_ACTIONS[a.name] as ClientAction, 'released']);
      }
    }
    if (this.pause) {
      const r = this.digital(this.pause, now);
      if (r.pressed) clientEvents.push([ClientAction.Pause, 'pressed']);
      if (r.released) clientEvents.push([ClientAction.Pause, 'released']);
    }

    // Edges from the level change between samples are added to the latched ones.
    pressedBits |= buttons & ~this.prevButtons;
    releasedBits |= this.prevButtons & ~buttons;
    this.prevButtons = buttons;
    this.raw.latchedPress.clear();

    const out = this.frame(tick, ctx, cam, buttons, pressedBits, releasedBits, axes);
    for (const [a, phase] of clientEvents) this.emit(a, phase);
    return out;
  }

  // ------------------------------------------------------------------ internals

  private frame(
    tick: number, ctx: InputContextId, cam: { yaw: number; pitch: number },
    buttons: number, pressed: number, released: number, axes: number[],
  ): InputFrame {
    return {
      tick,
      buttons: buttons >>> 0,
      pressed: pressed >>> 0,
      released: released >>> 0,
      moveX: quantAxis(axes[Axis.MoveX] as number),
      moveY: quantAxis(axes[Axis.MoveY] as number),
      throttle: quantTrigger(axes[Axis.Throttle] as number),
      brake: quantTrigger(axes[Axis.Brake] as number),
      steer: quantAxis(axes[Axis.Steer] as number),
      camYaw: yawToU16(cam.yaw),
      camPitch: pitchToI16(cam.pitch),
      context: CONTEXT_ORDER.indexOf(ctx),
      device: DEVICE_ORDER.indexOf(this.raw.lastActiveDevice),
    };
  }

  private emit(a: ClientAction, phase: 'pressed' | 'released'): void {
    for (const cb of this.listeners) cb(a, phase);
  }

  private resetContext(ctx: InputContextId): void {
    for (const a of this.compiled.get(ctx) ?? []) a.reset();
    this.pause?.reset();
  }

  /** The first control of the capturing device that was pressed since the last sample. */
  private captured(device: DeviceKind): ControlId | null {
    for (const c of this.raw.latchedPress) {
      if (device === 'kbm' && (c.startsWith('key:') || /^mouse:[0-4]$/.test(c))) return c;
      if (device === 'gamepad' && /^pad:b\d+$/.test(c)) return c;
    }
    return null;
  }

  private analog(control: ControlId, deadzone: number): number {
    const v = this.raw.controls.get(control) ?? 0;
    return Math.abs(v) < deadzone ? 0 : Math.max(-1, Math.min(1, v));
  }

  private axisValue(b: Binding): number {
    const sign = b.invert ? -1 : 1;
    const scale = (b.scale ?? 1) * sign;
    const c = b.control;
    if (b.modifiers && !b.modifiers.every((m) => (this.raw.controls.get(m) ?? 0) > 0.5)) return 0;
    if (c.startsWith('pad:a')) return this.analog(c, b.deadzone ?? this.settings.deadzones.stickInner) * scale;
    if (c.startsWith('pad:b')) return this.analog(c, b.deadzone ?? this.settings.deadzones.trigger) * scale;
    return (this.raw.controls.get(c) ?? 0) > 0.5 ? scale : 0;
  }

  /** One digital action: the OR of its bindings' gestures, with hold-to-toggle applied. */
  private digital(a: BoundAction, now: number): Aggregate {
    const agg: Aggregate = { held: false, pressed: false, released: false };
    for (let i = 0; i < a.bindings.length; i++) {
      const b = a.bindings[i] as Binding;
      const mods = !b.modifiers || b.modifiers.every((m) => (this.raw.controls.get(m) ?? 0) > 0.5);
      const down = mods && (this.raw.controls.get(b.control) ?? 0) > 0.5;
      const latched = mods && this.raw.latchedPress.has(b.control);
      const r = (a.trackers[i] as GestureTracker).update(b, down, latched, now);
      agg.held ||= r.held;
      agg.pressed ||= r.pressed;
      agg.released ||= r.released;
    }
    if (a.kind === 'sim' && this.settings.holdToToggle.includes(a.id)) {
      // A press toggles the latch; releasing the key does nothing.
      let r: Aggregate = { held: a.toggled, pressed: false, released: false };
      if (agg.pressed) {
        a.toggled = !a.toggled;
        r = { held: a.toggled, pressed: a.toggled, released: !a.toggled };
      }
      return r;
    }
    return agg;
  }

  /** Merges the default maps of every device with the player's overrides, per context and action. */
  private compile(): void {
    type PerDevice = Map<InputContextId, Map<ActionId, Binding[]>>;
    const merged: PerDevice = new Map();
    const pauseDefaults: Binding[] = [];
    const seenPause = new Set<string>();

    for (const map of this.maps) {
      const overrides = this.settings.overrides[map.device] ?? {};
      for (const [ctxKey, base] of Object.entries(map.contexts)) {
        const ctx = ctxKey as InputContextId;
        const actions = merged.get(ctx) ?? new Map<ActionId, Binding[]>();
        merged.set(ctx, actions);
        const over = overrides[ctx] ?? {};
        for (const [actionKey, bindings] of Object.entries(base ?? {})) {
          const id = actionKey as ActionId;
          if (id === 'client.Pause') {
            // R-ENG-04: Pause keeps its default binding in addition to any override.
            for (const b of bindings ?? []) {
              const k = JSON.stringify(b);
              if (!seenPause.has(k)) {
                seenPause.add(k);
                pauseDefaults.push(b);
              }
            }
          }
          const use = over[id] ?? bindings ?? [];
          actions.set(id, [...(actions.get(id) ?? []), ...use]);
        }
        // Overrides for actions the default map does not bind in this context.
        for (const [actionKey, bindings] of Object.entries(over)) {
          const id = actionKey as ActionId;
          if (base && id in base) continue;
          actions.set(id, [...(actions.get(id) ?? []), ...(bindings ?? [])]);
        }
      }
      // Overrides for contexts the default map lacks.
      for (const [ctxKey, over] of Object.entries(overrides)) {
        const ctx = ctxKey as InputContextId;
        if (ctx in map.contexts) continue;
        const actions = merged.get(ctx) ?? new Map<ActionId, Binding[]>();
        merged.set(ctx, actions);
        for (const [actionKey, bindings] of Object.entries(over ?? {})) {
          const id = actionKey as ActionId;
          actions.set(id, [...(actions.get(id) ?? []), ...(bindings ?? [])]);
        }
      }
    }

    this.compiled = new Map();
    for (const [ctx, actions] of merged) {
      const list: BoundAction[] = [];
      for (const [id, bindings] of actions) {
        const [kind, name] = id.split('.') as [ActionKind, string];
        if (bindings.length === 0) continue;
        if (id === 'client.Pause') continue; // global, below
        list.push(new BoundAction(id, kind, name, bindings));
      }
      this.compiled.set(ctx, list);
    }
    // Pause works in every context: its defaults plus anything the player added in any context.
    const pause = [...pauseDefaults];
    for (const actions of merged.values()) {
      for (const b of actions.get('client.Pause') ?? []) {
        const k = JSON.stringify(b);
        if (!seenPause.has(k)) {
          seenPause.add(k);
          pause.push(b);
        }
      }
    }
    this.pause = pause.length > 0 ? new BoundAction('client.Pause', 'client', 'Pause', pause) : null;
  }
}
