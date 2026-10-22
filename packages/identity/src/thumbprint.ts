export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The members an EC public JWK needs for its RFC 7638 thumbprint. */
export interface EcPublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  [member: string]: unknown;
}

/**
 * RFC 7638 thumbprint: base64url SHA-256 of the required members (`crv`, `kty`, `x`, `y`) in lexical order, no whitespace.
 * Optional members such as `kid`, `use` and `key_ops` do not take part.
 */
export async function thumbprint(jwk: EcPublicJwk): Promise<string> {
  if (jwk.kty !== 'EC' || typeof jwk.crv !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('thumbprint: an EC public JWK with crv, x and y is required');
  }
  const text = `{"crv":${JSON.stringify(jwk.crv)},"kty":"EC","x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
