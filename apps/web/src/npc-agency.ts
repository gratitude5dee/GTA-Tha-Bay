/**
 * The page side of the NPC agency (M06c): the hero intent driver and the roster-flag feed. The sim publishes intent requests on
 * `sys.npc.intents`; the driver applies the throttles and calls route 32; the answer goes back to `sim.worker` as a `mode.cmd` of the
 * reserved owner `npc`. The flag feed hands route 30's kill flags to the sim. Nothing here runs before the age screen has settled
 * (`startAfter`), and nothing here is needed for the game to run: both stay silent on any failure.
 */
import type { UiCommand } from '@dv/shared';
import type { IdentityWiring } from './identity.ts';

export interface AgencyEngine {
  vm: { subscribe(key: 'sys.npc.intents', cb: (v: unknown) => void): () => void };
  sendUi(cmd: UiCommand): void;
}

export interface AgencyOptions {
  engine: AgencyEngine;
  identity: IdentityWiring;
  /** The quality tier id; `mobile-low` turns intents off. */
  tier: () => string;
  /** Settles when requests to the Worker API may start (the age gate). */
  startAfter: Promise<void>;
}

const send = (engine: AgencyEngine, name: string, args: Record<string, unknown>): void =>
  engine.sendUi({ t: 'mode.cmd', mode: 'npc' as never, name, args: args as never });

export async function installNpcAgency(o: AgencyOptions): Promise<{ stop(): void }> {
  const [{ IntentDriver, attachIntentDriver }, { startFlagsFeed }] = await Promise.all([import('@dv/npc/intent'), import('@dv/npc/flags')]);
  const driver = new IntentDriver({
    auth: async () => {
      const service = await o.identity.ready;
      return service === null ? null : service.authHeader();
    },
    online: () => navigator.onLine,
    tier: o.tier,
    deliver: (npcId, intent, rid) => send(o.engine, 'intent', { npcId, rid, intent }),
  });
  const detach = attachIntentDriver(o.engine.vm, driver);
  let feed: { stop(): void } | null = null;
  let stopped = false;
  void o.startAfter.then(() => {
    if (stopped) return;
    feed = startFlagsFeed({
      send: (flags) => send(o.engine, 'flags', { killed: flags.killed as never }),
      onVisible: (fn) => {
        const h = (): void => {
          if (document.visibilityState === 'visible') fn();
        };
        document.addEventListener('visibilitychange', h);
        return () => document.removeEventListener('visibilitychange', h);
      },
    });
  });
  return {
    stop() {
      stopped = true;
      detach();
      feed?.stop();
    },
  };
}
