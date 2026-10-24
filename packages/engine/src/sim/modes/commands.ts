import type { JsonObject, ModeContext, ProfileSettings, SimEventBus, UiBridge, UiCommand, WorldApi } from '@dv/shared';
import { SANDBOX_REFUSE_ONLINE, applyToggle } from './builtin/sandbox.ts';
import type { SandboxWorldPort } from './builtin/sandbox-world.ts';
import { POSITION_MISSING, sandboxGo, type Pose, type WaypointMemo } from './builtin/sandbox-teleport.ts';
import type { RidePort } from '../services.ts';
import type { ModeHost, SessionSlices } from './host.ts';
import { applySettings } from '../input/remap-persist.ts';
import type { GarageService } from '../garage/garage.ts';

export interface CommandDeps {
  host: ModeHost;
  slices(): SessionSlices;
  ui: UiBridge;
  events: SimEventBus;
  tick(): number;
  /** The context of the running `sandbox` mode, or null when another mode (or none) runs. */
  sandboxContext(): ModeContext | null;
  world(): WorldApi;
  /** The weather hold and the world speed of the sandbox (M04e1), or null without a running sim. */
  sandboxWorld?(): SandboxWorldPort | null;
  /** Moves the player to a point (the ownership machine's teleport); false when it is refused. The sandbox no longer uses it (M04e2). */
  teleport?(x: number, y: number, z: number): boolean;
  /** The map pin the player dropped (M04e2): `phone.waypoint` sets it and `map.waypoint.clear` clears it. */
  waypoint?: WaypointMemo;
  /** The local player's feet and heading, or null (M04e2): "back" remembers the pose read before a jump. */
  playerPose?(): Pose | null;
  /** The page pauses itself; the sim only learns of it (QA and later the HUD). */
  onPause?(on: boolean): void;
  /** The phone's Ride app (M04b2): the transit system's port, or null while no baked world runs. */
  ride?(): RidePort | null;
  /** The garage module (M05c1): `garage.call` and `garage.favorite` go to it. Without one both raise `garage.refuse.noWorld` and change nothing. */
  garage?(): GarageService | null;
  /** Loads another profile's slices into the session (M04b1). Only called while no mode runs. */
  selectProfile?(id: string): void;
}

/**
 * The worker side of the UI command channel (C06 1.1 `UiCommand`). A command is applied between ticks, as soon as it arrives, so
 * a settings page opened over a paused game still works. Handled here: `mode.start`, `mode.quit`, `pause`, `save.*` (except
 * profile management: the page creates, renames and deletes profiles, the sim only selects one), `sandbox.set`, `sandbox.teleport`, `phone.waypoint`, `mode.cmd`, and the cutscene
 * commands (forwarded as events for M05b2). `garage.call` and `garage.favorite` go to the garage module (M05c1, DL-668 part 3).
 */
/** `sys.settings`: the profile settings without `controls` (those ride `sys.controls`), so a long remap list cannot push the value over the 4 KiB patch limit. */
export function settingsView(s: ProfileSettings): JsonObject {
  const { controls: _controls, ...rest } = s;
  return rest as unknown as JsonObject;
}

