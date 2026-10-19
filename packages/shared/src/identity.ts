// C12 identity types (spec/domains/09-backend-contracts.md section 2.3, with the 1.3 member of
// 09-backend-contracts-1.3.md section 2). M00e creates this file with the two types the 1.3 DTOs need;
// M04b3 extends it with Tier, IdentityState and IdentityService. Types only; no IO.

/** C12 1.3 adds 'password' (ADR-ACCT-01); it never grants 'linked'. */
export type ProviderId = 'device' | 'openai' | 'thirdweb' | 'supabase-oauth' | 'password';

export type AgeBracket = 'u13' | '13_15' | '16_17' | '18p';
