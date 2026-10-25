/**
 * The sandbox's body tools (M04e4): the Player toggles "can't get hurt" and "big jumps", the one-shot "patch me up", and the actions on
 * the session car the player drives or stands beside (repair, upright, dismiss), plus the dent-proof cars toggle. Everything is
 * session-only: the three toggles are engine flags (`SandboxFlags`), never written to `SandboxSlice` or `CoreSlice`, so no autosave
 * carries them. The engine work sits behind `SandboxBodyPort`; a missing port keeps the toggles off and refuses the car actions.
 * Pure sim code in the C02 lint scope: no `Date`, no timers, no `**`.
 */
import type { EntityHandle, JsonValue, ModeContext, SimEvent } from '@dv/shared';
import { anyFlag, noFlags, type SandboxFlags } from '../../sandbox-flags.ts';
import type { SandboxBodyPort } from '../sandbox-body-port.ts';
import { parseSandboxCmd, type SandboxVehicles } from './sandbox-vehicles.ts';

export const GOD_MODE = 'sandbox.player.godMode';
export const SUPER_JUMP = 'sandbox.player.superJump';
export const CAR_NO_DAMAGE = 'sandbox.vehicle.noDamage';
export const BODY_VM = 'mode.sandbox.player';
export const BODY_ACTIONS = ['player.restore', 'vehicle.repair', 'vehicle.upright', 'vehicle.dismiss'] as const;
export const REFUSE_NEED_CAR = 'sandbox.refuse.needCar';
export const REFUSE_CAR_MOVING = 'sandbox.refuse.carMoving';
export const REFUSE_NO_GROUND = 'sandbox.refuse.noGround';

export type CarNear = 'none' | 'near' | 'driving';

export interface BodyView extends SandboxFlags {
  car: CarNear;
  online: boolean;
}

/** True for a path this module owns (valid value or not): the generic toggle behaviour never sees them. */
export function isBodyPath(path: string): boolean {
  return path === GOD_MODE || path === SUPER_JUMP || path === CAR_NO_DAMAGE;
}

/** What the last publish put in `mode.sandbox.player` per context, so a patch is sent only on a change. */
const shown = new WeakMap<object, BodyView>();

const guard = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

function viewOf(p: SandboxBodyPort | null, car: CarNear, online: boolean): BodyView {
  const f = p ? guard(() => p.flags(), noFlags()) : noFlags();
  return { godMode: f.godMode, superJump: f.superJump, carNoDamage: f.carNoDamage, car, online };
}

function publishView(ctx: ModeContext, v: BodyView): void {
  const old = shown.get(ctx.ui);
  if (old && old.godMode === v.godMode && old.superJump === v.superJump && old.carNoDamage === v.carNoDamage && old.car === v.car && old.online === v.online) return;
  shown.set(ctx.ui, v);
  ctx.ui.patch(BODY_VM, v as unknown as JsonValue);
}

/**
 * Applies one of the three body toggles (`sandbox.set`). Boolean values only: anything else changes nothing. Returns true when the
 * path is a body path and the value was applied (the caller then writes nothing to the slice).
 */
export function applyBodySetting(ctx: ModeContext, path: string, v: boolean | number, port: SandboxBodyPort | null): boolean {
  if (!isBodyPath(path) || typeof v !== 'boolean' || port === null) return false;
  const ok = guard(() => {
    const f = port.flags();
    if (path === GOD_MODE) f.godMode = v;
    else if (path === SUPER_JUMP) f.superJump = v;
    else f.carNoDamage = v;
    port.setFlags(f);
    return true;
  }, false);
  if (!ok) return false;
  const old = shown.get(ctx.ui);
  publishView(ctx, viewOf(port, old?.car ?? 'none', old?.online ?? false));
  return true;
}

export interface SandboxBody {
  enter(ctx: ModeContext, online: boolean): void;
  tick(ctx: ModeContext, online: boolean): void;
  exit(ctx: ModeContext): void;
  onEvent(ctx: ModeContext, e: SimEvent, online: boolean): void;
}

export function createSandboxBody(port: () => SandboxBodyPort | null, cars: SandboxVehicles): SandboxBody {
  const toast = (ctx: ModeContext, id: string): void => ctx.ui.toast({ id, kind: 'warning', text: id });

  const clearFlags = (p: SandboxBodyPort | null): void => {
    if (p && guard(() => anyFlag(p.flags()), false)) guard(() => p.setFlags(noFlags()), undefined);
  };

  const carOf = (p: SandboxBodyPort | null): { h: EntityHandle | null; car: CarNear } => {
    if (!p) return { h: null, car: 'none' };
    const h = guard(() => p.target(cars.handles()), null);
    if (h === null) return { h: null, car: 'none' };
    return { h, car: guard(() => p.driving(h), false) ? 'driving' : 'near' };
  };

  return {
    enter(ctx, online) {
      const p = port();
      clearFlags(p);
      shown.delete(ctx.ui);
      publishView(ctx, viewOf(p, carOf(p).car, online));
    },

    tick(ctx, online) {
      const p = port();
      if (online) clearFlags(p);
      publishView(ctx, viewOf(p, online ? 'none' : carOf(p).car, online));
    },

    exit(ctx) {
      const p = port();
      clearFlags(p);
      publishView(ctx, viewOf(p, 'none', false));
    },

    onEvent(ctx, e, online) {
      const m = parseSandboxCmd(e);
      if (m === null || online || !(BODY_ACTIONS as readonly string[]).includes(m.name)) return;
      const p = port();
      if (m.name === 'player.restore') {
        if (p) guard(() => p.restorePlayer(), undefined);
        return;
      }
      const { h } = carOf(p);
      if (p === null || h === null) {
        toast(ctx, REFUSE_NEED_CAR);
        return;
      }
      if (m.name === 'vehicle.repair') {
        guard(() => p.repair(h), undefined);
      } else if (m.name === 'vehicle.upright') {
        const r = guard(() => p.upright(h), 'noGround' as const);
        if (r === 'moving') toast(ctx, REFUSE_CAR_MOVING);
        else if (r === 'noGround') toast(ctx, REFUSE_NO_GROUND);
      } else {
        cars.dismiss(ctx, h, online);
      }
      publishView(ctx, viewOf(p, carOf(p).car, online));
    },
  };
}
