// C12 identity types (spec/domains/09-backend-contracts.md section 2.3, with the 1.3 member of
// 09-backend-contracts-1.3.md section 2). M00e created this file with the two types the 1.3 DTOs need;
// M04b3 extends it with Tier, IdentityState, IdentityService and the token claim shapes. Types only; no IO.

/** C12 1.3 adds 'password' (ADR-ACCT-01); it never grants 'linked'. */
export type ProviderId = 'device' | 'openai' | 'thirdweb' | 'supabase-oauth' | 'password';

export type AgeBracket = 'u13' | '13_15' | '16_17' | '18p';

// ---- M04b3: C12 1.1 identity service (09-backend-contracts.md section 2.3, 09-backend-contracts-1.1.md section 2) ----

export type Tier = 'local' | 'device' | 'linked'; // P0 | P1 | P2/P3 (D-04)

export interface IdentityState {
  /** UUIDv7 minted on the device at first launch; never a provider subject; not the C05 save ProfileId. */
  profileId: string;
  tier: Tier;
  /** From the neutral age screen (S10); only '18p' may use online features (D-30). */
  ageBracket: AgeBracket | null;
  providers: { id: ProviderId; display?: string; linkedAt: number }[];
  /** RFC 7638 SHA-256 thumbprint of the device public JWK. */
  deviceKeyThumbprint: string;
}

export interface IdentityService {
  current(): IdentityState;
  /** P0: HMAC play token; P1+: ES256 access JWT. null if offline or under-18. */
  authHeader(): Promise<{ Authorization: string } | null>;
  /** Persists the bracket in IndexedDB dv-identity; from M12a also POSTs route 15. */
  attestAge(bracket: AgeBracket): Promise<IdentityState>;
  register(turnstileToken: string): Promise<IdentityState>; // P0 -> P1 (M12a)
  link(p: Exclude<ProviderId, 'device'>): Promise<IdentityState>; // M13c, M14a
  unlink(p: ProviderId): Promise<IdentityState>;
  signInOnNewDevice(p: 'thirdweb' | 'openai'): Promise<IdentityState>;
  /** DELETE /api/v1/me, then wipe local. */
  forget(): Promise<void>;
  onChange(cb: (s: IdentityState) => void): () => void;
}

/** P0 play token claims. Header: `Authorization: PlayToken <tok>`; tok = "pt1." + b64url(claims) + "." + b64url(HMAC-SHA256(first two parts)). */
export interface PlayTokenClaims {
  v: 1;
  pid: string;
  dkt: string;
  age: '18p';
  iat: number;
  /** iat + 24 h. */
  exp: number;
  kid: string;
}

export type StaffScope = 'mod:review' | 'mod:trust_lead' | 'admin' | 'ops';

/** P1+ access JWT claims (ES256, TTL 1 h). */
export interface AccessClaims {
  iss: string;
  sub: string;
  aud: 'tha-bay';
  role: 'authenticated';
  tier: 'device' | 'linked';
  prv: ProviderId[];
  ab: AgeBracket;
  scp?: StaffScope[];
  iat: number;
  exp: number;
  jti: string;
}
