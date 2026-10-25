import { builderDefaultFixture } from '../npc-builder/fixture-defaults.ts';
import { UpstreamError, type StreamEvent, type Timing, type Upstream } from './upstream-types.ts';

/**
 * The fixture upstream (M06a3): replays recorded Anthropic streams so every path of the dialogue route runs without a key.
 *
 * File format (`services/edge/test/fixtures/anthropic/<name>.sse`): the standard SSE framing of the Messages stream (`event:` and `data:`
 * lines, a blank line after each event) plus comment lines that carry the timing and the transport facts:
 *   `: delay <ms>`        wait this long before the next event (relative to the previous event)
 *   `: status <code>`     answer with this HTTP status instead of a stream (429, 529, 400, ...)
 *   `: retry-after <s>`   the Retry-After header of that error
 *   `: spend-limit`       the error is the workspace spend limit (HTTP 400, never retried)
 * No key material, prompt or player text is ever in a fixture. The files in this repository were written by hand from the documented
 * event shapes (no key was available to record real streams), so they are synthetic; `hero-fallback-served.sse` is synthetic by
 * design until a real fallback-served stream is seen (U-NPC-13).
 */
export interface FixtureRequest {
  npcId: string;
  intent: string;
  turnIndex: number;
  model: string;
  hero: boolean;
}

interface Step {
  delayMs: number;
  event: StreamEvent;
}

export interface ParsedFixture {
  status: number | null;
  retryAfterMs: number | undefined;
  spendLimit: boolean;
  /** Delay before the error answer, from a `: delay` line ahead of the status line. */
  errorDelayMs: number;
  steps: Step[];
}

export function parseFixture(text: string): ParsedFixture {
  const out: ParsedFixture = { status: null, retryAfterMs: undefined, spendLimit: false, errorDelayMs: 0, steps: [] };
  let delay = 0;
  let data: string[] = [];
  const flush = (): void => {
    if (data.length === 0) return;
    out.steps.push({ delayMs: delay, event: JSON.parse(data.join('\n')) as StreamEvent });
    delay = 0;
    data = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '') {
      flush();
    } else if (line.startsWith(':')) {
      const m = /^:\s*(delay|status|retry-after|spend-limit)\s*(\d+(?:\.\d+)?)?\s*$/.exec(line);
      if (m === null) continue;
      const n = m[2] === undefined ? 0 : Number(m[2]);
      if (m[1] === 'delay') delay = n;
      else if (m[1] === 'status') {
        out.status = n;
        out.errorDelayMs = delay;
        delay = 0;
      } else if (m[1] === 'retry-after') out.retryAfterMs = Math.round(n * 1000);
      else out.spendLimit = true;
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  flush();
  return out;
}

function sleep(timing: Timing, ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      timing.clearTimeout(handle);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const handle = timing.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Replays a parsed fixture with its pacing. An error fixture rejects with UpstreamError before any event. */
export async function* replay(parsed: ParsedFixture, timing: Timing, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  if (parsed.status !== null) {
    await sleep(timing, parsed.errorDelayMs, signal);
    throw new UpstreamError(parsed.status, `fixture status ${parsed.status}`, {
      ...(parsed.retryAfterMs === undefined ? {} : { retryAfterMs: parsed.retryAfterMs }),
      spendLimit: parsed.spendLimit,
    });
  }
  for (const step of parsed.steps) {
    await sleep(timing, step.delayMs, signal);
    yield step.event;
  }
}

// ---- building a stream (used for the default preview answer and to write the fixture files) ----

export interface StreamSpec {
  model: string;
  /** The JSON object of the answer (npc-turn-1.0), or raw text to send as it is. */
  answer: Record<string, unknown> | string;
  inputTokens?: number;
  cacheReadTokens?: number;
  /** Written to the 1 h cache (block A and B on the first turn). */
  cacheWriteTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  /** Characters per text delta. */
  chunk?: number;
  /** Delay before the first delta and between deltas, ms. */
  firstDelayMs?: number;
  chunkDelayMs?: number;
}

const sse = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The SSE text of one Messages stream. */
export function buildStream(spec: StreamSpec): string {
  const text = typeof spec.answer === 'string' ? spec.answer : JSON.stringify(spec.answer);
  const chunk = Math.max(1, spec.chunk ?? 14);
  const write = spec.cacheWriteTokens ?? 0;
  let out = sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: spec.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: spec.inputTokens ?? 180,
        cache_creation_input_tokens: write,
        cache_read_input_tokens: spec.cacheReadTokens ?? 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
        output_tokens: 1,
      },
    },
  });
  out += sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  let first = true;
  for (let i = 0; i < text.length; i += chunk) {
    const delay = first ? (spec.firstDelayMs ?? 0) : (spec.chunkDelayMs ?? 0);
    first = false;
    if (delay > 0) out += `: delay ${delay}\n`;
    out += sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + chunk) } });
  }
  out += sse('content_block_stop', { type: 'content_block_stop', index: 0 });
  out += sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: spec.stopReason ?? 'end_turn', stop_sequence: null },
    usage: { output_tokens: spec.outputTokens ?? Math.max(1, Math.ceil(text.length / 4)) },
  });
  out += sse('message_stop', { type: 'message_stop' });
  return out;
}

