import type { ApiError, ApiErrorCode } from '@dv/shared';
import type { DialogueEvent, FallbackReason, InkKnot, ModelTier, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import { inkKnotFor } from '@dv/shared/npc';
import { SseParser, toDialogueEvent } from './sse.ts';

/**
 * DialogueClient (04-npc.md section 5.1, Client): POSTs a turn to route 31 and reads the answer as a stream with `fetch` (not
 * `EventSource`, which cannot POST). Every event goes to `on` as it arrives, so text is shown while the rest is still coming.
 * The result says how the turn ended; it never throws for a network or server failure, because every failure means "play ink"
 * (C12 client rule). Only an abort by the caller is reported as such.
 */
export const OFFLINE_CODES: readonly ApiErrorCode[] = ['quota_exhausted', 'budget_offline', 'kill_switched', 'upstream_unavailable'];

export interface DialogueClientOptions {
  /** Origin of the API (`BootConfig.hosts.api`); empty for the page's own origin. */
  apiBase?: string;
  fetch?: typeof fetch;
  /** The play-token header, or null when the player has none (offline, under 18): the turn then goes straight to ink. */
  auth: () => Promise<{ Authorization: string } | null>;
  /** Milliseconds, monotonic; default `performance.now`. */
  now?: () => number;
  /** Sees the response of each talk request before its body is read. */
  onResponse?: (res: Response) => void;
}

export type TalkEnd =
  /** `done` arrived. */
  | { kind: 'done'; encounterId: string | null; closed: boolean; turnsLeft: number; model: ModelTier | null; ttftMs: number }
  /** The server sent `fallback`, or the stream broke after it began (`midStream`): the caller plays ink from `knot`. */
  | { kind: 'fallback'; encounterId: string | null; reason: FallbackReason; knot: InkKnot; ttftMs: number; midStream: boolean }
  /** No stream: the player has no token, the request failed, or the Worker answered an `ApiError`. */
  | { kind: 'refused'; code: ApiErrorCode | 'network' | 'no_auth'; status: number; retryAfterMs?: number; details?: Record<string, unknown> }
  /** The caller aborted. */
  | { kind: 'aborted' };

const isAbort = (e: unknown, signal: AbortSignal | undefined): boolean => signal?.aborted === true || (e instanceof DOMException && e.name === 'AbortError');

export class DialogueClient {
  private readonly o: DialogueClientOptions;

  constructor(options: DialogueClientOptions) {
    this.o = options;
  }

  private now(): number {
    return (this.o.now ?? (() => performance.now()))();
  }

  async talk(npcId: string, req: NPCDialogueRequest, on: (e: DialogueEvent) => void, signal?: AbortSignal): Promise<TalkEnd> {
    const auth = await this.o.auth().catch(() => null);
    if (auth === null) return { kind: 'refused', code: 'no_auth', status: 0 };
    const started = this.now();
    const doFetch = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.o.apiBase ?? ''}/api/v1/npc/${encodeURIComponent(npcId)}/talk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...auth },
        body: JSON.stringify(req),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (e) {
      return isAbort(e, signal) ? { kind: 'aborted' } : { kind: 'refused', code: 'network', status: 0 };
    }
    this.o.onResponse?.(res);
    if (!res.ok || res.body === null || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) return this.refusal(res);

    const knot = inkKnotFor(req.context, req.turn.intent);
    const parser = new SseParser();
    const decoder = new TextDecoder();
    let encounterId: string | null = null;
    let model: ModelTier | null = null;
    let ttftMs = -1;
    let fallback: Extract<DialogueEvent, { event: 'fallback' }> | null = null;
    let done: Extract<DialogueEvent, { event: 'done' }> | null = null;
    const handle = (e: DialogueEvent): void => {
      if (e.event === 'meta') {
        encounterId = e.data.encounterId;
        model = e.data.model;
      } else if (e.event === 'line.delta' && ttftMs < 0 && typeof e.data.text === 'string' && e.data.text.length > 0) {
        ttftMs = Math.round(this.now() - started);
      } else if (e.event === 'fallback') {
        fallback = e;
      } else if (e.event === 'done') {
        done = e;
      }
      on(e);
    };
    const reader = res.body.getReader();
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        for (const frame of parser.feed(decoder.decode(r.value, { stream: true }))) {
          const e = toDialogueEvent(frame);
          if (e !== null) handle(e);
        }
      }
      for (const frame of parser.feed(decoder.decode())) {
        const e = toDialogueEvent(frame);
        if (e !== null) handle(e);
      }
    } catch (e) {
      if (isAbort(e, signal)) return { kind: 'aborted' };
      // the connection broke mid-stream: tell the UI to drop the partial line, then play ink
      const broken: DialogueEvent = { event: 'fallback', data: { reason: 'upstream', knot } };
      handle(broken);
      return { kind: 'fallback', encounterId, reason: 'upstream', knot, ttftMs: ttftMs < 0 ? Math.round(this.now() - started) : ttftMs, midStream: true };
    }
    const fb = fallback as Extract<DialogueEvent, { event: 'fallback' }> | null;
    if (fb !== null) {
      return { kind: 'fallback', encounterId, reason: fb.data.reason, knot: fb.data.knot, ttftMs: ttftMs < 0 ? Math.round(this.now() - started) : ttftMs, midStream: false };
    }
    const d = done as Extract<DialogueEvent, { event: 'done' }> | null;
    if (d !== null) return { kind: 'done', encounterId, closed: d.data.closed, turnsLeft: d.data.turnsLeft, model, ttftMs };
    // ended with neither `done` nor `fallback`
    handle({ event: 'fallback', data: { reason: 'upstream', knot } });
    return { kind: 'fallback', encounterId, reason: 'upstream', knot, ttftMs: ttftMs < 0 ? Math.round(this.now() - started) : ttftMs, midStream: true };
  }

  private async refusal(res: Response): Promise<TalkEnd> {
    let code: ApiErrorCode = 'upstream_unavailable';
    let retryAfterMs: number | undefined;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (typeof body.error?.code === 'string') code = body.error.code;
      retryAfterMs = body.error?.retryAfterMs;
      details = body.error?.details;
    } catch {
      // not JSON (a proxy page, a 5xx): treated as the Worker being unavailable
    }
    return { kind: 'refused', code, status: res.status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }), ...(details === undefined ? {} : { details }) };
  }
}
