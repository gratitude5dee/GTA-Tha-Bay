import { apiError } from '../errors.ts';
import { scrub } from '../scrub.ts';
import type { Ctx } from '../router.ts';
import { writeServerEvent } from '../telemetry/server.ts';

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

/** Reporting API crash reports (`type: 'crash'`, Chromium): the reason, `oom` or `unresponsive`, and the page path. Safari sends none. */
function crashReports(parsed: unknown): { reason: 'oom' | 'unresponsive' | 'other'; path: string }[] {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out: { reason: 'oom' | 'unresponsive' | 'other'; path: string }[] = [];
  for (const item of items.slice(0, MAX_REPORTS)) {
    if (!isRecord(item) || item['type'] !== 'crash') continue;
    const body = isRecord(item['body']) ? item['body'] : {};
    const why = str(body['reason']);
    // The path only (never a query or fragment), then the C16 scrub: an email or a long token in a path segment does not survive.
    out.push({ reason: why === 'oom' || why === 'unresponsive' ? why : 'other', path: scrub(documentPath(str(item['url']))).slice(0, 128) });
  }
  return out;
}

/**
 * Route 4: POST /api/v1/reports/browser. Receives Report-Only CSP violations (M05b1) and desktop Chrome crash reports (M11a1).
 * Always 204 for a well-formed body: the browser does not retry on the answer, and nothing in it is stored beyond the directive, the
 * blocked origin and the document path (C16 scrub) for a CSP report, and the reason, the path and the build for a crash. The handler
 * never reads `CF-Connecting-IP`, `User-Agent` or `Cookie`.
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
  const now = Date.now();
  for (const c of crashReports(parsed)) {
    // One structured log line and one server-only `app.crash` event (C16 1.2, DL-224): the reason and the build, nothing else.
    console.log(JSON.stringify({ kind: 'crash', reason: c.reason, path: c.path, build: env.BUILD_ID }));
    writeServerEvent(env, 'app.crash', { reason: c.reason, build: env.BUILD_ID }, now);
  }
  return new Response(null, { status: 204 });
}
