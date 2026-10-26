/**
 * The sandbox's car spawner (M04e3): the `vehicle.spawn` and `vehicle.clear` actions of `mode.cmd {mode: 'sandbox'}`, the session's list
 * of cars, and the view model of the Cars tab. The cars are session state in the `sandboxSim` closure: they are never written to
 * `SandboxSlice` or `CoreSlice.garage`, and every one leaves the world when the sandbox ends or an online session begins.
 * Pure sim code in the C02 lint scope: no `Date`, no timers, no `**`. The engine work sits behind `SandboxVehiclePort`.
 */
import { SAVE_LIMITS, type AssetRef, type EntityHandle, type JsonObject, type JsonValue, type ModeContext, type SimEvent } from '@dv/shared';
import catalogJson from '../../../../../../content/vehicles/sandbox-catalog.json';
import { RACE_CAR_PREFABS, VEHICLE_PREFABS, type PrefabDef } from '../../prefabs/registry.ts';
import { handlingById } from '../../vehicle/presets.ts';
import type { SandboxVehiclePort } from '../sandbox-vehicle-port.ts';

export const VEHICLES_VM = 'mode.sandbox.vehicles';
export const VEHICLE_ACTIONS = ['vehicle.spawn', 'vehicle.clear'] as const;
export const REFUSE_NO_SPOT = 'sandbox.refuse.noSpot';
export const REFUSE_NOT_READY = 'sandbox.refuse.notReady';
export const REFUSE_ON_FOOT = 'sandbox.refuse.onFoot';
export const STATUS_PREPARING = 'sandbox.status.preparing';
export const STATUS_TOWED = 'sandbox.status.towed';
/** A car whose model has not arrived after this many ticks is given up on (10 s). */
export const READY_WAIT_TICKS = 600;

export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S' | 'R';
export const CAR_CLASSES: readonly CarClass[] = ['D', 'C', 'B', 'A', 'S', 'R'];

export interface CatalogCar {
  prefab: string;
  /** From the prefab's handling preset; the racing data is the only source of the class. */
  cls: CarClass;
  nameKey: string;
  /** The prefab's model reference. */
  asset: AssetRef;
}

let catalog: CatalogCar[] | null = null;

/** The twelve spawnable cars in file order, with their class read from the handling presets. */
export function sandboxCatalog(): readonly CatalogCar[] {
  if (catalog) return catalog;
  const defs = new Map<string, PrefabDef>();
  for (const d of [...VEHICLE_PREFABS, ...RACE_CAR_PREFABS]) defs.set(d.id, d);
  const rows: CatalogCar[] = [];
  for (const r of (catalogJson as { rows: { prefab: string; nameKey: string }[] }).rows) {
    const def = defs.get(r.prefab);
    if (!def?.vehicle) continue;
    rows.push({ prefab: r.prefab, cls: handlingById(def.vehicle.handling).class as CarClass, nameKey: r.nameKey, asset: def.render.asset as AssetRef });
  }
  catalog = rows;
  return rows;
}

interface Owned {
  key: string;
  prefab: string;
  nameKey: string;
  h: EntityHandle;
}

interface Pending {
  prefab: string;
  seat: boolean;
  since: number;
}

type Seat = 'none' | 'driver';

/** The `mode.cmd {mode: 'sandbox'}` event as `{name, args}`, or null for any other event. */
export function parseSandboxCmd(e: SimEvent): { name: string; args: JsonObject } | null {
  if (e.t !== 'mode.cmd' || e.s === undefined) return null;
  let msg: { mode?: unknown; name?: unknown; args?: unknown };
  try {
    msg = JSON.parse(e.s) as typeof msg;
  } catch {
    return null;
  }
  if (msg.mode !== 'sandbox' || typeof msg.name !== 'string') return null;
  const a = msg.args;
  return { name: msg.name, args: typeof a === 'object' && a !== null && !Array.isArray(a) ? (a as JsonObject) : {} };
}

export interface SandboxVehicles {
  /** Opens the session: no cars, nothing pending; publishes the view model. */
  enter(ctx: ModeContext, online: boolean): void;
  /** One tick: seats a car that was just placed, retries a pending request, and clears everything when a room session begins. */
  tick(ctx: ModeContext, online: boolean): void;
  /** Retires every owned car and drops the session state. */
  exit(ctx: ModeContext): void;
  /** Runs `vehicle.spawn` and `vehicle.clear`; any other event is ignored. */
  onEvent(ctx: ModeContext, e: SimEvent, online: boolean): void;
  /** The handles of the cars this session placed, in placement order (M04e4). */
  handles(): readonly EntityHandle[];
  /** Retires one owned car and drops it from the list (M04e4); false when `h` is not owned. */
  dismiss(ctx: ModeContext, h: EntityHandle, online: boolean): boolean;
}

