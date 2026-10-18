import type { Env } from './env.ts';

/** Country the edge reports for the request, upper-case, or undefined (local dev has no `cf.country`). */
export function requestCountry(request: Request): string | undefined {
  const country = (request as Request & { cf?: { country?: unknown } }).cf?.country;
  return typeof country === 'string' && country.length > 0 ? country.toUpperCase() : undefined;
}

export function allowedCountries(env: Pick<Env, 'GEO_ALLOW'>): string[] {
  return env.GEO_ALLOW.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
}

/** A missing country counts as allowed (local dev). */
export function isRegionAllowed(country: string | undefined, env: Pick<Env, 'GEO_ALLOW'>): boolean {
  return country === undefined || allowedCountries(env).includes(country);
}

/** Routes the US-only gate never blocks: boot answers with region 'blocked' instead (A-10, R-ROLL-01). */
export function isGeoExempt(pathname: string): boolean {
  return (
    pathname === '/api/v1/health' ||
    pathname === '/api/v1/boot' ||
    pathname === '/api/v1/legal' ||
    pathname.startsWith('/api/v1/legal/') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/api/v1/.well-known/')
  );
}
