import { BASELINE_HEADERS, buildCspReportOnly, REPORTING_ENDPOINTS } from '@dv/shared';
import type { Env } from './env.ts';

/** Paths that must not be cross-origin isolated (full-page provider redirects; 11-platform-pwa.md section 2). */
export function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

/** Origin of HOST_MEDIA (which carries the /media path) for the CSP; a missing or malformed value falls back to the raw value, never throws. */
export function mediaCspOrigin(hostMedia: string): string {
  try {
    return new URL(hostMedia).origin;
  } catch {
    return hostMedia;
  }
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
      out.headers.set('Content-Security-Policy-Report-Only', buildCspReportOnly({ media: mediaCspOrigin(hosts.HOST_MEDIA), ugc: hosts.HOST_UGC, rt: hosts.HOST_RT, id: hosts.HOST_ID }));
      out.headers.set('Reporting-Endpoints', REPORTING_ENDPOINTS);
    }
  }
  // /media/ is public data loaded no-cors by <video>/<img> from preview hosts under COEP require-corp (M01d2, DL-713).
  out.headers.set('Cross-Origin-Resource-Policy', pathname.startsWith('/media/') ? 'cross-origin' : 'same-origin');
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) out.headers.set(name, value);
  return out;
}
