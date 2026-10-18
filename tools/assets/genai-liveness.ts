/**
 * genai:liveness. For each fal endpoint in config/genai-endpoints.json, GET the public registry without a key
 * [research/genai-pipeline-fal.md Method] and report: id missing, status other than active, license_type other than
 * commercial, updated_at different from pinnedUpdatedAt.
 *
 *   tsx tools/assets/genai-liveness.ts                   live, no key
 *   tsx tools/assets/genai-liveness.ts --fixtures <dir>  read recorded responses instead of the network
 *   tsx tools/assets/genai-liveness.ts --record <dir>    live, and write each response as a fixture
 *   tsx tools/assets/genai-liveness.ts --update-pins     live, then write updated_at into pinnedUpdatedAt
 *                                                        (a separate, reviewed PR)
 *
 * An unreachable registry is reported as an `unreachable` issue. The nightly job runs this; PR checks do not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { EndpointEntry, GenAiRegistry } from '../../packages/shared/src/genai/registry.ts';
import { args } from '../ci/run.ts';
import { isMain, readJson, toolsRoot } from '../ci/lib/common.ts';

const API = 'https://api.fal.ai/v1/models';

export interface LivenessResponse {
  /** HTTP status, or 0 when the request failed. */
  status: number;
  body: unknown;
  error?: string;
}

export interface LivenessIssue { id: string; rule: 'missing' | 'status' | 'license' | 'updated' | 'unreachable'; detail: string }

interface ModelRow { endpoint_id?: string; metadata?: { status?: string; license_type?: string; updated_at?: string } }

/** Pure: compare one recorded response with one registry entry. */
export function checkEndpoint(entry: Pick<EndpointEntry, 'id' | 'pinnedUpdatedAt'>, res: LivenessResponse | undefined): LivenessIssue[] {
  const id = entry.id;
  if (!res || res.status === 0) return [{ id, rule: 'unreachable', detail: res?.error ?? 'no response' }];
  if (res.status >= 500) return [{ id, rule: 'unreachable', detail: `HTTP ${res.status}` }];
  const models = (res.body as { models?: ModelRow[] } | null)?.models;
  const row = res.status === 200 ? models?.find((m) => m.endpoint_id === id) : undefined;
  if (!row) return [{ id, rule: 'missing', detail: `registry returned HTTP ${res.status} without ${id}` }];
  const issues: LivenessIssue[] = [];
  const meta = row.metadata ?? {};
  if (meta.status !== 'active') issues.push({ id, rule: 'status', detail: `status is ${meta.status ?? 'absent'}` });
  if (meta.license_type !== 'commercial') issues.push({ id, rule: 'license', detail: `license_type is ${meta.license_type ?? 'absent'}` });
  // A null pin means "not yet pinned" (first run, before the reviewed --update-pins PR): nothing to compare.
  if (entry.pinnedUpdatedAt !== null && (meta.updated_at ?? null) !== entry.pinnedUpdatedAt) {
    issues.push({ id, rule: 'updated', detail: `updated_at ${meta.updated_at ?? 'absent'} differs from pinned ${entry.pinnedUpdatedAt}` });
  }
  return issues;
}

export function fixtureName(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9.-]+/g, '_')}.json`;
}

export async function fetchEndpoint(id: string): Promise<LivenessResponse> {
  try {
    const url = `${API}?endpoint_id=${encodeURIComponent(id).replace(/%2F/g, '/')}&expand=openapi-3.0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
  } catch (e) {
    return { status: 0, body: null, error: (e as Error).message };
  }
}

/** Recorded fixtures keep the model rows without the (large) OpenAPI document. */
export function toFixture(res: LivenessResponse): LivenessResponse {
  const body = res.body as { models?: Record<string, unknown>[] } | null;
  if (!body?.models) return res;
  return { ...res, body: { ...body, models: body.models.map(({ openapi: _openapi, ...rest }) => rest) } };
}

export function falEndpoints(reg: GenAiRegistry): EndpointEntry[] {
  return Object.values(reg.endpoints).filter((e) => e.vendor === 'fal');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: { fixtures: { type: 'string' }, record: { type: 'string' }, 'update-pins': { type: 'boolean', default: false }, root: { type: 'string' } },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const regPath = path.join(root, 'config', 'genai-endpoints.json');
  const reg = readJson<GenAiRegistry>(regPath);
  const issues: LivenessIssue[] = [];
  const seen: Record<string, string | undefined> = {};
  if (values.record) mkdirSync(path.resolve(values.record), { recursive: true });
  for (const entry of falEndpoints(reg)) {
    let res: LivenessResponse | undefined;
    if (values.fixtures) {
      const f = path.join(path.resolve(values.fixtures), fixtureName(entry.id));
      res = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as LivenessResponse) : undefined;
    } else {
      res = await fetchEndpoint(entry.id);
      if (values.record) writeFileSync(path.join(path.resolve(values.record), fixtureName(entry.id)), `${JSON.stringify(toFixture(res), null, 2)}\n`);
    }
    const row = (res?.body as { models?: ModelRow[] } | null)?.models?.find((m) => m.endpoint_id === entry.id);
    seen[entry.id] = row?.metadata?.updated_at;
    const found = checkEndpoint(entry, res);
    issues.push(...found);
    const unpinned = entry.pinnedUpdatedAt === null && seen[entry.id] ? ` (unpinned; registry updated_at ${seen[entry.id]})` : '';
    console.log(`${found.length === 0 ? 'ok   ' : 'ISSUE'} ${entry.id} [${entry.status}]${unpinned}${found.map((i) => ` ${i.rule}: ${i.detail}`).join(';')}`);
  }
  if (values['update-pins']) {
    for (const entry of falEndpoints(reg)) {
      const u = seen[entry.id];
      if (u) (reg.endpoints[entry.id] as EndpointEntry).pinnedUpdatedAt = u;
    }
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
    console.log('genai:liveness: pins updated; review the diff in its own PR');
  }
  const pinIssues = values['update-pins'] ? issues.filter((i) => i.rule !== 'updated') : issues;
  console.log(pinIssues.length === 0 ? 'genai:liveness: ok' : `genai:liveness: ${pinIssues.length} issues`);
  process.exit(pinIssues.length === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) void main();
