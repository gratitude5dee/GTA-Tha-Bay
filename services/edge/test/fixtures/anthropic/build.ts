/**
 * Writes the .sse fixtures of the M06a3 suites:
 *
 *   pnpm exec tsx services/edge/test/fixtures/anthropic/build.ts
 *
 * No key was available when these were written, so they are synthetic: the event shapes follow the documented Messages stream and the
 * timing is chosen for the tests. A real recording replaces a file by hand without any change to the suites (same format, see
 * src/npc/upstream-fixture.ts). `hero-fallback-served.sse` stays synthetic until a real fallback-served stream is seen (U-NPC-13).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStream } from '../../../src/npc/upstream-fixture.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const turn = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  line: 'Good day. Please confirm the lot is clear.',
  emotion: 'neutral',
  gesture: 'nod',
  action: 'none',
  action_arg: null,
  affinity_delta: 0,
  memory_writes: [],
  end_conversation: false,
  ...over,
});

const files: Record<string, string> = {
  // Turn 1: the 1 h cache is written (block A and B), 180 fresh input tokens, 60 output tokens.
  'happy.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn(), inputTokens: 180, cacheWriteTokens: 1500, outputTokens: 60, firstDelayMs: 300, chunkDelayMs: 20 }),
  // Turn 2 and later: the prefix is read from the cache.
  'happy-cached.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn({ line: 'Noted. The forecast on the clipboard says clear.' }), inputTokens: 160, cacheReadTokens: 1500, outputTokens: 55, firstDelayMs: 300, chunkDelayMs: 20 }),
  'happy-effects.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: turn({
      line: 'Take the job. Do not be late.',
      emotion: 'proud',
      gesture: 'point',
      action: 'offer_mission',
      action_arg: 'm_first',
      affinity_delta: 25,
      memory_writes: [{ kind: 'promise', text: 'The player promised to be on time.', importance: 7 }],
    }),
    inputTokens: 170,
    cacheReadTokens: 1500,
    outputTokens: 70,
    firstDelayMs: 200,
    chunkDelayMs: 10,
  }),
  // The first text arrives at 5 s: past the 4 s rule.
  'slow-first-text.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn(), inputTokens: 180, cacheWriteTokens: 1500, firstDelayMs: 5000, chunkDelayMs: 20 }),
  // Slow but inside the window: the first text at 3 s.
  'slow-3s.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn(), inputTokens: 180, cacheWriteTokens: 1500, firstDelayMs: 3000, chunkDelayMs: 20 }),
  // The model declines: some text, then stop_reason refusal.
  'refusal.sse': buildStream({ model: 'claude-haiku-5-5', answer: '{"line":"I will not', stopReason: 'refusal', inputTokens: 180, cacheWriteTokens: 1500, outputTokens: 8, firstDelayMs: 200, chunkDelayMs: 10 }),
  // Valid JSON that breaks the schema (affinity_delta is a string, memory_writes missing).
  'invalid-json.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: '{"line":"Good day.","emotion":"neutral","gesture":"nod","action":"none","action_arg":null,"affinity_delta":"lots","end_conversation":false}',
    inputTokens: 180,
    cacheWriteTokens: 1500,
    outputTokens: 40,
    firstDelayMs: 200,
    chunkDelayMs: 10,
  }),
  // Cut off by max_tokens in the middle of the object.
  'max-tokens.sse': buildStream({ model: 'claude-haiku-5-5', answer: '{"line":"Good day. Please confirm the lot', stopReason: 'max_tokens', inputTokens: 180, cacheWriteTokens: 1500, outputTokens: 512, firstDelayMs: 200, chunkDelayMs: 10 }),
  // A line that names someone from the name-registry fixture of the suites.
  'name-hit.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn({ line: 'Ask Quentin Zabriskie about it, he knows.' }), inputTokens: 180, cacheWriteTokens: 1500, outputTokens: 50, firstDelayMs: 200, chunkDelayMs: 10 }),
  // A line far over the word limit of npc_test (16 words + 5).
  'long-line.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: turn({ line: `${Array.from({ length: 12 }, () => 'alpha').join(' ')}. ${Array.from({ length: 14 }, () => 'bravo').join(' ')}. ${Array.from({ length: 8 }, () => 'charlie').join(' ')}.` }),
    inputTokens: 180,
    cacheWriteTokens: 1500,
    outputTokens: 80,
    firstDelayMs: 100,
    chunkDelayMs: 5,
  }),
  // A hero turn served by a model that is not in F-034 (the server-side fallback, U-NPC-13).
  'hero-fallback-served.sse': buildStream({ model: 'claude-fallback-served-1', answer: turn({ line: 'Hear me out, then decide.' }), inputTokens: 300, cacheReadTokens: 1500, outputTokens: 80, firstDelayMs: 200, chunkDelayMs: 10 }),
  // A hero turn served by Sonnet 5.5 itself.
  'hero-sonnet.sse': buildStream({ model: 'claude-sonnet-5-5', answer: turn({ line: 'Hear me out, then decide.' }), inputTokens: 300, cacheReadTokens: 1500, outputTokens: 80, firstDelayMs: 200, chunkDelayMs: 10 }),
  // HTTP errors.
  'error-429.sse': ': delay 50\n: status 429\n: retry-after 1\n',
  'error-429-long.sse': ': status 429\n: retry-after 9\n',
  'error-529.sse': ': delay 50\n: status 529\n: retry-after 1\n',
  'error-400-spend-limit.sse': ': status 400\n: spend-limit\n',
  // The turn that ends the conversation.
  'end-conversation.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn({ line: 'Checklist complete. Good day.', end_conversation: true }), inputTokens: 160, cacheReadTokens: 1500, outputTokens: 45, firstDelayMs: 100, chunkDelayMs: 5 }),
  // Chunked in the middle of an escape and of a surrogate pair.
  'escapes.sse': buildStream({ model: 'claude-haiku-5-5', answer: turn({ line: 'Say "hello" \\ there\nsecond line \u{1f600} done.' }), inputTokens: 180, cacheWriteTokens: 1500, outputTokens: 50, chunk: 3, firstDelayMs: 100, chunkDelayMs: 5 }),
  // M06a4: encounter summaries (npc-summary-1.0). No delays, so the suites need no virtual clock.
  'summary-happy.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: {
      summaryUpdate: 'The player came by the lot twice and kept a promise about the car.',
      memories: [
        { kind: 'promise', text: 'The player promised to return the car by Friday.', importance: 3, gameTime: 0, source: 'summary' },
        { kind: 'preference', text: 'The player likes the red car.', importance: 4, gameTime: 0, source: 'summary' },
      ],
      affinityDelta: 4,
      trustDelta: 3,
      flagsPatch: { met_at_lot: true },
      reflection: false,
    },
    inputTokens: 900,
    outputTokens: 150,
  }),
  // Deltas far outside +-10, six memories, and a reflection-kind memory on an encounter that is not a reflection one.
  'summary-extreme.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: {
      summaryUpdate: 'The player was a great help and the character trusts them completely now.',
      memories: [
        { kind: 'reflection', text: 'The character thinks the player is the best thing to happen to the lot.', importance: 9, gameTime: 0, source: 'summary' },
        { kind: 'event', text: 'The player asked about the lot.', importance: 5, gameTime: 0, source: 'summary' },
      ],
      affinityDelta: 40,
      trustDelta: -25,
      flagsPatch: {},
      reflection: true,
    },
    inputTokens: 900,
    outputTokens: 150,
  }),
  // The 10th encounter of a pair: one reflection memory (the consumer sets importance 8 whatever the model says).
  'summary-reflection.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: {
      summaryUpdate: 'Ten talks in, the player is a regular at the lot.',
      memories: [
        { kind: 'reflection', text: 'The character has come to see the player as a regular and a friend.', importance: 5, gameTime: 0, source: 'summary' },
        { kind: 'event', text: 'The player asked about the lot.', importance: 5, gameTime: 0, source: 'summary' },
      ],
      affinityDelta: 2,
      trustDelta: 2,
      flagsPatch: {},
      reflection: true,
    },
    inputTokens: 900,
    outputTokens: 160,
  }),
  // The second call when the notes would pass 1,200 characters.
  'summary-compress.sse': buildStream({ model: 'claude-haiku-5-5', answer: { summary: 'A regular at the lot who keeps promises and likes the red car.' }, inputTokens: 700, outputTokens: 30 }),
  // A summary that is long enough to push a near-full relationship past 1,200 characters.
  'summary-wordy.sse': buildStream({
    model: 'claude-haiku-5-5',
    answer: {
      summaryUpdate: `${'The player stayed to talk about the lot and the weather. '.repeat(10)}`.trim(),
      memories: [],
      affinityDelta: 1,
      trustDelta: 1,
      flagsPatch: {},
      reflection: false,
    },
    inputTokens: 900,
    outputTokens: 200,
  }),
};

for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
console.log(`wrote ${Object.keys(files).length} fixtures to ${dir}`);
