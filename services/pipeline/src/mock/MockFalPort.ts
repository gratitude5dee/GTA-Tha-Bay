/**
 * FAL_MODE=mock executor: replays the committed fixture clip as the video output and posts a webhook signed with the
 * mock test key (served as a JWKS by the non-production test routes). Every call is recorded so tests can prove
 * "0 submits" on a cache hit and "exactly 1 submit" under concurrency.
 */
import { FAL_WEBHOOK_HEADERS, webhookMessage } from '../fal.ts';
import type { FalPort, FalResult, FalStatus, FalSubmission, FalSubmitOptions } from '../ports.ts';
import { fixtureBytes } from './fixtures.ts';
import { mockKeyPair } from './test-key.ts';

export type MockCallKind = 'submit' | 'keyframe' | 'cancel';

export interface MockRecorder {
  record(kind: MockCallKind, jobKey: string, detail: string): Promise<void>;
}

/** In-memory recorder (check:pipeline, unit tests). The Worker uses an R2-backed recorder (one object per call). */
export class MemoryRecorder implements MockRecorder {
  readonly calls: { kind: MockCallKind; jobKey: string; detail: string }[] = [];
  record(kind: MockCallKind, jobKey: string, detail: string): Promise<void> {
    this.calls.push({ kind, jobKey, detail });
    return Promise.resolve();
  }
  count(kind: MockCallKind): number {
    return this.calls.filter((c) => c.kind === kind).length;
  }
}

export interface MockFalOptions {
  recorder: MockRecorder;
  /** Hands the signed webhook request to route 29's handler (no network in tests). */
  deliver: (request: Request) => Promise<void>;
  now: () => number;
  /** When true no webhook is posted: the Workflow's `waitForEvent` times out and polling completes the job. */
  dropWebhook?: () => boolean | Promise<boolean>;
  /** Delay before the webhook is posted, in milliseconds. */
  webhookDelayMs?: number;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export class MockFalPort implements FalPort {
  constructor(private readonly o: MockFalOptions) {}

  async submit(endpointId: string, _input: Record<string, unknown>, opts: FalSubmitOptions): Promise<FalSubmission> {
    const requestId = `mock-${opts.jobKey.slice(0, 16)}`;
    await this.o.recorder.record('submit', opts.jobKey, `${endpointId} ${requestId}`);
    const sub: FalSubmission = {
      requestId,
      statusUrl: `mock://fal/${requestId}/status`,
      responseUrl: `mock://fal/${requestId}/response`,
      cancelUrl: `mock://fal/${requestId}/cancel`,
    };
    if (!(await this.o.dropWebhook?.())) {
      // Fire and forget: the Workflow may already be waiting, or reach waitForEvent a moment later (events are buffered).
      setTimeout(() => {
        void this.postWebhook(sub, opts.webhookUrl).catch(() => undefined);
      }, this.o.webhookDelayMs ?? 10);
    }
    return sub;
  }

  private async postWebhook(sub: FalSubmission, webhookUrl: string): Promise<void> {
    const body = new TextEncoder().encode(
      JSON.stringify({ request_id: sub.requestId, gateway_request_id: sub.requestId, status: 'OK', payload: { video: { url: `mock://fal/${sub.requestId}/orig.mp4` } } }),
    );
    const timestamp = String(Math.floor(this.o.now() / 1000));
    const userId = 'mock-user';
    const message = await webhookMessage({ requestId: sub.requestId, userId, timestamp }, body.buffer as ArrayBuffer);
    const { privateKey } = await mockKeyPair();
    const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, message));
    const request = new Request(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [FAL_WEBHOOK_HEADERS.requestId]: sub.requestId,
        [FAL_WEBHOOK_HEADERS.userId]: userId,
        [FAL_WEBHOOK_HEADERS.timestamp]: timestamp,
        [FAL_WEBHOOK_HEADERS.signature]: signature,
      },
      body,
    });
    await this.o.deliver(request);
  }

  status(): Promise<FalStatus> {
    return Promise.resolve({ status: 'COMPLETED' });
  }

  result(sub: FalSubmission): Promise<FalResult> {
    return Promise.resolve({ videoUrl: `mock://fal/${sub.requestId}/orig.mp4`, contentType: 'video/mp4' });
  }

  async cancel(sub: FalSubmission): Promise<void> {
    await this.o.recorder.record('cancel', sub.requestId, sub.cancelUrl);
  }

  fetchFile(url: string): Promise<Uint8Array> {
    if (!url.startsWith('mock://fal/')) return Promise.reject(new Error(`MockFalPort cannot fetch ${url}`));
    return Promise.resolve(fixtureBytes('orig.mp4'));
  }

  async keyframe(job: { jobKey: string; shotId: string; prompt: string }): Promise<{ sha256: string }> {
    await this.o.recorder.record('keyframe', job.jobKey, job.shotId);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${job.shotId}\n${job.prompt}`));
    return { sha256: hex(digest) };
  }
}
