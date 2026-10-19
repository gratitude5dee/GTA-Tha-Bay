/**
 * Pure NPC helpers of C10 (04-npc.md section 3). No IO: file reading, inkjs and network calls live in tools/soul.
 * `whereIs` lands in M06c; `executor` and `safety-lists` in M06a3.
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
  validateDialogueRequest, validateVoiceCatalog, validateBarkPool, formatIssue,
} from './validate.ts';
export type { SchemaIssue } from './validate.ts';
