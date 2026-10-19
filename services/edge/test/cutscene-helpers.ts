import { env as testEnv } from 'cloudflare:test';
import { sha256Hex, type CutsceneStatus } from '@dv/shared';
import { fixtureBytes } from '@dv/pipeline/core';
import { buildCutsceneJob } from '../src/cutscenes/job.ts';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';

export const OPS = 'test-ops-token';

/** A deterministic 64-hex cutscene key per test label. */
export const keyOf = (label: string): string => sha256Hex(`cutscene-test:${label}`);

export const bindings = (): Env => testEnv as unknown as Env;

/** Request options that put the given keys in the catalog and set the staff token. */
export function withCatalog(keys: string[], extra: Partial<Env> = {}): { env: Partial<Env> } {
  return { env: { CUTSCENE_CATALOG_EXTRA: keys.join(','), OPS_TOKEN: OPS, ...extra } };
}

export async function getStatus(key: string, keys: string[] = [key], extra: Partial<Env> = {}): Promise<CutsceneStatus & { requestId?: string }> {
  const res = await call(`/api/v1/cutscenes/${key}`, withCatalog(keys, extra));
  return (await res.json()) as CutsceneStatus;
}

export function prewarm(keys: string[], catalog: string[] = keys, extra: Partial<Env> = {}): Promise<Response> {
  return call('/api/v1/admin/cutscenes/prewarm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
    ...withCatalog(catalog, extra),
  });
}

/** Publishes a ready manifest for a key directly in MEDIA (a cache hit). */
export async function seedManifest(key: string): Promise<void> {
  await bindings().MEDIA.put(`cutscenes/${key}/manifest.json`, JSON.stringify({ schema: 'cutscene-asset/1', key }));
}

export async function waitForState(key: string, want: CutsceneStatus['state'], keys: string[] = [key], timeoutMs = 20_000): Promise<CutsceneStatus> {
  const start = Date.now();
  let last: CutsceneStatus = { key, state: 'absent' };
  while (Date.now() - start < timeoutMs) {
    last = await getStatus(key, keys);
    if (last.state === want) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${want}; last state ${JSON.stringify(last)}`);
}

/** Mock executor calls recorded as objects in PRIVATE (`mock-fal/<kind>/<jobKey>/<uuid>`). */
export async function mockCalls(kind: 'submit' | 'keyframe' | 'cancel', key?: string): Promise<number> {
  const jobKey = key === undefined ? '' : buildCutsceneJob(key, bindings(), 'test').jobKey;
  const listed = await bindings().PRIVATE.list({ prefix: `mock-fal/${kind}/${jobKey}` });
  return listed.objects.length;
}

export const fixtureOrigSha = (): string => sha256Hex(fixtureBytes('orig.mp4'));
