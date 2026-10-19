import { describe, expect, it } from 'vitest';
import { call } from './helpers.ts';
import { keyOf, OPS } from './cutscene-helpers.ts';

const path = '/api/v1/admin/cutscenes/prewarm';
// A key outside the catalog is answered without starting generation, so these requests need no Workflow.
const body = JSON.stringify({ keys: [keyOf('prewarm-auth')] });

describe('route 28 prewarm (AC-5)', () => {
  it('answers 401 without a token, 401 with a wrong token, and 202 with OPS_TOKEN from a non-US country', async () => {
    const none = await call(path, { method: 'POST', body, env: { OPS_TOKEN: OPS } });
    expect(none.status).toBe(401);
    const wrong = await call(path, { method: 'POST', body, headers: { Authorization: 'Bearer nope' }, env: { OPS_TOKEN: OPS } });
    expect(wrong.status).toBe(401);
    const ok = await call(path, { method: 'POST', body, headers: { Authorization: `Bearer ${OPS}` }, country: 'DE', env: { OPS_TOKEN: OPS } });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ keys: [{ key: keyOf('prewarm-auth'), state: 'absent', reason: 'not_in_catalog' }] });
  });

  it('answers 401 for every token when OPS_TOKEN is not configured', async () => {
    const res = await call(path, { method: 'POST', body, headers: { Authorization: 'Bearer anything' }, env: { OPS_TOKEN: undefined } });
    expect(res.status).toBe(401);
    const empty = await call(path, { method: 'POST', body, headers: { Authorization: 'Bearer ' }, env: { OPS_TOKEN: '' } });
    expect(empty.status).toBe(401);
  });

  it('rejects a bad body after authentication', async () => {
    const auth = { Authorization: `Bearer ${OPS}` };
    const env = { OPS_TOKEN: OPS };
    expect((await call(path, { method: 'POST', body: 'nope', headers: auth, env })).status).toBe(400);
    expect((await call(path, { method: 'POST', body: JSON.stringify({ keys: [] }), headers: auth, env })).status).toBe(400);
    expect((await call(path, { method: 'POST', body: JSON.stringify({ keys: ['x'] }), headers: auth, env })).status).toBe(400);
  });

  it('is not a GET route', async () => {
    const res = await call(path, { env: { OPS_TOKEN: OPS } });
    expect(res.status).toBe(405);
  });
});
