import type { AgeBracket, IdentityService, IdentityState, ProviderId } from '@dv/shared';
import { PlayTokenClient } from './play-token-client.ts';
import { idbStore, type IdentityStore, type StoredIdentity } from './store.ts';
import { thumbprint, type EcPublicJwk } from './thumbprint.ts';
import { uuid7 } from './uuid7.ts';

export interface LocalIdentityOptions {
  store?: IdentityStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** BootConfig.region when known. */
  region?: () => 'ok' | 'blocked' | undefined;
  apiBase?: string;
}

const notAvailable = (milestone: string): Promise<never> => Promise.reject(new Error(`not_available: lands in ${milestone}`));

/**
 * P0 identity (M04b3): no account, no network at boot. `open()` loads or mints the profile id and the non-extractable device key;
 * everything after that is synchronous except the play token (`authHeader`).
 */
export class LocalIdentity implements IdentityService {
  private record: StoredIdentity;
  private readonly store: IdentityStore;
  private readonly listeners = new Set<(s: IdentityState) => void>();
  private readonly tokens: PlayTokenClient;
  private readonly opts: LocalIdentityOptions;

  private constructor(record: StoredIdentity, opts: LocalIdentityOptions, store: IdentityStore) {
    this.record = record;
    this.opts = opts;
    this.store = store;
    this.tokens = new PlayTokenClient({
      signer: {
        profileId: () => this.record.profileId,
        ageBracket: () => this.record.ageBracket,
        publicJwk: () => this.record.publicJwk,
        sign: async (data) =>
          new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.record.privateKey, data as BufferSource)),
      },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.region ? { region: opts.region } : {}),
      ...(opts.apiBase !== undefined ? { apiBase: opts.apiBase } : {}),
    });
  }

  static async open(opts: LocalIdentityOptions = {}): Promise<LocalIdentity> {
    const store = opts.store ?? idbStore();
    let record = await store.load();
    if (!record) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const exported = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as EcPublicJwk;
      const publicJwk: EcPublicJwk = { kty: exported.kty as string, crv: exported.crv as string, x: exported.x as string, y: exported.y as string };
      const now = (opts.now ?? Date.now)();
      record = {
        v: 1,
        profileId: uuid7(now),
        privateKey: pair.privateKey,
        publicJwk,
        thumbprint: await thumbprint(publicJwk),
        ageBracket: null,
        createdAt: now,
      };
      await store.save(record);
    }
    return new LocalIdentity(record, opts, store);
  }

  current(): IdentityState {
    return {
      profileId: this.record.profileId,
      tier: 'local',
      ageBracket: this.record.ageBracket,
      providers: [],
      deviceKeyThumbprint: this.record.thumbprint,
    };
  }

  authHeader(): Promise<{ Authorization: string } | null> {
    return this.tokens.authHeader();
  }

  /** Persists the bracket. No network call before M12a1 (route 15). */
  async attestAge(bracket: AgeBracket): Promise<IdentityState> {
    this.record = { ...this.record, ageBracket: bracket };
    this.tokens.reset();
    await this.store.save(this.record);
    const state = this.current();
    for (const cb of [...this.listeners]) cb(state);
    return state;
  }

  register(_turnstileToken: string): Promise<IdentityState> {
    return notAvailable('M12a1');
  }

  link(_p: Exclude<ProviderId, 'device'>): Promise<IdentityState> {
    return notAvailable('M13c1');
  }

  unlink(_p: ProviderId): Promise<IdentityState> {
    return notAvailable('M12a1');
  }

  signInOnNewDevice(_p: 'thirdweb' | 'openai'): Promise<IdentityState> {
    return notAvailable('M14a');
  }

  /** `DELETE /api/v1/me` once (route 14 lands in M06a1; a 404 or a network error is ignored), then wipe `dv-identity`. */
  async forget(): Promise<void> {
    try {
      await (this.opts.fetch ?? fetch)(`${this.opts.apiBase ?? ''}/api/v1/me`, { method: 'DELETE' });
    } catch {
      /* offline or no such route yet */
    }
    this.tokens.reset();
    await this.store.clear();
  }

  onChange(cb: (s: IdentityState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
