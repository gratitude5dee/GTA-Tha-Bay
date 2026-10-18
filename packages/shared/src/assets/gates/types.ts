/** Result shape shared by every CI gate (internal, not a contract): one finding per printed line. */
export interface GateFinding {
  gate: string;
  file: string;
  rule: string;
  detail: string;
}

export function finding(gate: string, file: string, rule: string, detail: string): GateFinding {
  return { gate, file, rule, detail };
}

export function formatFinding(f: GateFinding): string {
  return `${f.gate}: ${f.file}: ${f.rule}: ${f.detail}`;
}

/** Paths whose text is exempt from the string and face-detector scans (M00b "Scan scope"). */
export const STRING_SCAN_PATH_ALLOWLIST: readonly string[] = [
  'spec/',
  'research/',
  'prompt-pack/',
  'docs/research/',
  'docs/legal/',
  'docs/decisions/',
  '.claude/',
  'config/ip-denylist.json',
];

export function isStringScanAllowlisted(path: string): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return STRING_SCAN_PATH_ALLOWLIST.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a));
}
