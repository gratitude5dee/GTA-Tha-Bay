import type { GameModeDescriptor, GameModeSim, JsonObject, ModeContext, SandboxSlice } from '@dv/shared';
import { noopUi } from './coming-soon.ts';
import {
  applyStoredWorld, applyWorldSetting, isWorldPath, liveHour, publishWorld, releaseWorld, runSandboxAction, type SandboxWorldPort,
} from './sandbox-world.ts';
import { createSandboxVehicles } from './sandbox-vehicles.ts';
import type { SandboxVehiclePort } from '../sandbox-vehicle-port.ts';
import { enterTeleport, exitTeleport, runTeleportAction, type Pose } from './sandbox-teleport.ts';

export function defaultSandbox(): SandboxSlice {
  return { toggles: {}, savedPositions: [], clock: { hour: 12, paused: false, syncSystemTime: false }, weather: 'clear', presets: [] };
}

/** Toggle paths this milestone acts on; every other `sandbox.*` path is stored and shown but changes nothing yet. */
export const NEVER_WANTED = 'sandbox.player.neverWanted';
/** Sets the heat level 0 to 5 (the sandbox frame of the player section; the phone's Sandbox app, M04b2). */
export const SET_HEAT = 'sandbox.player.heat';
const MAX_TOGGLES = 128;
/** The toast key raised when a sandbox tool is refused because the session is online (M04e0). */
export const SANDBOX_REFUSE_ONLINE = 'sandbox.refuse.online';

/** True while the context has a room session (`ModeContext.net` set). Independent of the descriptor's `requires.network`. */
export function sandboxOnline(ctx: Pick<ModeContext, 'net'>): boolean {
  return ctx.net !== null;
}

export interface SandboxEnv {
  sandbox(): SandboxSlice;
  /** The weather hold and the world speed (M04e1). Absent or null: the values are stored and nothing else happens. */
  world?(): SandboxWorldPort | null;
  /** The local player's feet and heading, or null before it exists (M04e2). */
  playerPose?(): Pose | null;
  /** The map pin the player dropped, or null (M04e2). */
  waypoint?(): { x: number; z: number } | null;
  /** The engine side of the car spawner (M04e3). Absent or null: no world, so a car request is refused with `sandbox.refuse.noSpot`. */
  vehicles?(): SandboxVehiclePort | null;
}

/** Pushes the toggles to the view model (`mode.sandbox.toggles`). */
export function publishToggles(ctx: Pick<ModeContext, 'ui'>, s: SandboxSlice): void {
  ctx.ui.patch('mode.sandbox.toggles', { ...s.toggles });
}

/**
 * Applies one sandbox toggle (`UiCommand sandbox.set`): writes `SandboxSlice.toggles`, publishes them, and acts on the ones this
 * milestone knows. The heat lock caps the heat at 0 (`PursuitApi.capHeat`); a build without the pursuit director keeps the value only.
 */
export function applyToggle(ctx: ModeContext, s: SandboxSlice, path: string, v: boolean | number, port: SandboxWorldPort | null = null): boolean {
  if (sandboxOnline(ctx)) return false;
  if (!/^sandbox\.[a-zA-Z0-9_.]{1,80}$/.test(path)) return false;
  // The weather, time and world paths have one storage place each and one effect (M04e1).
  if (isWorldPath(path)) return applyWorldSetting(ctx, s, path, v, port, false);
  if (!(path in s.toggles) && Object.keys(s.toggles).length >= MAX_TOGGLES) return false;
  s.toggles[path] = v;
  publishToggles(ctx, s);
  if (path === SET_HEAT && typeof v === 'number') {
    try {
      const level = Math.max(0, Math.min(5, Math.round(v)));
      // `setHeat(0)` ends the pursuit; `clear` is for the scripted pursuit only.
      ctx.pursuit.setHeat(level as never, 'sandbox');
    } catch {
      // no pursuit director in this build
    }
  }
  if (path === NEVER_WANTED) {
    try {
      ctx.pursuit.capHeat(v ? 0 : 6);
      if (v) ctx.pursuit.clear('sandbox.neverWanted');
    } catch {
      // no pursuit director in this build
    }
  }
  return true;
}

/**
 * The `sandbox` mode: no story, no missions, toggles that live in the `sandbox` slice (never read by story). It adopts the scenario the
 * engine booted and spawns nothing, so entering it changes no entity (DL-668).
 */
export function sandboxSim(env: SandboxEnv): GameModeSim<JsonObject> {
  const port = (): SandboxWorldPort | null => env.world?.() ?? null;
  /** `sandboxOnline` at the previous tick: a change releases or re-applies the world effects. */
  let wasOnline = false;
  const cars = createSandboxVehicles(() => env.vehicles?.() ?? null);
  let n = 0;
  let shownHour = -1;
  return {
    enter(ctx) {
      publishToggles(ctx, env.sandbox());
      enterTeleport(ctx, env.sandbox());
      wasOnline = sandboxOnline(ctx);
      if (!wasOnline) {
        const v = env.sandbox().toggles[NEVER_WANTED];
        if (v) applyToggle(ctx, env.sandbox(), NEVER_WANTED, v);
        applyStoredWorld(ctx, env.sandbox(), port());
      }
      publishWorld(ctx, env.sandbox(), wasOnline);
      cars.enter(ctx, wasOnline);
    },
    tick(ctx) {
      const on = sandboxOnline(ctx);
      cars.tick(ctx, on);
      // The Time tab shows the hour of the last `mode.sandbox.world`: refresh it twice a second when it moved a tenth of an hour.
      if (on === wasOnline && ++n % 30 === 0) {
        const h = Math.round(liveHour(ctx, env.sandbox()) * 10);
        if (h !== shownHour) {
          shownHour = h;
          publishWorld(ctx, env.sandbox(), on);
        }
      }
      if (on === wasOnline) return;
      wasOnline = on;
      // A room never runs with a local hold, speed, blackout, density or pause; the stored values stay for the way back.
      if (on) releaseWorld(ctx, env.sandbox(), port());
      else applyStoredWorld(ctx, env.sandbox(), port());
      publishWorld(ctx, env.sandbox(), on);
    },
    exit(ctx) {
      cars.exit(ctx);
      exitTeleport(ctx);
      releaseWorld(ctx, env.sandbox(), port());
      try {
        ctx.pursuit.capHeat(6);
      } catch {
        // no pursuit director in this build
      }
      return { outcome: 'quit' };
    },
    saveSlice: () => env.sandbox() as unknown as JsonObject,
    onEvent(ctx, e) {
      runSandboxAction(ctx, env.sandbox(), e, port(), sandboxOnline(ctx));
      runTeleportAction(ctx, env.sandbox(), e, env, sandboxOnline(ctx));
      cars.onEvent(ctx, e, sandboxOnline(ctx));
    },
  };
}

export const sandboxDescriptor = (sim: GameModeSim): GameModeDescriptor => ({
  id: 'sandbox',
  version: 1,
  titleKey: 'mode.sandbox.title',
  tile: { art: 'ui/mode-sandbox', order: 5 },
  status: 'available',
  unlock: null,
  standalone: true,
  embeddable: false,
  requires: { simProfile: 'any', world: 'city', physics: true, xr: 'full', inputContexts: ['onFoot', 'vehicle'], network: 'none' },
  saveSlot: 'sandbox',
  sliceSchema: 1,
  sim: () => Promise.resolve({ default: sim }),
  ui: () => Promise.resolve({ default: noopUi }),
});
