import { describe, expect, it } from 'vitest';
import { batch, call, event, post } from './helpers.ts';

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(res.headers.get('X-Request-Id'));
  expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
}

describe('ApiError envelope', () => {
  it('51 events: 413 payload_too_large', async () => {
    const events = Array.from({ length: 51 }, () => event('storage.persist', { granted: true }));
    await expectError(await post(batch(events)), 413, 'payload_too_large');
  });

  it('65 KiB body: 413 payload_too_large', async () => {
    const big = JSON.stringify(batch([event('err.js', { fp: 'a', msg: 'x'.repeat(100), top: 'y' })])) + ' '.repeat(65 * 1024);
    await expectError(await post(big), 413, 'payload_too_large');
  });

  it('text/plain: 415 unsupported_media_type', async () => {
    await expectError(await post('hello', { contentType: 'text/plain' }), 415, 'unsupported_media_type');
  });

  it('invalid JSON and invalid envelope: 400 bad_request', async () => {
    await expectError(await post('{nope'), 400, 'bad_request');
    await expectError(await post({ v: 2 }), 400, 'bad_request');
  });

  it('unknown route: 404 not_found; wrong method: 405', async () => {
    await expectError(await call('/api/v1/nope'), 404, 'not_found');
    await expectError(await call('/api/other'), 404, 'not_found');
    const res = await call('/api/v1/t');
    await expectError(res, 405, 'bad_request');
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('legal placeholder: 404 feature_disabled for any method', async () => {
    await expectError(await call('/api/v1/legal/dmca', { method: 'POST' }), 404, 'feature_disabled');
    await expectError(await call('/api/v1/legal'), 404, 'feature_disabled');
  });
});
