import type { GameModeDescriptor, GameModeSim, JsonObject, ModeContext, SandboxSlice } from '@dv/shared';
import { noopUi } from './coming-soon.ts';

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
}

/** Pushes the toggles to the view model (`mode.sandbox.toggles`). */
export function publishToggles(ctx: Pick<ModeContext, 'ui'>, s: SandboxSlice): void {
  ctx.ui.patch('mode.sandbox.toggles', { ...s.toggles });
}

/**
 * Applies one sandbox toggle (`UiCommand sandbox.set`): writes `SandboxSlice.toggles`, publishes them, and acts on the ones this
 * milestone knows. "Never wanted" caps the heat at 0 (`PursuitApi.capHeat`); a build without the pursuit director keeps the value only.
 */
export function applyToggle(ctx: ModeContext, s: SandboxSlice, path: string, v: boolean | number): boolean {
  if (sandboxOnline(ctx)) return false;
  if (!/^sandbox\.[a-zA-Z0-9_.]{1,80}$/.test(path)) return false;
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
  return {
    enter(ctx) {
      publishToggles(ctx, env.sandbox());
      const v = env.sandbox().toggles[NEVER_WANTED];
      if (v && !sandboxOnline(ctx)) applyToggle(ctx, env.sandbox(), NEVER_WANTED, v);
    },
    tick() {},
    exit(ctx) {
      try {
        ctx.pursuit.capHeat(6);
      } catch {
        // no pursuit director in this build
      }
      return { outcome: 'quit' };
    },
    saveSlice: () => env.sandbox() as unknown as JsonObject,
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