export function createSandboxVehicles(port: () => SandboxVehiclePort | null): SandboxVehicles {
  let owned: Owned[] = [];
  let pending: Pending | null = null;
  /** The car just placed with the player to be seated at the next tick. */
  let seatNext: EntityHandle | null = null;
  /** Counts for the key `veh:sbx<n>`; never resets within a sim session. */
  let n = 0;

  const toast = (ctx: ModeContext, id: string, kind: 'info' | 'warning', params?: Record<string, string | number>): void =>
    ctx.ui.toast({ id, kind, text: id, ...(params ? { params } : {}) });

  const guard = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };

  const publish = (ctx: ModeContext, online: boolean): void => {
    const view = {
      catalog: sandboxCatalog().map((c) => ({ prefab: c.prefab, cls: c.cls, nameKey: c.nameKey })),
      owned: owned.map((o) => ({ key: o.key, nameKey: o.nameKey })),
      cap: SAVE_LIMITS.sandboxVehicleCap,
      pending: pending ? pending.prefab : null,
      online,
    };
    ctx.ui.patch(VEHICLES_VM, view as unknown as JsonValue);
  };

  const retireAll = (): void => {
    const p = port();
    for (const o of owned) guard(() => p?.retire(o.h), undefined);
    owned = [];
    pending = null;
    seatNext = null;
  };

  /** The placement itself, once the model is ready. */
  const place = (ctx: ModeContext, car: CatalogCar, seat: Seat, online: boolean): void => {
    const p = port();
    if (!p) {
      toast(ctx, REFUSE_NO_SPOT, 'warning');
      return;
    }
    if (seat === 'driver' && guard(() => p.playerDriving(), false)) {
      toast(ctx, REFUSE_ON_FOOT, 'warning');
      return;
    }
    const at = guard(() => p.spot(), null);
    if (!at) {
      toast(ctx, REFUSE_NO_SPOT, 'warning');
      return;
    }
    // cars that are gone by themselves do not count against the cap
    owned = owned.filter((o) => guard(() => p.alive(o.h), false));
    const cap = SAVE_LIMITS.sandboxVehicleCap;
    if (owned.length >= cap) {
      const i = owned.findIndex((o) => !guard(() => p.inUse(o.h), true));
      if (i < 0) {
        toast(ctx, REFUSE_NO_SPOT, 'warning');
        return;
      }
      const [old] = owned.splice(i, 1);
      if (old) guard(() => p.retire(old.h), undefined);
      toast(ctx, STATUS_TOWED, 'info');
    }
    const key = `veh:sbx${n++}`;
    const h = guard(() => p.spawn(car.prefab, at, key), null);
    if (h === null) {
      toast(ctx, REFUSE_NO_SPOT, 'warning');
      return;
    }
    owned.push({ key, prefab: car.prefab, nameKey: car.nameKey, h });
    seatNext = seat === 'driver' ? h : null;
    publish(ctx, online);
  };

  const tryPlace = (ctx: ModeContext, prefab: string, seat: Seat, online: boolean): void => {
    const car = sandboxCatalog().find((c) => c.prefab === prefab);
    if (!car) return;
    pending = null;
    const p = port();
    if (p && seat === 'driver' && guard(() => p.playerDriving(), false)) {
      toast(ctx, REFUSE_ON_FOOT, 'warning');
      return;
    }
    if (p) guard(() => p.prepare(prefab), undefined);
    ctx.assets.request([car.asset], 'now');
    if (!ctx.assets.ready([car.asset])) {
      pending = { prefab, seat: seat === 'driver', since: ctx.tick };
      toast(ctx, STATUS_PREPARING, 'info');
      publish(ctx, online);
      return;
    }
    place(ctx, car, seat, online);
  };

  return {
    enter(ctx, online) {
      owned = [];
      pending = null;
      seatNext = null;
      publish(ctx, online);
    },

    tick(ctx, online) {
      if (online) {
        if (owned.length > 0 || pending !== null) {
          retireAll();
          publish(ctx, online);
        }
        return;
      }
      if (seatNext !== null) {
        const h = seatNext;
        seatNext = null;
        const p = port();
        if (p) guard(() => p.seat(h), false);
      }
      if (pending === null) return;
      const car = sandboxCatalog().find((c) => c.prefab === pending?.prefab);
      if (!car) {
        pending = null;
        return;
      }
      const { seat, since } = pending;
      if (ctx.assets.ready([car.asset])) {
        pending = null;
        place(ctx, car, seat ? 'driver' : 'none', online);
        publish(ctx, online);
      } else if (ctx.tick - since >= READY_WAIT_TICKS) {
        pending = null;
        toast(ctx, REFUSE_NOT_READY, 'warning');
        publish(ctx, online);
      }
    },

    exit(ctx) {
      retireAll();
      publish(ctx, false);
    },

    handles: () => owned.map((o) => o.h),

    dismiss(ctx, h, online) {
      const i = owned.findIndex((o) => o.h === h);
      if (i < 0) return false;
      const [gone] = owned.splice(i, 1);
      const p = port();
      if (gone) guard(() => p?.retire(gone.h), undefined);
      publish(ctx, online);
      return true;
    },

    onEvent(ctx, e, online) {
      const m = parseSandboxCmd(e);
      if (m === null || online || !(VEHICLE_ACTIONS as readonly string[]).includes(m.name)) return;
      if (m.name === 'vehicle.clear') {
        retireAll();
        publish(ctx, online);
        return;
      }
      const prefab = m.args['prefab'];
      const seat = m.args['seat'];
      if (typeof prefab !== 'string' || (seat !== 'none' && seat !== 'driver')) return;
      tryPlace(ctx, prefab, seat, online);
    },
  };
}
