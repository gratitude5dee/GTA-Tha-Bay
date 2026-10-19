import { env as testEnv } from 'cloudflare:test';
import worker, { createApp } from '../src/index.ts';
import type { Env } from '../src/env.ts';
import { UUIDV7_PATTERN } from '../src/uuidv7.ts';
import type { TelemetryBatch, TelemetryEvent } from '@dv/shared';

export interface Point {
  indexes?: string[];
  blobs?: (string | null)[];
  doubles?: number[];
}

export function aeStub(): { dataset: AnalyticsEngineDataset; points: Point[] } {
  const points: Point[] = [];
  return {
    points,
    dataset: { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void points.push((p ?? {}) as Point) },
  };
}

export async function call(
  path: string,
  init: RequestInit & { country?: string | null; env?: Partial<Env>; app?: ReturnType<typeof createApp> } = {},
): Promise<Response> {
  const { country, env: envOverride, app, ...rest } = init;
  const request = new Request(`https://example.test${path}`, {
    ...rest,
    ...(country ? { cf: { country } } : {}),
  } as RequestInit);
  return (app ?? worker).fetch(request, { ...(testEnv as unknown as Env), ...envOverride });
}

export const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
} as const;

export function isUuidV7(value: string | null): boolean {
  return value !== null && UUIDV7_PATTERN.test(value);
}

export function event(name: string, props: TelemetryEvent['props'] = {}, ts = 1_700_000_000_000): TelemetryEvent {
  return { name: name as TelemetryEvent['name'], ts, sessionId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', props };
}

export function batch(events: TelemetryEvent[]): TelemetryBatch {
  return {
    v: 1,
    build: 'test-build',
    seq0: 0,
    env: { tier: 'desktop', deviceClass: 'desktop', osMajor: 15, displayMode: 'tab', backend: 'webgl2' },
    events,
  };
}

export function post(body: unknown, init: { country?: string; contentType?: string } = {}): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return call('/api/v1/t', {
    method: 'POST',
    headers: { 'Content-Type': init.contentType ?? 'application/json' },
    body: raw,
    ...(init.country ? { country: init.country } : {}),
  });
}
