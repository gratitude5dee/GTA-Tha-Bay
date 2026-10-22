import { lk } from '../i18n/index.ts';
import type { GateCtx, GateResult, GateSpec, IdentityTier } from './types.ts';

const TIER_RANK: Record<IdentityTier, number> = { local: 0, device: 1, linked: 2 };

/**
 * Evaluates one page gate (10-ui.md section 2.5, "Gate results"). Order: a false flag or a blocked region hides, a missing
 * attestation hides, then offline and a tier that is too low disable with a reason (a tier gate carries a call to action, never a
 * dead end).
 */
export function evaluateGate(spec: GateSpec, ctx: GateCtx): GateResult {
  // An absent flag (BootConfig not fetched yet, or a flag this build does not know) does not hide: only an explicit false does.
  if (spec.flag !== undefined && ctx.flags[spec.flag] === false) return { state: 'hidden' };
  if (spec.regionSensitive === true && ctx.region === 'blocked') return { state: 'hidden' };
  if (spec.attested === true && !ctx.attested) return { state: 'hidden' };
  if (spec.online === true && !ctx.online) return { state: 'disabled', reason: lk('gate.offline') };
  if (spec.tier !== undefined && TIER_RANK[ctx.identity.tier] < TIER_RANK[spec.tier]) {
    return {
      state: 'disabled',
      reason: spec.tier === 'linked' ? lk('gate.tier.linked') : lk('gate.tier.device'),
      cta: { label: spec.tier === 'linked' ? lk('gate.cta.link') : lk('gate.cta.register'), to: { href: '/account/' } },
    };
  }
  return { state: 'open' };
}

/** A gate function for a `PageDef`. */
export const gateOf = (spec: GateSpec) => (ctx: GateCtx): GateResult => evaluateGate(spec, ctx);

export function defaultGateCtx(): GateCtx {
  return {
    flags: {},
    region: 'ok',
    identity: { tier: 'local' },
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    unlocks: new Set<string>(),
    attested: false,
    profile: null,
    headset: null,
  };
}
