import type { Env } from '../env.ts';
import { fixtureUpstream } from './upstream-fixture.ts';
import { realTiming, UpstreamError, type StreamEvent, type Timing, type Upstream } from './upstream-types.ts';

export { realTiming, UpstreamError };
export type { StreamEvent, Timing, Upstream, UpstreamCall } from './upstream-types.ts';

/**
 * The model call of the dialogue route (M06a3). One interface, two implementations:
 *  - `live`: `@anthropic-ai/sdk` in the Worker, `baseURL = AIG_BASE` when set, else the Anthropic API (U-NPC-02 fallback). Retries are off
 *    in the SDK (`maxRetries: 0`); the route owns the single retry that fits the 4 s window.
 *  - `fixture`: replays a recorded stream (upstream-fixture.ts). This is the default wherever `ANTHROPIC_MODE` is not `live`.
 * The SDK is imported on first use, so a fixture-only run never loads it.
 */

let override: Upstream | null = null;
let timingOverride: Timing | null = null;

/** Test seam: replaces the upstream (null restores the mode-based choice). */
export function setUpstreamForTests(u: Upstream | null): void {
  override = u;
}

/** Test seam: replaces the timers of the route (null restores the real ones). */
export function setTimingForTests(t: Timing | null): void {
  timingOverride = t;
}

export const currentTiming = (): Timing => timingOverride ?? realTiming;

/** `live` only when the variable says so; absent or any other value replays fixtures (the safe default for previews and local runs). */
export function anthropicMode(env: Pick<Env, 'ANTHROPIC_MODE'>): 'live' | 'fixture' {
  return env.ANTHROPIC_MODE === 'live' ? 'live' : 'fixture';
}

/** The upstream for this request, or null when live mode has no key (the route answers `upstream_unavailable`). */
export function selectUpstream(env: Pick<Env, 'ANTHROPIC_MODE' | 'ANTHROPIC_API_KEY' | 'AIG_BASE'>): Upstream | null {
  if (override !== null) return override;
  if (anthropicMode(env) === 'fixture') return fixtureUpstream(currentTiming());
  const key = env.ANTHROPIC_API_KEY;
  if (key === undefined || key === '') return null;
  return liveUpstream(key, env.AIG_BASE);
}

interface ErrorLike {
  status?: unknown;
  message?: unknown;
  headers?: { get?: (name: string) => string | null } | null;
  error?: { error?: { type?: unknown; message?: unknown } } | null;
}

/** Maps an SDK error to UpstreamError; an abort is passed through unchanged. */
export function toUpstreamError(e: unknown): unknown {
  if (e instanceof UpstreamError) return e;
  const x = e as ErrorLike;
  if (typeof x?.status !== 'number') return e;
  const retryHeader = x.headers?.get?.('retry-after') ?? null;
  const retryS = retryHeader === null ? NaN : Number(retryHeader);
  const text = `${typeof x.message === 'string' ? x.message : ''} ${typeof x.error?.error?.message === 'string' ? x.error.error.message : ''}`;
  const spendLimit = x.status === 400 && /spend[ _]?limit|enforced_spend_limit_reached/i.test(text);
  return new UpstreamError(x.status, `upstream status ${x.status}`, {
    ...(Number.isFinite(retryS) ? { retryAfterMs: Math.max(0, Math.round(retryS * 1000)) } : {}),
    spendLimit,
  });
}

function liveUpstream(apiKey: string, baseURL: string | undefined): Upstream {
  return {
    mode: 'live',
    async *stream(call, signal) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000, ...(baseURL !== undefined && baseURL !== '' ? { baseURL } : {}) });
      const body = { ...call.body, stream: true };
      try {
        const stream =
          call.betas.length > 0
            ? await client.beta.messages.create({ ...body, betas: [...call.betas] } as never, { signal, headers: call.headers })
            : await client.messages.create(body as never, { signal, headers: call.headers });
        for await (const ev of stream as unknown as AsyncIterable<StreamEvent>) {
          if (ev.type === 'error') {
            const err = (ev as { error?: { type?: string } }).error;
            throw new UpstreamError(err?.type === 'rate_limit_error' ? 429 : 529, 'error event in stream');
          }
          yield ev;
        }
      } catch (e) {
        throw toUpstreamError(e);
      }
    },
  };
}
