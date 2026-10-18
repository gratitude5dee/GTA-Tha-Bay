import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { checkEndpoint, falEndpoints, fixtureName, toFixture, type LivenessResponse } from '../genai-liveness.ts';
import { buildRecord } from '../provenance-new.ts';
import { readJson, schemaValidator, toolsRoot } from '../../ci/lib/common.ts';

const dir = path.join(toolsRoot, 'tools/assets/test/fixtures/liveness');
const reg = readJson<GenAiRegistry>(path.join(toolsRoot, 'config/genai-endpoints.json'));
const entries = falEndpoints(reg);
const recorded = (id: string): LivenessResponse => JSON.parse(readFileSync(path.join(dir, fixtureName(id)), 'utf8')) as LivenessResponse;

interface Row { endpoint_id: string; metadata: Record<string, unknown> }
function pinned(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.id] = ((recorded(e.id).body as { models: Row[] }).models[0] as Row).metadata.updated_at as string;
  return out;
}
function mutate(id: string, f: (row: Row) => void): LivenessResponse {
  const res = structuredClone(recorded(id));
  f((res.body as { models: Row[] }).models[0] as Row);
  return res;
}

describe('genai:liveness (AC-9)', () => {
  it('has recorded fixtures for every fal endpoint and finds no issue on them', () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
    const pins = pinned();
    for (const e of entries) expect(checkEndpoint({ id: e.id, pinnedUpdatedAt: pins[e.id] as string }, recorded(e.id))).toEqual([]);
  });

  it('reports exactly the four planted issues', () => {
    const pins = pinned();
    const [a, b, c, d] = entries as [(typeof entries)[number], (typeof entries)[number], (typeof entries)[number], (typeof entries)[number]];
    const responses: Record<string, LivenessResponse> = {};
    for (const e of entries) responses[e.id] = recorded(e.id);
    responses[a.id] = { status: 404, body: { error: { type: 'not_found', message: 'Endpoint(s) not found' } } };
    responses[b.id] = mutate(b.id, (r) => (r.metadata.status = 'deprecated'));
    responses[c.id] = mutate(c.id, (r) => (r.metadata.license_type = 'research'));
    responses[d.id] = mutate(d.id, (r) => (r.metadata.updated_at = '2030-01-01T00:00:00.000Z'));
    const issues = entries.flatMap((e) => checkEndpoint({ id: e.id, pinnedUpdatedAt: pins[e.id] as string }, responses[e.id]));
    expect(issues.map((i) => `${i.id}:${i.rule}`)).toEqual([`${a.id}:missing`, `${b.id}:status`, `${c.id}:license`, `${d.id}:updated`]);
  });

  it('treats a null pin as not yet pinned and a network failure as unreachable', () => {
    const e = entries[0] as (typeof entries)[number];
    expect(checkEndpoint({ id: e.id, pinnedUpdatedAt: null }, recorded(e.id))).toEqual([]);
    expect(checkEndpoint({ id: e.id, pinnedUpdatedAt: null }, { status: 0, body: null, error: 'offline' })[0]?.rule).toBe('unreachable');
    expect(checkEndpoint({ id: e.id, pinnedUpdatedAt: null }, undefined)[0]?.rule).toBe('unreachable');
  });

  it('drops the OpenAPI document from recorded fixtures', () => {
    const res = toFixture({ status: 200, body: { models: [{ endpoint_id: 'x', metadata: {}, openapi: { big: true } }] } });
    expect(JSON.stringify(res)).not.toContain('openapi');
  });
});

describe('provenance:new', () => {
  it('builds a schema-valid record', () => {
    const rec = buildRecord({
      sha256: 'a'.repeat(64),
      paths: ['apps/web/public/icon.svg'],
      kind: 'ui',
      origin: 'authored',
      license: 'LicenseRef-DeeVerse-Owned',
      authors: ['studio:dee-verse'],
      createdAt: '2026-10-18T00:00:00Z',
    });
    expect(schemaValidator('provenance-1.0')(rec)).toEqual([]);
  });
});
