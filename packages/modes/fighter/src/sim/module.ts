/**
 * The fighter sim module (M08a2, `SimModule`, DL-651): what the sim worker needs for Culture Wars, and nothing for a session that
 * does not fight. It is on when the boot payload says so (`BootPayload.config.fighter === true`; QA builds set it with `?fighter=1`
 * and the page sets it for a player who starts the mode). Off, it adds no component, no prefab and no resource, so the session
 * registers and hashes exactly as a session without the module; the mode then runs on the view model alone.
 *
 * On: the components 1280 to 1283 and their prefabs (the ECS mirror), and the hashed resource `fighter.match`, added when the
 * first match starts. The leniency of the render tier (150 on `mobile-low`, a 30 fps tier) is set in either case.
 */
import { MODES_MODULE_ID, type DebugCommand, type EntityPrefabDef, type ModesModule, type PrefabRegistry, type SimModule, type SimModuleContext, type SimResource } from '@dv/engine/sim';
import type { BootPayload, ComponentDef } from '@dv/shared';
import { FIGHTER_COMPONENTS, FIGHTER_PREFABS } from '../components.ts';
import { setFighterHost } from './host.ts';
import { activeSession, type FighterSession } from './mode.ts';

export const FIGHTER_MODULE_ID = 'mode.fighter';

export const fighterEnabled = (boot: BootPayload): boolean => boot.config['fighter'] === true;

/** What the QA handler may touch. */
export interface FighterQaContext {
  host: ReturnType<ModesModule['host']>;
  session: FighterSession | null;
}
/** Plain `send(name, data)`, the reply name chosen by the handler like racing's, so a production sim bundle carries no `modes.reply.` string. */
export type FighterQaHandler = (cx: FighterQaContext, cmd: Extract<DebugCommand, { t: 'debug.modes' }>, send: (name: string, data: unknown) => void) => void;

export interface FighterModule extends SimModule {
  installQa(h: FighterQaHandler): void;
}

export function createFighterModule(): FighterModule {
  let cx: SimModuleContext | null = null;
  let qaHandler: FighterQaHandler | null = null;
  let digest: (() => [number, number, number] | null) | null = null;
  let registered = false;
  const resource: SimResource = {
    name: 'fighter.match',
    hash(h) {
      const d = digest?.();
      if (d) { h.u32(d[0]); h.u32(d[1]); h.u32(d[2]); }
    },
    save() {},
    load() {},
  };
  return {
    id: FIGHTER_MODULE_ID,
    systems: [],
    components(boot): readonly ComponentDef[] {
      return fighterEnabled(boot) ? FIGHTER_COMPONENTS : [];
    },
    installQa(h) {
      qaHandler = h;
    },
    onDebug(cmd: DebugCommand): void {
      if (!qaHandler || !cx || cmd.t !== 'debug.modes' || !cmd.op.startsWith('fighter.')) return;
      const c = cx;
      const modes = (c.runtime.env.modules ?? []).find((m) => m.id === MODES_MODULE_ID) as ModesModule | undefined;
      qaHandler({ host: modes?.host() ?? null, session: activeSession() }, cmd, (name, data) => {
        void c.runtime.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } });
      });
    },
    onInit(ctx: SimModuleContext): void {
      cx = ctx;
      const { sim } = ctx;
      let mirror = false;
      if (fighterEnabled(ctx.boot)) {
        // The prefab registry lives in the vehicle module; a sim without one (a physics-free scenario) runs the mode on the view model alone.
        const vc = sim.services.vehicleCtx;
        if (vc) {
          (vc.prefabs as unknown as PrefabRegistry).load(FIGHTER_PREFABS as unknown as readonly EntityPrefabDef[]);
          mirror = true;
        }
      }
      setFighterHost({
        mirror,
        leniencyX100: ctx.cfg.tier === 'mobile-low' ? 150 : 100,
        build: 'dev',
        attach(d) {
          digest = d;
          if (d && !registered) {
            sim.core.addResource(resource);
            registered = true;
          }
        },
      });
    },
  };
}
