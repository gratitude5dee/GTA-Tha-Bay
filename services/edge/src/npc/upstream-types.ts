/** Types and the error class shared by the live upstream, the fixture upstream and the route (kept apart to avoid an import cycle). */
import type { FixtureRequest } from './upstream-fixture.ts';

/** One event of the Anthropic message stream, as the API sends it (`message_start`, `content_block_delta`, ...). */
export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/** An answer that is not a stream: an HTTP error status, or an `error` event inside the stream (mapped to 529). */
export class UpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  /** HTTP 400 `enforced_spend_limit_reached` or the workspace spend limit: never retried. */
  readonly spendLimit: boolean;
  constructor(status: number, message: string, opts: { retryAfterMs?: number; spendLimit?: boolean } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryAfterMs = opts.retryAfterMs;
    this.spendLimit = opts.spendLimit ?? false;
  }
}

/** The request as the route builds it. `body` is the JSON body without `stream`; `betas` become the `anthropic-beta` header. */
export interface UpstreamCall {
  body: Record<string, unknown>;
  betas: readonly string[];
  /** Extra request headers (`cf-aig-metadata`, `cf-aig-collect-log-payload`). */
  headers: Record<string, string>;
}

export interface Upstream {
  readonly mode: 'live' | 'fixture';
  /** Streams the answer. Rejects with UpstreamError for an HTTP error; stops when `signal` aborts. */
  stream(call: UpstreamCall, signal: AbortSignal, fixture: FixtureRequest): AsyncIterable<StreamEvent>;
}

/** Time source of the route: timers for the fixture pacing, the 4 s window and the retry; `now` for the window arithmetic. */
export interface Timing {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realTiming: Timing = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

