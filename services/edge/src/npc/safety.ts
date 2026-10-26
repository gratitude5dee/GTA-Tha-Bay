import { compileRealNames, type NameEntry, type RealNameMatcher } from '@dv/shared';
import type { CompiledSoul } from '@dv/shared/contracts/c10-npc';
import { prefilterPlayerText, type PrefilterResult } from '@dv/shared/npc';
import { now } from '../clock.ts';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';

/**
 * SafetyFilter (04-npc.md section 5.4).
 *
 *  - `pre`: the input prefilter. NFC, controls and tags stripped, contact data removed and flagged, slur list, self-harm list. The lists
 *    are the shared ones (packages/shared/src/npc/safety-lists.ts) so the client can use them too.
 *  - `outputNameHit`: the NameRegistry check of the model's `line` (real names and aliases fail unless the soul is `consented` with
 *    scope `name` for that subject). The real-side list never enters the repository (R-NAME-1): it is the PRIVATE object `names/real.json`
 *    (`{"schema":"names/1","entries":[{"id","real","aliases"}]}`), put there by the operator, read through a 60 s isolate cache. Absent: no check.
 *  - `moderation`: the asynchronous moderation of player text (OpenAI omni-moderation, Llama Guard fallback; M06b1, npc-builder/chat-moderation.ts).
 *    It may call `flagCrisis`, which sets `pendingSafety` on the encounter so the next turn's `meta` carries `safety: 'crisis'` (C10 1.1, DL-226),
 *    and it ends the encounter and opens a P0 CSAM-text case when the player's text crosses the thresholds.
 */
export const preFilter = (text: string | undefined): PrefilterResult => prefilterPlayerText(text);

const REGISTRY_TTL_MS = 60_000;
let registry: { at: number; entries: readonly NameEntry[]; matchers: RealNameMatcher[] } | null = null;
let registryOverride: readonly NameEntry[] | null = null;

/** Test seam: the real-side entries (null restores the PRIVATE read). */
export function setNameRegistryForTests(entries: readonly NameEntry[] | null): void {
  registryOverride = entries;
  registry = null;
}

async function realMatchers(env: Pick<Env, 'PRIVATE'>): Promise<{ entries: readonly NameEntry[]; matchers: RealNameMatcher[] }> {
  if (registryOverride !== null) return { entries: registryOverride, matchers: compileRealNames(registryOverride) };
  const t = now();
  if (registry !== null && t - registry.at < REGISTRY_TTL_MS && t >= registry.at) return registry;
  let entries: readonly NameEntry[] = [];
  const obj = await env.PRIVATE.get('names/real.json');
  if (obj !== null) {
    const doc = JSON.parse(await obj.text()) as { entries?: NameEntry[] };
    entries = Array.isArray(doc.entries) ? doc.entries : [];
  }
  registry = { at: t, entries, matchers: compileRealNames(entries) };
  return registry;
}

/** The real-side entries (PRIVATE `names/real.json`, 60 s isolate cache); empty when the object is absent. The NPC builder lints with them (M06b1). */
export async function loadRealNames(env: Pick<Env, 'PRIVATE'>): Promise<readonly NameEntry[]> {
  return (await realMatchers(env)).entries;
}

/** True when `line` holds a real-side name or alias that this soul may not say. */
export async function outputNameHit(env: Pick<Env, 'PRIVATE'>, line: string, soul: Pick<CompiledSoul, 'tier' | 'likeness'>): Promise<boolean> {
  const { entries, matchers } = await realMatchers(env);
  if (matchers.length === 0) return false;
  const consented =
    soul.tier === 'consented' && soul.likeness.basis === 'real_person' && soul.likeness.consentScopes.includes('name') && soul.likeness.subjectId !== null;
  const allowedId = consented ? soul.likeness.subjectId : null;
  const allowed = new Set(entries.filter((e) => e.id === allowedId).map((e) => e.id));
  return matchers.some((m) => !allowed.has(m.id) && m.re.test(line));
}

export interface ModerationInput {
  npcId: string;
  /** The player's text after the prefilter (contact data removed). Never log it. */
  text: string;
  /** Sets `pendingSafety` on the encounter. */
  flagCrisis(): Promise<void>;
  /** M06b1: what the asynchronous check needs to open a case and end the encounter. */
  env?: Env;
  profileId?: string;
  encounterId?: string;
  turnIndex?: number;
  /** Ends the encounter (EncounterDO.close). */
  closeEncounter?(): Promise<void>;
}

export interface Moderation {
  check(deps: Pick<AppDeps, 'logOnce' | 'log' | 'data'>, input: ModerationInput): Promise<void>;
}

/** The asynchronous moderation of player text (M06b1): OpenAI omni-moderation with Llama Guard as the fallback, in npc-builder/chat-moderation.ts. */
export const defaultModeration: Moderation = {
  async check(deps, input) {
    const { moderatePlayerText } = await import('../npc-builder/chat-moderation.ts');
    await moderatePlayerText(deps, input);
  },
};

let moderationImpl: Moderation = defaultModeration;

export const moderation: Moderation = {
  check: (deps, input) => moderationImpl.check(deps, input),
};

/** Test seam, and the hook M06b1 uses: replaces the asynchronous moderation (null restores the logging default). */
export function setModerationForTests(m: Moderation | null): void {
  moderationImpl = m ?? defaultModeration;
}
