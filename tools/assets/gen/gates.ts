/**
 * The three gates that run before a prewarm may spend (M05c3): the provider gate (ADR-GENAI-01), the sheet gate and the C2PA guard.
 * Pure over their inputs; the CLI feeds them files and, for the C2PA guard, the Worker configuration.
 */
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry, VideoProviderEntry } from '../../../packages/shared/src/genai/registry.ts';
import { selectProvider } from '../cutscene-index/build.ts';

export const NO_PROVIDER_LINE = 'blocked: no cleared provider (ADR-GENAI-01)';
/** Workers Free has no transcoder, so a live job would pay fal and then fail at `transcode` (DL-OWN-08, DL-750). */
export const NO_TRANSCODER_LINE = 'blocked: no transcoder on Workers Free; lands in M05c4';

export type ProviderGate = { ok: true; key: string; entry: VideoProviderEntry } | { ok: false; line: string };

/**
 * The provider the registry rule picks (`defaults.videoProvider`, then the fallback order; a blocked entry is never usable),
 * and only when it is `cleared`. A `pending` provider is previs only and never receives a prewarm.
 */
export function providerGate(reg: Pick<GenAiRegistry, 'videoProviders' | 'defaults'>): ProviderGate {
  const pick = selectProvider(reg);
  if (pick === null || !pick.cleared) return { ok: false, line: NO_PROVIDER_LINE };
  return { ok: true, key: pick.key, entry: pick.entry };
}

/** The approved-sheets lock of the PRIVATE `sheets/<slug>/` prefix: one entry per character slug (soul id). */
export interface SheetsLock {
  schema: 'sheets-lock/1';
  sheets: Record<string, { approved: boolean; crops: string[] }>;
}

export const EMPTY_SHEETS: SheetsLock = { schema: 'sheets-lock/1', sheets: {} };

/** Characters of a request that have no approved sheet with at least one crop. Empty when the request names no character. */
export function missingSheets(request: Pick<CutsceneRequest, 'characters'>, lock: SheetsLock): string[] {
  return request.characters.map((c) => c.id).filter((id) => {
    const s = lock.sheets[id];
    return s === undefined || s.approved !== true || s.crops.length === 0;
  });
}

export function parseSheetsLock(text: string): SheetsLock {
  const raw = JSON.parse(text) as Partial<SheetsLock>;
  if (raw.schema !== 'sheets-lock/1' || typeof raw.sheets !== 'object' || raw.sheets === null) throw new Error('sheets lock: schema must be sheets-lock/1 with a sheets object');
  return raw as SheetsLock;
}

/** The request's endpoint (before `@pin`) belongs to the provider that would be paid; otherwise the index was built for another provider. */
export function endpointMatches(request: Pick<CutsceneRequest, 'keyInput'>, provider: Pick<VideoProviderEntry, 'endpoints'>): boolean {
  const id = request.keyInput.endpoint.replace(/@.*$/, '');
  return Object.values(provider.endpoints).includes(id);
}

/** What the C2PA guard needs: whether the Worker build for the target environment has re-signing on. */
export interface ResignProbe {
  /** `true`: on, `false`: off, `null`: not determinable. */
  resignOn(env: 'staging' | 'prod'): Promise<boolean | null>;
}

export type ResignVerdict = { ok: true } | { ok: false; line: string };

/** Production runs need `C2PA_RESIGN=1` in the Worker build (ADR-GENAI-01 G4); other environments are not guarded. */
export async function resignGuard(env: 'staging' | 'prod', live: boolean, probe: ResignProbe): Promise<ResignVerdict> {
  if (!live || env !== 'prod') return { ok: true };
  const on = await probe.resignOn(env);
  if (on === true) return { ok: true };
  return { ok: false, line: `refused: C2PA_RESIGN is ${on === false ? 'off' : 'not set'} in the prod Worker build; renditions would ship without our C2PA claim (ADR-GENAI-01 G4)` };
}
