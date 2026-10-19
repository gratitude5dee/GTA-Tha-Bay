/**
 * The mock webhook signing key. It is a fixed, public test key: its seed is in the source on purpose, so every isolate
 * (the Worker that serves the JWKS, the Workflow that posts the webhook, the tests) derives the same pair. Verification in
 * live mode reads only fal's own JWKS, never this key.
 */
import type { Jwks } from '../fal.ts';

const SEED = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
// PKCS#8 wrapper of an Ed25519 seed (RFC 8410): fixed 16-byte prefix + the 32-byte seed.
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export interface MockKeyPair {
  privateKey: CryptoKey;
  jwks: Jwks;
}

let pair: Promise<MockKeyPair> | null = null;

export function mockKeyPair(): Promise<MockKeyPair> {
  pair ??= (async () => {
    const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + SEED.length);
    pkcs8.set(PKCS8_PREFIX, 0);
    pkcs8.set(SEED, PKCS8_PREFIX.length);
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
    const jwk = (await crypto.subtle.exportKey('jwk', privateKey)) as { x: string };
    return { privateKey, jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: 'dv-mock-1' }] } };
  })();
  return pair;
}

export async function mockJwks(): Promise<Jwks> {
  return (await mockKeyPair()).jwks;
}
