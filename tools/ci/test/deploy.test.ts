import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSecretsJson, main, parsePreviewUrl, PREVIEW_URL_FILE, QUEUE_NAMES, stripJsonc, WORKER_SECRETS, workerNames } from '../deploy.ts';
import { dropDashDash, repoRoot } from '../run.ts';

describe('deploy.ts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every Worker in wrangler.jsonc is named tha-bay-*', () => {
    const names = workerNames(readFileSync(path.join(repoRoot, 'services/edge/wrangler.jsonc'), 'utf8'));
    expect(names.sort()).toEqual(['tha-bay-web', 'tha-bay-web-staging']);
  });

  it('strips comments without touching strings', () => {
    const text = '{ "a": "x // not a comment", // gone\n "b": 1, /* gone */ "c": [1,2,], }';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 'x // not a comment', b: 1, c: [1, 2] });
  });

  it('prints SKIP naming both variables, writes no preview URL file and exits 0 without credentials', () => {
    const file = path.join(repoRoot, PREVIEW_URL_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'https://stale.example.workers.dev\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['preview'], {})).toBe(0);
    expect(log).toHaveBeenCalledWith('SKIP deploy:preview: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set');
    expect(existsSync(file)).toBe(false);
    for (const mode of ['prod', 'bootstrap']) expect(main([mode], { CLOUDFLARE_API_TOKEN: 'only-one' })).toBe(0);
  });

  it('maps the Worker secrets from the environment into the secrets file (DL-679, M06a1): keys only asserted, absent ones left out', () => {
    expect(WORKER_SECRETS).toEqual(['PLAY_TOKEN_HMAC', 'PLAY_TOKEN_HMAC_PREV', 'QUOTA_NET_SALT_SECRET']);
    const full = buildSecretsJson({ PLAY_TOKEN_HMAC: 'k1:aaaa', PLAY_TOKEN_HMAC_PREV: 'k0:bbbb', QUOTA_NET_SALT_SECRET: 'salt', UNRELATED: 'x' });
    expect(Object.keys(JSON.parse(full.json) as object).sort()).toEqual(['PLAY_TOKEN_HMAC', 'PLAY_TOKEN_HMAC_PREV', 'QUOTA_NET_SALT_SECRET']);
    expect(full.missing).toEqual([]);
    const partial = buildSecretsJson({ PLAY_TOKEN_HMAC: 'k1:aaaa', PLAY_TOKEN_HMAC_PREV: '' });
    expect(Object.keys(JSON.parse(partial.json) as object)).toEqual(['PLAY_TOKEN_HMAC']);
    expect(partial.missing).toEqual(['QUOTA_NET_SALT_SECRET']);
    expect(buildSecretsJson({}).json).toBe('{}\n');
  });

  it('bootstrap creates the four queues of the web Worker, every name tha-bay-*', () => {
    expect([...QUEUE_NAMES]).toEqual(['tha-bay-jobs', 'tha-bay-spend', 'tha-bay-jobs-staging', 'tha-bay-spend-staging']);
  });

  it('finds a preview URL in JSON, NDJSON and plain wrangler output', () => {
    const url = 'https://pr-7-tha-bay-web-staging.example.workers.dev';
    expect(parsePreviewUrl(JSON.stringify({ name: 'pr-7', preview_url: url, other: 'https://dash.cloudflare.com/x' }))).toBe(url);
    expect(parsePreviewUrl(`log line\n${JSON.stringify({ type: 'preview', previewUrl: url })}\n`)).toBe(url);
    expect(parsePreviewUrl(`Uploaded. Version Preview URL: ${url}\nDone`)).toBe(url);
    expect(parsePreviewUrl('nothing here')).toBeNull();
  });
});

describe('run.ts', () => {
  it('drops only the first literal --', () => {
    expect(dropDashDash(['vitest', 'run', '--', 'packages/ui'])).toEqual(['vitest', 'run', 'packages/ui']);
    expect(dropDashDash(['a', '--', '--', 'b'])).toEqual(['a', '--', 'b']);
    expect(dropDashDash(['a', 'b'])).toEqual(['a', 'b']);
  });
});
