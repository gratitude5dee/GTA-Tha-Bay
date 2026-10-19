import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  C12_VERSION,
  type AgeBracket,
  type FeatureFlag,
  type IdentityStateDTO,
  type LegalDocRes,
  type LoginReq,
  type LogoutRes,
  type PasswordExportRes,
  type PasswordMeRes,
  type PasswordSession,
  type PasswordSessionRes,
  type PasswordSignInRes,
  type PasswordUser,
  type ProviderId,
  type SignupReq,
  type TermsRequiredDetails,
  type TokenRes,
} from '../src/index.ts';

// C12 1.3 (spec/domains/09-backend-contracts-1.3.md section 2) and the 1.0 prerequisites created by M00e (section 2.3, 2.5 of
// 09-backend-contracts.md). The expectations restate the spec text, so a drift in the copied shapes fails here.
describe('C12 1.3 types', () => {
  it('ProviderId includes password and AgeBracket matches section 2.3', () => {
    expectTypeOf<ProviderId>().toEqualTypeOf<'device' | 'openai' | 'thirdweb' | 'supabase-oauth' | 'password'>();
    expectTypeOf<AgeBracket>().toEqualTypeOf<'u13' | '13_15' | '16_17' | '18p'>();
  });

  it('TokenRes and IdentityStateDTO match section 2.5', () => {
    expectTypeOf<TokenRes>().toEqualTypeOf<{
      accessToken: string;
      exp: number;
      refreshToken: string;
      refreshExp: number;
      state: IdentityStateDTO;
    }>();
    expectTypeOf<IdentityStateDTO>().toEqualTypeOf<{
      profileId: string;
      tier: 'local' | 'device' | 'linked';
      providers: { id: string; linkedAt: number }[];
    }>();
  });

  it('FeatureFlag includes auth.password', () => {
    expectTypeOf<'auth.password'>().toExtend<FeatureFlag>();
    expectTypeOf<'mods.ui'>().toExtend<FeatureFlag>();
  });

  it('the route DTOs of 1.3 section 2 exist with the specified members', () => {
    expectTypeOf<PasswordUser>().toEqualTypeOf<{ id: string; username: string }>();
    expectTypeOf<PasswordSession>().toEqualTypeOf<{ accessToken: string; expiresIn: number }>();
    expectTypeOf<SignupReq>().toEqualTypeOf<{ username: string; password: string; ageBracket: AgeBracket; termsVersion: string }>();
    expectTypeOf<LoginReq>().toEqualTypeOf<{ username: string; password: string; ageBracket?: AgeBracket; termsVersion?: string }>();
    expectTypeOf<PasswordSessionRes>().toEqualTypeOf<{ user: PasswordUser; session: PasswordSession }>();
    expectTypeOf<PasswordSignInRes>().toEqualTypeOf<PasswordSessionRes | TokenRes>();
    expectTypeOf<LogoutRes>().toEqualTypeOf<{ ok: true }>();
    expectTypeOf<PasswordMeRes>().toEqualTypeOf<{ user: PasswordUser }>();
    expectTypeOf<PasswordExportRes>().toEqualTypeOf<{
      username: string;
      ageBracket: '18p';
      termsVersion: string;
      acceptedAt: number;
      createdAt: number;
    }>();
    expectTypeOf<TermsRequiredDetails>().toEqualTypeOf<{ reason: 'terms_required'; termsVersion: string }>();
  });

  it('LegalDocRes is a module type exported from @dv/shared', () => {
    expectTypeOf<LegalDocRes['counselReviewed']>().toEqualTypeOf<boolean>();
    expectTypeOf<LegalDocRes['doc']>().toEqualTypeOf<'terms' | 'privacy'>();
  });

  it('C12_VERSION is unchanged (1.3 section 4)', () => {
    expect(C12_VERSION).toBe('1.1.0');
  });

  it('services/edge/src/routes/auth.ts declares no local request or response interface', () => {
    const src = readFileSync(new URL('../../../services/edge/src/routes/auth.ts', import.meta.url), 'utf8');
    const declared = [...src.matchAll(/^(?:export\s+)?interface\s+(\w+)/gm)].map((m) => m[1]);
    // Only upstream (GoTrue) shapes and the internal record may be declared here; none of them is a Req or Res DTO.
    for (const name of declared) expect(name, name).not.toMatch(/(Req|Res|DTO|Details)$/);
    expect(declared.sort()).toEqual(['AccountRecord', 'GoTrueGrant', 'GoTrueUser']);
  });
});
