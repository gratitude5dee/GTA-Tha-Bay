import { describe, expect, it } from 'vitest';
import type { AccessClaims, IdentityService, IdentityState, PlayTokenClaims, PlayTokenReq, PlayTokenRes, ProviderId, Tier } from '../src/index.ts';

// Compile-time shape checks: the file fails typecheck if a C12 1.1 member drifts.
describe('C12 1.1 identity types', () => {
  it('IdentityState, PlayTokenClaims and the route 5 DTOs have the contract shape', () => {
    const tier: Tier = 'local';
    const state: IdentityState = { profileId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', tier, ageBracket: null, providers: [], deviceKeyThumbprint: 't' };
    const claims: PlayTokenClaims = { v: 1, pid: state.profileId, dkt: 't', age: '18p', iat: 1, exp: 1 + 86_400_000, kid: 'k1' };
    const req: PlayTokenReq = { pid: state.profileId, jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, ts: 1, sig: 's', age: '18p' };
    const res: PlayTokenRes = { token: 'pt1.a.b', exp: claims.exp };
    expect(Object.keys(claims).sort()).toEqual(['age', 'dkt', 'exp', 'iat', 'kid', 'pid', 'v']);
    expect(Object.keys(req).sort()).toEqual(['age', 'jwk', 'pid', 'sig', 'ts']);
    expect(Object.keys(res).sort()).toEqual(['exp', 'token']);
  });

  it('IdentityService has the 1.1 methods and ProviderId keeps password', () => {
    const methods: (keyof IdentityService)[] = ['current', 'authHeader', 'attestAge', 'register', 'link', 'unlink', 'signInOnNewDevice', 'forget', 'onChange'];
    expect(methods).toHaveLength(9);
    const providers: ProviderId[] = ['device', 'openai', 'thirdweb', 'supabase-oauth', 'password'];
    expect(providers).toContain('password');
    const access: Pick<AccessClaims, 'aud' | 'role'> = { aud: 'tha-bay', role: 'authenticated' };
    expect(access.aud).toBe('tha-bay');
  });
});
