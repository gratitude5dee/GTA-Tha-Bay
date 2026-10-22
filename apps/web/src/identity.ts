import { LocalIdentity } from '@dv/identity';
import type { AgeBracket, IdentityService, IdentityState } from '@dv/shared';
import type { PrefsStore } from '@dv/ui';

/**
 * Boot wiring of the P0 identity (M04b3). One `LocalIdentity` is opened at page load, never blocking the title screen: until it opens,
 * attestations are queued and applied in order. A bracket the shell stored in `UiPrefs.age` (M04b1) is migrated into `dv-identity` once;
 * from then on the identity is the source of truth. Any failure here (a private window without IndexedDB, an engine without WebCrypto)
 * leaves single-player untouched: the identity is simply absent and every online path stays on its offline route (R-ROLL-01).
 */
export interface IdentityWiring {
  /** The rebound `AgeAttestationPort.attest`: forwards to `IdentityService.attestAge`. */
  attest(bracket: AgeBracket): void;
  service(): IdentityService | null;
  /** Feeds `BootConfig.region` to the play-token client once the boot probe answers. */
  setRegion(region: 'ok' | 'blocked'): void;
  ready: Promise<IdentityService | null>;
}

export function wireIdentity(prefs: PrefsStore): IdentityWiring {
  let region: 'ok' | 'blocked' | undefined;
  let service: IdentityService | null = null;
  const queue: AgeBracket[] = [];
  const ready: Promise<IdentityService | null> = (async () => {
    try {
      const identity = await LocalIdentity.open({ region: () => region });
      service = identity;
      const stored = prefs.get().age;
      if (identity.current().ageBracket === null && stored.attested === '18p') queue.unshift('18p');
      for (const bracket of queue.splice(0)) await identity.attestAge(bracket);
      return identity;
    } catch (error) {
      console.warn('identity unavailable; continuing without it', error);
      return null;
    }
  })();
  return {
    attest(bracket) {
      if (service) void service.attestAge(bracket).catch(() => undefined);
      else queue.push(bracket);
    },
    service: () => service,
    setRegion(r) {
      region = r;
    },
    ready,
  };
}

/** QA builds: `window.__dvBridge.identity` = `{ state(), authHeader() }`. */
export function installIdentityBridge(wiring: IdentityWiring): void {
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  const bridge = (w.__dvBridge ??= {});
  bridge.identity = {
    state: (): IdentityState | null => wiring.service()?.current() ?? null,
    authHeader: async (): Promise<{ Authorization: string } | null> => {
      const s = (await wiring.ready) ?? null;
      return s ? s.authHeader() : null;
    },
  };
}
