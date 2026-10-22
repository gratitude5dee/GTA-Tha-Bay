import type { AgeBracket, PlayTokenReq, PlayTokenRes } from '@dv/shared';
import { b64url, type EcPublicJwk } from './thumbprint.ts';

const REFRESH_MARGIN_MS = 5 * 60_000;
export const RETRY_BLOCK_MS = 60_000;
export const PLAY_TOKEN_PATH = '/api/v1/id/play-token';

export interface PlayTokenSigner {
  profileId(): string;
  ageBracket(): AgeBracket | null;
  publicJwk(): EcPublicJwk;
  /** ECDSA P-256 SHA-256 over the bytes; the client normalises the result to raw r||s. */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface PlayTokenClientOptions {
  signer: PlayTokenSigner;
  fetch?: typeof fetch;
  now?: () => number;
  /** BootConfig.region when a boot config was obtained, else undefined (the client then tries). */
  region?: () => 'ok' | 'blocked' | undefined;
  apiBase?: string;
}

/**
 * Raw r||s (64 bytes) is what route 5 verifies. WebCrypto already returns it in every engine; a DER-shaped signature
 * (SEQUENCE of two INTEGERs) is converted, and anything else is refused.
 */
export function toRawSignature(sig: Uint8Array): Uint8Array {
  if (sig.length === 64) return sig;
  if (sig.length < 8 || sig[0] !== 0x30) throw new Error('unrecognised ECDSA signature format');
  let i = 2;
  if (sig[1]! & 0x80) i = 2 + (sig[1]! & 0x7f);
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (sig[i] !== 0x02) throw new Error('unrecognised ECDSA signature format');
    let len = sig[i + 1]!;
    let start = i + 2;
    while (len > 32 && sig[start] === 0) {
      start++;
      len--;
    }
    if (len > 32 || start + len > sig.length) throw new Error('unrecognised ECDSA signature format');
    out.set(sig.subarray(start, start + len), part * 32 + (32 - len));
    i = start + len;
  }
  return out;
}

/** Obtains and caches the 24 h play token (C12 section 2.2 client rule: every failure is `null`, callers play offline). */
export class PlayTokenClient {
  private readonly opts: PlayTokenClientOptions;
  private token: { value: string; exp: number } | null = null;
  private blockedUntil = 0;
  private inflight: Promise<{ Authorization: string } | null> | null = null;

  constructor(opts: PlayTokenClientOptions) {
    this.opts = opts;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  authHeader(): Promise<{ Authorization: string } | null> {
    if (this.opts.signer.ageBracket() !== '18p') return Promise.resolve(null);
    if (this.opts.region?.() === 'blocked') return Promise.resolve(null);
    const now = this.now();
    if (this.token && now < this.token.exp - REFRESH_MARGIN_MS) return Promise.resolve({ Authorization: `PlayToken ${this.token.value}` });
    if (now < this.blockedUntil) return Promise.resolve(null);
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<{ Authorization: string } | null> {
    const { signer } = this.opts;
    try {
      const ts = this.now();
      const pid = signer.profileId();
      const sig = toRawSignature(await signer.sign(new TextEncoder().encode(`pt-req|${pid}|${ts}`)));
      const body: PlayTokenReq = { pid, jwk: signer.publicJwk(), ts, sig: b64url(sig), age: '18p' };
      const res = await (this.opts.fetch ?? fetch)(`${this.opts.apiBase ?? ''}${PLAY_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return this.fail();
      const out = (await res.json()) as Partial<PlayTokenRes>;
      if (typeof out.token !== 'string' || typeof out.exp !== 'number') return this.fail();
      this.token = { value: out.token, exp: out.exp };
      return { Authorization: `PlayToken ${out.token}` };
    } catch {
      return this.fail();
    }
  }

  private fail(): null {
    this.token = null;
    this.blockedUntil = this.now() + RETRY_BLOCK_MS;
    return null;
  }

  /** Drops the cached token (forget, age change). */
  reset(): void {
    this.token = null;
    this.blockedUntil = 0;
  }
}
