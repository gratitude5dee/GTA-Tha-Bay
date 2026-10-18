/** Licence matching shared by provenance:check (record licences) and license:scan (dependency licences). */

/** Allowlist entries are SPDX ids or LicenseRef prefixes ending in `*`. */
export function licenseMatches(license: string, pattern: string): boolean {
  return pattern.endsWith('*') ? license.startsWith(pattern.slice(0, -1)) : license === pattern;
}

/**
 * True when the SPDX expression is covered: `A OR B` needs one side allowed, `A AND B` needs both.
 * A single id is matched against the patterns. Parentheses are flattened (enough for the licences in use).
 */
export function licenseAllowed(expression: string, patterns: readonly string[]): boolean {
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (expr === '') return false;
  return expr.split(/\s+OR\s+/i).some((alt) =>
    alt.split(/\s+AND\s+/i).every((id) => patterns.some((p) => licenseMatches(id.trim(), p))),
  );
}

const COPYLEFT = /(^|[^A-Z])(A?GPL|LGPL)(-|$)/i;

/** GPL, AGPL and LGPL families (license:scan fails them without an ADR id). */
export function isCopyleft(license: string): boolean {
  return license.split(/\s+(?:OR|AND)\s+/i).some((id) => COPYLEFT.test(id.replace(/[()]/g, '').trim()));
}

export interface DependencyLicenseException { package: string; license: string; scope: 'prod' | 'dev'; reason: string; adr?: string }

export interface DependencyPolicy {
  /** Allowed in production dependencies. */
  prod: readonly string[];
  /** Additionally allowed in dev-only dependencies. */
  devOnly: readonly string[];
  exceptions: readonly DependencyLicenseException[];
}

export interface DependencyVerdict { ok: boolean; rule: string; detail: string }

/**
 * Verdict for one dependency. Copyleft fails without an exception that names an ADR id; any other licence
 * outside the allowlist fails unless an exception names the package.
 */
export function judgeDependency(
  name: string,
  license: string,
  scope: 'prod' | 'dev',
  policy: DependencyPolicy,
): DependencyVerdict {
  const exc = policy.exceptions.find((e) => e.package === name && e.scope === scope && (e.license === license || license === 'UNKNOWN'));
  if (isCopyleft(license)) {
    if (exc?.adr) return { ok: true, rule: 'ok', detail: `copyleft with ${exc.adr}` };
    return { ok: false, rule: 'license-copyleft', detail: `${name}: ${license} needs an exception with an ADR id` };
  }
  const allowed = scope === 'prod' ? policy.prod : [...policy.prod, ...policy.devOnly];
  if (licenseAllowed(license, allowed)) return { ok: true, rule: 'ok', detail: license };
  if (exc) return { ok: true, rule: 'ok', detail: `exception: ${exc.reason}` };
  return { ok: false, rule: 'license-not-allowed', detail: `${name}: ${license} is not on the ${scope} allowlist` };
}
