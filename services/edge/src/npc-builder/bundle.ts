import data from '../generated/npc-builder-data.json' with { type: 'json' };

/**
 * The tables the NPC builder reads, bundled by `pnpm npc:edge-bundle` (a Worker cannot import `config/` or `content/`): the district place lists,
 * the goal catalog, the voices a user NPC may pick, the display names of the shipped souls, the prompts, and `config/npc.json#builder`.
 */
export interface BuilderData {
  config: {
    rulesVersion: number;
    moderation: { openai: 'on' | 'off'; openaiModel: string; classifierModel: string; llamaGuardModel: string };
    soul: { model: string; thinking: string; effort: string };
    preview: { model: string; maxTokens: number; voiceRef: string | null };
  };
  pois: Record<string, string[]>;
  goals: string[];
  voices: { voiceRef: string; tier: string }[];
  knownNames: Record<string, string>;
  prompts: { version: number; soul: string; repair: string; classifier: string; judge: string };
}

export const BUILDER = data as unknown as BuilderData;


/** `FixtureRequest.npcId` of the builder's own model calls (classifier, soul writer, judge); the intent names the call. */
export const BUILDER_FIXTURE_NPC = '_builder';
