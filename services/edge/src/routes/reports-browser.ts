import { apiError } from '../errors.ts';
import { scrub } from '../scrub.ts';
import type { Ctx } from '../router.ts';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS = 20;

interface CspBody {
  effectiveDirective?: unknown;
  'effective-directive'?: unknown;
  blockedURL?: unknown;
  'blocked-uri'?: unknown;
  documentURL?: unknown;
  'document-uri'?: unknown;
  disposition?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Origin (or keyword such as `inline`, `eval`) of a blocked URL; query strings and paths never reach storage. */
function blockedOrigin(raw: string): string {
  if (raw === '' || !raw.includes(':')) return raw.slice(0, 32);
  try {
    const u = new URL(raw);
    return u.origin === 'null' ? u.protocol : u.origin;
  } catch {
    return scrub(raw).slice(0, 64);
  }
}

function documentPath(raw: string): string {
  try {
    return new URL(raw).pathname.slice(0, 128);
  } catch {
    return '';
  }
}

/** Reporting API envelope (`application/reports+json`) or the legacy `csp-report` object; null for anything else. */
function cspReports(parsed: unknown): CspBody[] {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out: CspBody[] = [];
  for (const item of items.slice(0, MAX_REPORTS)) {
    if (!isRecord(item)) continue;
    if (item['type'] === 'csp-violation' && isRecord(item['body'])) out.push(item['body'] as CspBody);
    else if (isRecord(item['csp-report'])) out.push(item['csp-report'] as CspBody);
  }
  return out;
}

/**
 * Route 4: POST /api/v1/reports/browser. Receives Report-Only CSP violations (M05b1); desktop Chrome crash reports join in
 * M11a1. Always 204 for a well-formed body: the browser does not retry on the answer, and nothing in it is stored beyond
 * the directive, the blocked origin and the document path (C16 scrub).
 */
export async function handleBrowserReport({ request, env, requestId }: Ctx): Promise<Response> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return apiError('payload_too_large', 'Report body too large.', requestId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return apiError('bad_request', 'The body must be JSON.', requestId);
  }
  for (const b of cspReports(parsed)) {
    const directive = str(b.effectiveDirective ?? b['effective-directive']).slice(0, 64);
    const blocked = blockedOrigin(str(b.blockedURL ?? b['blocked-uri']));
    const path = documentPath(str(b.documentURL ?? b['document-uri']));
    const disposition = str(b.disposition) === 'enforce' ? 'enforce' : 'report';
    try {
      env.AE?.writeDataPoint({ indexes: ['csp-violation'], blobs: [directive, blocked, path, disposition, env.BUILD_ID], doubles: [1] });
    } catch {
      // telemetry must never fail the report
    }
  }
  return new Response(null, { status: 204 });
}
