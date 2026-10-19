/**
 * The app-document Content-Security-Policy (spec/05-api-and-realtime.md section 1.3). It ships Report-Only at M05b1
 * (DL-191); enforcement is M14b2. One builder serves the static `_headers` (substituted at build) and the Worker
 * (`withIsolationHeaders`), so the two cannot differ. Pure.
 */

export interface CspHosts {
  /** Origins as in BootConfig.hosts, e.g. `https://media.example.com` (no trailing slash). */
  media: string;
  ugc: string;
  rt: string;
  id: string;
  /** Cloudflare account id for the R2 S3 endpoint used by presigned uploads; omitted when unknown. */
  accountId?: string | undefined;
}

export const CSP_REPORT_PATH = '/api/v1/reports/browser';
export const REPORTING_ENDPOINTS = `csp="${CSP_REPORT_PATH}"`;

/** Fixed response headers that go with the policy on every app document and Worker response. */
export const BASELINE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function wsOrigin(httpsOrigin: string): string {
  return httpsOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export function buildCspReportOnly(h: CspHosts): string {
  const r2 = h.accountId ? [`https://${h.accountId}.r2.cloudflarestorage.com`] : [];
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', h.media, h.ugc]],
    ['media-src', ["'self'", 'blob:', h.media]],
    ['font-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['connect-src', ["'self'", h.media, h.ugc, h.rt, wsOrigin(h.rt), h.id, ...r2]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['report-to', ['csp']],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
