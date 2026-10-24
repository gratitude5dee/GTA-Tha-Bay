import { zipOfRows } from '@dv/shared/zip';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { CREDENTIAL_HANDLERS, type CredentialHandler } from './forget.ts';

/**
 * The export job (`GET /me/export`, route 14): a ZIP of every row keyed by the profile (`tables/<name>.json`) and every R2 object of its
 * transcripts (`transcripts/<id>.jsonl`), plus what each credential handler holds, written to PRIVATE `exports/<profileId>/<exportId>.zip`.
 * The route hands the file back through an authenticated Worker download (BD-M06a1-07); R2 expires exports after 7 days and the nightly retention job
 * removes older ones. A refresh token hash, an identity subject or an embedding is never exported.
 */
export const EXPORT_TTL_MS = 7 * 86_400_000;

export const exportKey = (profileId: string, exportId: string): string => `exports/${profileId}/${exportId}.zip`;

export interface ExportResult {
  key: string;
  bytes: number;
}

export async function runExport(
  env: Env,
  deps: Pick<AppDeps, 'data' | 'log' | 'now'>,
  profileId: string,
  exportId: string,
  handlers: readonly CredentialHandler[] = CREDENTIAL_HANDLERS,
): Promise<ExportResult | null> {
  const port = deps.data(env);
  if (port === null) return null;
  const rows = await port.maintenance.exportRows(profileId);
  const extra: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  for (const key of await port.maintenance.transcriptKeys(profileId)) {
    const obj = await env.PRIVATE.get(key);
    if (obj !== null) extra.push({ name: key, data: new Uint8Array(await obj.arrayBuffer()) });
  }
  for (const h of handlers) {
    if (h.export) extra.push({ name: `providers/${h.name}.json`, data: enc.encode(`${JSON.stringify(await h.export(env, profileId), null, 1)}\n`) });
  }
  extra.push({ name: 'README.txt', data: enc.encode(`Data export of one profile, created ${new Date(deps.now()).toISOString()}.\ntables/*.json hold your rows; transcripts/*.jsonl hold your conversations.\n`) });
  const zip = zipOfRows(rows, extra);
  const key = exportKey(profileId, exportId);
  await env.PRIVATE.put(key, zip, { httpMetadata: { contentType: 'application/zip' }, customMetadata: { createdAt: String(deps.now()) } });
  deps.log(JSON.stringify({ event: 'export.done', bytes: zip.length }));
  return { key, bytes: zip.length };
}