export function createCommandDispatcher(d: CommandDeps): (cmd: UiCommand) => void {
  const toast = (id: string, kind: 'info' | 'warning', text: string, params?: Record<string, string | number>): void =>
    d.ui.toast({ id, kind, text, ...(params ? { params } : {}) });
  /** True while any running mode's context has a room session (M04e0): the sandbox tools are refused then. */
  const online = (): boolean => d.host.stack.entries.some((e) => e.ctx.net !== null);
  const refuseOnline = (): void => toast(SANDBOX_REFUSE_ONLINE, 'warning', SANDBOX_REFUSE_ONLINE);
  return (cmd) => {
    switch (cmd.t) {
      case 'mode.start': {
        const r = d.host.start(cmd.id);
        if (!r.ok && r.reason !== 'coming-soon') toast(`mode:${cmd.id}`, 'warning', `mode.refused.${r.reason}`, { mode: cmd.id });
        return;
      }
      case 'mode.quit':
        d.host.quit();
        return;
      case 'pause':
        d.onPause?.(cmd.on);
        return;
      case 'save.request':
        d.host.autosave.request(cmd.reason);
        return;
      case 'save.settings': {
        const s = d.slices().settings;
        const changed = applySettings(s, cmd.data);
        if (changed.includes('controls')) d.ui.patch('sys.controls', s.controls as unknown as JsonObject);
        if (changed.length > 0) {
          d.ui.patch('sys.settings', settingsView(s));
          d.host.autosave.request('settings');
        }
        return;
      }
      case 'save.avatar':
        d.slices().core.avatar = cmd.avatar;
        d.ui.patch('sys.avatar', cmd.avatar);
        d.host.saveCore();
        return;
      case 'save.profile':
        // Create, rename and delete run on the page's SaveService (profile rows only; BD-M04b1-02). The sim handles `select`.
        if (cmd.op === 'select' && cmd.id) {
          if (d.host.state !== 'Idle') toast('save.profile', 'warning', 'save.profile.busy');
          else d.selectProfile?.(cmd.id);
        }
        return;
      case 'garage.call': {
        const g = d.garage?.() ?? null;
        if (g) g.call(cmd.vehicleKey);
        else toast('garage.refuse.noWorld', 'warning', 'garage.refuse.noWorld');
        return;
      }
      case 'garage.favorite': {
        const g = d.garage?.() ?? null;
        if (g) g.favorite(cmd.vehicleKey);
        else toast('garage.refuse.noWorld', 'warning', 'garage.refuse.noWorld');
        return;
      }
      case 'sandbox.set': {
        if (online()) {
          refuseOnline();
          return;
        }
        const ctx = d.sandboxContext();
        if (ctx) applyToggle(ctx, d.slices().sandbox, cmd.path, cmd.v, d.sandboxWorld?.() ?? null);
        return;
      }
      case 'sandbox.teleport': {
        if (online()) {
          refuseOnline();
          return;
        }
        const ctx = d.sandboxContext();
        if (!ctx) return;
        const p = d.slices().sandbox.savedPositions.find((s) => s.name === cmd.name);
        if (!p) toast(POSITION_MISSING, 'warning', POSITION_MISSING);
        else sandboxGo(ctx, { x: p.x, z: p.z, yaw: p.yaw }, goEnv(d), d.slices().sandbox);
        return;
      }
      case 'phone.waypoint':
        // the waypoint is the GPS target too (M02c2, 02-world-maps.md 3.3): the route is planned at the next Publish
        d.waypoint?.set(cmd.x, cmd.z);
        d.world().map.setWaypoint(cmd.x, cmd.z);
        d.world().map.setRoute({ x: cmd.x, z: cmd.z });
        return;
      case 'cutscene.skip':
        d.events.emit({ t: 'cutscene.skip', tick: d.tick() });
        return;
      case 'cutscene.state':
        d.events.emit({ t: 'cutscene.state', tick: d.tick(), s: JSON.stringify({ playId: cmd.playId, item: cmd.item, state: cmd.state, trigger: cmd.trigger, outcome: cmd.outcome }) });
        return;
      case 'mode.cmd':
        if ((cmd.mode as string) === 'phone') {
          phoneCommand(d, cmd.name, cmd.args ?? null, toast, online);
          return;
        }
        if ((cmd.mode as string) === 'sandbox' && online()) {
          refuseOnline();
          return;
        }
        d.events.emit({ t: 'mode.cmd', tick: d.tick(), s: JSON.stringify({ mode: cmd.mode, name: cmd.name, args: cmd.args ?? null }) });
        return;
    }
  };
}

/** What `sandboxGo` reads of the engine: the pose and the pin. */
function goEnv(d: CommandDeps): { playerPose?(): Pose | null; waypoint?(): { x: number; z: number } | null } {
  return {
    ...(d.playerPose ? { playerPose: d.playerPose } : {}),
    ...(d.waypoint ? { waypoint: () => d.waypoint?.get() ?? null } : {}),
  };
}

/** Phone commands ride `mode.cmd` with the reserved owner `phone` (C06 leaves `mode.cmd` to the owner named in `mode`). */
function phoneCommand(d: CommandDeps, name: string, args: JsonObject | null, toast: (id: string, kind: 'info' | 'warning', text: string, params?: Record<string, string | number>) => void, online: () => boolean): void {
  // The Map app's commands (M02c2): clear the waypoint and its route, and fast travel to a point (sandbox only; it is the `sandbox` teleport of the world API).
  if (name === 'map.waypoint.clear') {
    d.waypoint?.clear();
    d.world().map.clearWaypoint();
    d.world().map.setRoute(null);
    return;
  }
  if (name === 'map.travel') {
    const x = args?.['x'], z = args?.['z'];
    if (online()) {
      toast(SANDBOX_REFUSE_ONLINE, 'warning', SANDBOX_REFUSE_ONLINE);
      return;
    }
    if (typeof x !== 'number' || typeof z !== 'number') return;
    const ctx = d.sandboxContext();
    if (!ctx) {
      toast('map.travel', 'warning', 'map.travel.sandboxOnly');
      return;
    }
    sandboxGo(ctx, { x, z }, goEnv(d), d.slices().sandbox);
    return;
  }
  const ride = d.ride?.() ?? null;
  if (name === 'ride.list') {
    d.ui.patch('phone.ride', { ready: ride !== null, destinations: (ride?.destinations() ?? []).map((x) => ({ id: x.id, nameKey: x.nameKey, x: Math.round(x.x), z: Math.round(x.z) })) });
    return;
  }
  if (name !== 'ride.go' && name !== 'ride.taxi') return;
  if (!ride) {
    toast('ride', 'warning', 'world.teleport.notLoaded');
    return;
  }
  const done = (r: { ok: true; cents: number } | { ok: false; messageKey: string }): void => {
    if (r.ok) toast('ride', 'info', 'phone.ride.done', { fare: (r.cents / 100).toFixed(2) });
    else toast('ride', 'warning', r.messageKey);
  };
  if (name === 'ride.go') {
    const to = typeof args?.['to'] === 'string' ? args['to'] : '';
    void ride.fastTravelTo(to).then(done);
    return;
  }
  const wp = args?.['to'] as { x?: unknown; z?: unknown } | undefined;
  if (typeof wp?.x === 'number' && typeof wp.z === 'number') void ride.callRobotaxi({ x: wp.x, z: wp.z }).then(done);
  else toast('ride', 'warning', 'phone.ride.noWaypoint');
}
