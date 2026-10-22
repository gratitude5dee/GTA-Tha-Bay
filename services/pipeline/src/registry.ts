import type { GenAiRegistry, PromptBanned, PromptLintCtx } from '@dv/shared';
import raw from '../../../config/genai-endpoints.json';
import bannedRaw from '../../../config/prompt-banned.json';
import denylistRaw from '../../../config/ip-denylist.json';
import namesRaw from '../../../config/names.json';

/** config/genai-endpoints.json, typed. `check:assets` validates the file; the gate reads provider status from here. */
export const GENAI_REGISTRY = raw as unknown as GenAiRegistry;

/**
 * The public side of the prompt lint (M05b2, DL-550): the denylist, the banned lists and the display-side names of
 * `config/names.json`. The real-side names never live in the bundle; the gate reads them from the PRIVATE bucket (DL-240).
 */
export interface PromptLintConfig {
  denylist: PromptLintCtx['denylist'];
  banned: PromptBanned;
  displayNames: readonly string[];
}

export const PROMPT_LINT_CONFIG: PromptLintConfig = {
  denylist: denylistRaw as unknown as PromptLintCtx['denylist'],
  banned: bannedRaw as unknown as PromptBanned,
  displayNames: (namesRaw as { entries: { display?: string }[] }).entries.flatMap((e) => (typeof e.display === 'string' ? [e.display] : [])),
};