// ---- the default answer of fixture mode (previews, local runs) ----

const LINES: Record<string, string> = {
  greet: 'Good day. Please confirm the lot is clear.',
  smalltalk: 'Noted. The forecast on the clipboard says clear.',
  farewell: 'Checklist complete. Good day.',
  compliment: 'Noted. Compliments are logged under item four.',
  insult: 'That is outside the script. Next line of the checklist.',
  threaten: 'Please keep the lot clear. This is a recorded reply.',
  ask_mission: 'No missions on my checklist today. Check the board.',
};
const TEXT_LINE = 'Copy that. This answer is a recorded fixture, not a live model.';

/** The recorded-style stream a Worker in fixture mode answers with when no test chose another one. */
export function defaultFixtureText(req: FixtureRequest): string {
  // M06b1: the NPC builder's own calls and the replies of user NPCs (npc-builder/fixture-defaults.ts).
  const builder = builderDefaultFixture(req);
  if (builder !== null) return builder;
  // M06a4: the summarize consumer asks with intent `summary` (npc-summary-1.0) and `summary-compress` ({ summary }).
  if (req.intent === 'summary') {
    return buildStream({
      model: req.model,
      answer: {
        summaryUpdate: 'They talked at the lot. The player was polite and the character noted it.',
        memories: [{ kind: 'event', text: 'The player stopped by the lot and was polite.', importance: 3, gameTime: 0, source: 'summary' }],
        affinityDelta: 1,
        trustDelta: 1,
        flagsPatch: {},
        reflection: false,
      },
      inputTokens: 900,
      outputTokens: 120,
    });
  }
  if (req.intent === 'summary-compress') {
    return buildStream({ model: req.model, answer: { summary: 'The player has visited the lot several times and is polite and reliable.' }, inputTokens: 600, outputTokens: 40 });
  }
  const first = req.turnIndex === 0;
  return buildStream({
    model: req.model,
    answer: {
      line: LINES[req.intent] ?? TEXT_LINE,
      emotion: 'neutral',
      gesture: req.intent === 'greet' ? 'wave' : 'nod',
      action: 'none',
      action_arg: null,
      affinity_delta: req.intent === 'compliment' ? 1 : 0,
      memory_writes: [],
      end_conversation: req.intent === 'farewell',
    },
    inputTokens: 220,
    cacheWriteTokens: first ? 1500 : 0,
    cacheReadTokens: first ? 0 : 1500,
    outputTokens: 60,
    firstDelayMs: 350,
    chunkDelayMs: 40,
  });
}

let fixtureSource: ((req: FixtureRequest) => string) | null = null;

/** Test seam: chooses the fixture text per request (null restores the default answer). */
export function setFixtureSourceForTests(fn: ((req: FixtureRequest) => string) | null): void {
  fixtureSource = fn;
}

export function fixtureUpstream(timing: Timing): Upstream {
  return {
    mode: 'fixture',
    stream(_call, signal, req) {
      const text = (fixtureSource ?? defaultFixtureText)(req);
      return replay(parseFixture(text), timing, signal);
    },
  };
}
