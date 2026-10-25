/**
 * Pure NPC helpers of C10 (04-npc.md section 3). No IO: file reading, inkjs and network calls live in tools/soul.
 * `whereIs` and the intent cache key are M06c. `executor` and `safety-lists` are M06a3.
 */
export * from '../contracts/c10-npc.ts';
export * from '../contracts/c10-npc-builder.ts';
export { parseSoul, parseExampleLines, splitFrontmatter, SoulParseError, SECTION_ORDER, BACKSTORY_SECTION, normalizeNewlines } from './parse.ts';
export type { ParsedSoul, ExampleLine } from './parse.ts';
export {
  compileSoul, SoulCompileError, requiredSections, stripUserMarkup, railsList, deriveAssets, publicSoulHash, promptHash,
} from './compile.ts';
export type { RulesBlock, CompiledOutputs } from './compile.ts';
export {
  scheduleAt, dayIntervals, blockDays, weekdayOf, minuteOfDay, parseClock, formatClock, WEEKDAYS,
  HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_HOUR, HALF_SECONDS_PER_MINUTE, MINUTES_PER_DAY,
} from './schedule.ts';
export type { DayInterval } from './schedule.ts';
export { renderScene, sanitizePlayerText, PLAYER_TEXT_MAX } from './scene.ts';
export { scrubPii, findContactInfo, PII_PLACEHOLDER } from './pii.ts';
export { splitSentences } from './sentences.ts';
export { soulVersionProblem } from './version.ts';
export type { SoulHashes } from './version.ts';
export {
  validateSoul, validateRoster, validateRosterBundle, validateNpcTurn, validateNpcIntent, validateNpcSummary,
  validateDialogueRequest, validateVoiceCatalog, validateBarkPool, validateSoulLlm, formatIssue,
} from './validate.ts';
export type { SchemaIssue } from './validate.ts';
export {
  validateTurn, normalizeTurnJson, limitWords, wordCount, AFFINITY_MAX, MEMORY_WRITES_MAX, MEMORY_TEXT_MAX, WORD_SLACK,
} from './executor.ts';
export type { NpcTurnOutput, ExecutorSoul, ExecutorScene, TurnEffects, ValidatedTurn } from './executor.ts';
export { prefilterPlayerText, hasSlur, hasSelfHarm, SELF_HARM_PHRASES } from './safety-lists.ts';
export type { PrefilterResult, PrefilterVerdict } from './safety-lists.ts';
export { inkKnotFor, knotChain } from './knot.ts';
// M06a4: voice tier, mouth shapes and the memory rules.
export { VOICE_CATALOG, TTS_MICROS_PER_CHAR, TTS_MICROS_PER_CHAR_MAX, ttsMicros, pickVoice } from './voice-catalog.ts';
export { effectiveTier, minTier } from './voice-tier.ts';
export type { IdentityTier, VoiceSetting, VoiceTierInput } from './voice-tier.ts';
export {
  ATLAS_ORDER, ENVELOPE_THRESHOLDS, VOWEL_ALTERNATE_AT, atlasCell, cueAt, parseRhubarb, shapeFromEnvelope, shapesOf, visemesFromAlignment, vowelDensity,
} from './visemes.ts';
export type { Viseme, VisemeCue } from './visemes.ts';
export {
  MEMORY_DUPLICATE_COSINE, MEMORY_QUOTE_WORDS_MAX, PROMISE_IMPORTANCE_MIN, REFLECTION_EVERY, REFLECTION_IMPORTANCE, SUMMARY_DELTA_MAX, SUMMARY_MEMORIES_MAX,
  clampPatch, filterMemoryWrites, isReflectionEncounter, quotesPlayer,
} from './memory.ts';
export type { RawMemoryWrite, SummaryPatchX } from './memory.ts';
// M06c: where a named NPC is without a brain tick, and the intent cache key.
export { whereIs, pointAlong, elapsedInBlock } from './where.ts';
export type { Vec3, PoiPos, PedRouteFn, WhereIsResult } from './where.ts';
export { situationHash, normalizeSituation, intentCacheKey, bucketDistance, DISTANCE_BUCKET_M } from './situation-hash.ts';
// M06b1: the NPC builder's deterministic soul writer and its lints.
export { assembleSoul, writeSoulMd, deriveInk, cleanSectionText, exampleLinesText, BUILDER_SECTIONS } from './soul-write.ts';
export type { LlmSoul, BuilderServerFields, AssembledSoul } from './soul-write.ts';
export { lintBuilderSoul } from './builder-lint.ts';
export type { BuilderLintEnv, BuilderLintResult } from './builder-lint.ts';
