/**
 * The racing sim module (M07a1, `SimModule`, DL-651): what the sim worker needs for races, and nothing for a session that does
 * not race. Racing is on when the boot payload says so (`BootPayload.config.racing === true`; QA builds set it with `?racing=1`,
 * and M07a2 turns it on for players with the mode's `available` status). When it is off the module adds no components, no
 * resource, no prefab and no host, so the session registers and hashes exactly as a session without the module.
 *
 * When it is on: components 1024 to 1031, the six race-car prefabs, the engine port over the player's car, and (on the first
 * race) the hashed resource `racing.session`, the way the economy registers its own on first use.
 */
import {
  MODES_MODULE_ID, RACE_CAR_PREFABS, type DebugCommand, type ModesModule, type PrefabRegistry, type SimModule, type SimModuleContext, type SimResource,
} from '@dv/engine/sim';
import type { BootPayload, ComponentDef } from '@dv/shared';
import { RACING_COMPONENTS } from '../components.ts';
import { createEnginePort } from './engine-port.ts';
import { setRacingHost } from './host.ts';
import { activeSession } from './mode.ts';
import type { RaceSession } from './session.ts';

export const RACING_MODULE_ID = 'mode.racing';

export const racingEnabled = (boot: BootPayload): boolean => boot.config['racing'] === true;

/** What the QA handler may touch. */
export interface RacingQaContext {
  host: ReturnType<ModesModule['host']>;
  session: RaceSession | null;
}
export type RacingQaHandler = (cx: RacingQaContext, cmd: Extract<DebugCommand, { t: 'debug.modes' }>, reply: (data: unknown) => void) => void;

export interface RacingModule extends SimModule {
  /** The session the state hash covers, if any (tests). */
  session(): RaceSession | null;
  /** Installs the QA command handler (`qa/debug.ts`); the QA worker entry does it. */
  installQa(h: RacingQaHandler): void;
}

export function createRacingModule(): RacingModule {
  let session: RaceSession | null = null;
  let registered = false;
  let cx: SimModuleContext | null = null;
  let qaHandler: RacingQaHandler | null = null;
  const resource: SimResource = {
    name: 'racing.session',
    hash(h) {
      if (session) session.hashInto(h);
    },
    save() {},
    load() {},
  };
  return {
    id: RACING_MODULE_ID,
    systems: [],
    session: () => session,
    components(boot): readonly ComponentDef[] {
      return racingEnabled(boot) ? RACING_COMPONENTS : [];
    },
    installQa(h) {
      qaHandler = h;
    },
    onDebug(cmd: DebugCommand): void {
      // QA builds only: the worker entry installs the handler (`qa/debug.ts`), so a production bundle carries none of it
      if (!qaHandler || !cx || cmd.t !== 'debug.modes' || !cmd.op.startsWith('racing.')) return;
      const c = cx;
      const modes = (c.runtime.env.modules ?? []).find((m) => m.id === MODES_MODULE_ID) as ModesModule | undefined;
      qaHandler({ host: modes?.host() ?? null, session: activeSession() }, cmd, (data) => {
        void c.runtime.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name: `modes.reply.${cmd.id}`, data } });
      });
    },
    onInit(ctx: SimModuleContext): void {
      cx = ctx;
      if (!racingEnabled(ctx.boot)) return;
      const { sim } = ctx;
      const vc = sim.services.vehicleCtx;
      if (!vc) throw new Error('racing: the vehicle module is not registered in this sim');
      const prefabs = vc.prefabs as unknown as PrefabRegistry;
      prefabs.load(RACE_CAR_PREFABS);
      const port = createEnginePort({
        ecs: sim.ecs, backend: sim.backend, services: sim.services, store: vc.store as never, prefabs, tick: () => sim.core.tick,
      });
      setRacingHost({
        port,
        profile: ctx.cfg.profile === 'canonical' ? 'canonical' : 'local',
        seed: ctx.cfg.seed,
        attach(s) {
          session = s;
          if (s && !registered) {
            sim.core.addResource(resource);
            registered = true;
          }
        },
      });
    },
  };
}
