/** Paths that must not be cross-origin isolated (full-page provider redirects; 11-platform-pwa.md section 2). */
export function isAccountPath(pathname: string): boolean {
  return pathname === '/account' || pathname.startsWith('/account/');
}

/**
 * Adds COOP/COEP/CORP to a Worker response. `_headers` only covers static assets (F-019), so every response
 * the Worker produces goes through here. Paths under /account/ get no COOP/COEP.
 */
export function withIsolationHeaders(res: Response, pathname: string): Response {
  const out = new Response(res.body, res);
  if (isAccountPath(pathname)) {
    out.headers.delete('Cross-Origin-Opener-Policy');
    out.headers.delete('Cross-Origin-Embedder-Policy');
  } else {
    out.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    out.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  out.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return out;
}
