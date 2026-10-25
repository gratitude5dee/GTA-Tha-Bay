import { compileRealNames, compileStringMatcher, type IpDenylistConfig, type NameEntry, type RealNameMatcher } from '@dv/shared';
import type { BuilderLintEnv } from '@dv/shared/npc';
import denylist from '../../../../config/ip-denylist.json' with { type: 'json' };
import type { Env } from '../env.ts';
import { loadRealNames } from '../npc/safety.ts';

export { BUILDER, type BuilderData } from './bundle.ts';
import { BUILDER } from './bundle.ts';

export const districtPois = (district: string): readonly string[] | null => BUILDER.pois[district] ?? null;
export const districts = (): string[] => Object.keys(BUILDER.pois);
export const voiceAllowed = (ref: string | null): boolean => ref === null || BUILDER.voices.some((v) => v.voiceRef === ref && v.tier === 't1');

const strings = compileStringMatcher(denylist as unknown as IpDenylistConfig);

/** The lint tables for one district. The real-side names come from PRIVATE `names/real.json` (absent: none). */
export async function lintEnvFor(env: Pick<Env, 'PRIVATE'>, district: string): Promise<BuilderLintEnv> {
  const { matchers } = await realNameMatchers(env);
  return {
    pois: new Set(districtPois(district) ?? []),
    goals: new Set(BUILDER.goals),
    knownNames: new Map(Object.entries(BUILDER.knownNames)),
    realMatchers: matchers,
    strings,
  };
}

/** Compiled real-side matchers (60 s isolate cache in safety.ts). */
export async function realNameMatchers(env: Pick<Env, 'PRIVATE'>): Promise<{ entries: readonly NameEntry[]; matchers: RealNameMatcher[] }> {
  const entries = await loadRealNames(env);
  return { entries, matchers: compileRealNames(entries) };
}
