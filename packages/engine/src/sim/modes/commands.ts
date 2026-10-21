import type { JsonObject, ModeContext, SimEventBus, UiBridge, UiCommand, WorldApi } from '@dv/shared';
import { applyToggle } from './builtin/sandbox.ts';
import type { ModeHost, SessionSlices } from './host.ts';
import { applySettings } from '../input/remap-persist.ts';

export interface CommandDeps {
  host: ModeHost;
  slices(): SessionSlices;
  ui: UiBridge;
  events: SimEventBus;
  tick(): number;
  /** The context of the running `sandbox` mode, or null when another mode (or none) runs. */
  sandboxContext(): ModeContext | null;
  world(): WorldApi;
  /** Moves the player to a point (the ownership machine's teleport); false when it is refused. */
  teleport?(x: number, y: number, z: number): boolean;
  /** The page pauses itself; the sim only learns of it (QA and later the HUD). */
  onPause?(on: boolean): void;
}

/**
 * The worker side of the UI command channel (C06 1.1 `UiCommand`). A command is applied between ticks, as soon as it arrives, so
 * a settings page opened over a paused game still works. Handled here: `mode.start`, `mode.quit`, `pause`, `save.*` (except
 * profile management, which M04b1 owns), `sandbox.set`, `sandbox.teleport`, `phone.waypoint`, `mode.cmd`, and the cutscene
 * commands (forwarded as events for M05b2). `garage.call` and `garage.favorite` raise one `garage.notYet` toast and change nothing
 * until M05c1 routes them (DL-668 part 3).
 */
export function createCommandDispatcher(d: CommandDeps): (cmd: UiCommand) => void {
  const toast = (id: string, kind: 'info' | 'warning', text: string, params?: Record<string, string | number>): void =>
    d.ui.toast({ id, kind, text, ...(params ? { params } : {}) });
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
        if (changed.length > 0) d.host.autosave.request('settings');
        return;
      }
      case 'save.avatar':
        d.slices().core.avatar = cmd.avatar;
        d.host.autosave.request('manual');
        return;
      case 'save.profile':
        toast('save.profile', 'info', 'save.profile.notYet');
        return;
      case 'garage.call':
      case 'garage.favorite':
        toast('garage.notYet', 'info', 'garage.notYet');
        return;
      case 'sandbox.set': {
        const ctx = d.sandboxContext();
        if (ctx) applyToggle(ctx, d.slices().sandbox, cmd.path, cmd.v);
        return;
      }
      case 'sandbox.teleport': {
        if (!d.sandboxContext()) return;
        const p = d.slices().sandbox.savedPositions.find((s) => s.name === cmd.name);
        if (!p || !d.teleport?.(p.x, p.y, p.z)) toast('sandbox.teleport', 'warning', 'world.teleport.notLoaded');
        return;
      }
      case 'phone.waypoint':
        d.world().map.setWaypoint(cmd.x, cmd.z);
        return;
      case 'cutscene.skip':
        d.events.emit({ t: 'cutscene.skip', tick: d.tick() });
        return;
      case 'cutscene.state':
        d.events.emit({ t: 'cutscene.state', tick: d.tick(), s: JSON.stringify({ playId: cmd.playId, item: cmd.item, state: cmd.state }) });
        return;
      case 'mode.cmd':
        d.events.emit({ t: 'mode.cmd', tick: d.tick(), s: JSON.stringify({ mode: cmd.mode, name: cmd.name, args: cmd.args ?? null }) });
        return;
    }
  };
}
