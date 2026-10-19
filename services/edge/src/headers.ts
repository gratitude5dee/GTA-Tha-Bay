import { BASELINE_HEADERS, buildCspReportOnly, REPORTING_ENDPOINTS } from '@dv/shared';
import type { Env } from './env.ts';

/** Paths that must not be cross-origin isolated (full-page provider redirects; 11-platform-pwa.md section 2). */
export function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

/**
 * Adds COOP/COEP/CORP to a Worker response. `_headers` only covers static assets (F-019), so every response
 * the Worker produces goes through here. Paths under /account/ get no COOP/COEP.
 *
 * M05b1 (DL-191) adds `nosniff` and `Referrer-Policy` everywhere, and, when the hosts are known and the path is not under
 * /account/ (which has its own allowlist), the Report-Only CSP with its `Reporting-Endpoints` group.
 */
export function withIsolationHeaders(res: Response, pathname: string, hosts?: Pick<Env, 'HOST_MEDIA' | 'HOST_UGC' | 'HOST_RT' | 'HOST_ID'>): Response {
  const out = new Response(res.body, res);
  if (isAccountPath(pathname)) {
    out.headers.delete('Cross-Origin-Opener-Policy');
    out.headers.delete('Cross-Origin-Embedder-Policy');
  } else {
    out.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    out.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    if (hosts) {
      out.headers.set('Content-Security-Policy-Report-Only', buildCspReportOnly({ media: hosts.HOST_MEDIA, ugc: hosts.HOST_UGC, rt: hosts.HOST_RT, id: hosts.HOST_ID }));
      out.headers.set('Reporting-Endpoints', REPORTING_ENDPOINTS);
    }
  }
  out.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) out.headers.set(name, value);
  return out;
}
