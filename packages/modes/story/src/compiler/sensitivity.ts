/**
 * The sensitivity-read gate (M05c2). A mission tagged `sensitivity-read` (every mission in districts d3 and d4, see lint.ts) must have a
 * recorded read of its CURRENT version before a release build: `content/story/sensitivity.json` holds one row per read. A new mission
 * version needs a new row, so editing a mission after its read re-opens the gate. A plain build only warns.
 */

export interface SensitivityRow {
  missionId: string;
  version: number;
  readBy: string;
  /** Epoch ms. */
  readAt: number;
}

export interface SensitivityFile {
  schema: 'story-sensitivity/1';
  rows: SensitivityRow[];
}

export interface SensitivityFinding {
  missionId: string;
  version: number;
  message: string;
}

export interface SensitivityResult {
  /** Fail a release build. */
  errors: SensitivityFinding[];
  /** Printed by every other build. */
  warnings: SensitivityFinding[];
}

export const SENSITIVITY_TAG = 'sensitivity-read';

/** Structural problems of the file itself (bad shape, duplicate rows). */
export function validateSensitivityFile(f: unknown): string[] {
  const out: string[] = [];
  if (!f || typeof f !== 'object') return ['sensitivity.json is not an object'];
  const file = f as Partial<SensitivityFile>;
  if (file.schema !== 'story-sensitivity/1') out.push('sensitivity.json schema must be story-sensitivity/1');
  if (!Array.isArray(file.rows)) return [...out, 'sensitivity.json rows must be an array'];
  const seen = new Set<string>();
  file.rows.forEach((r, i) => {
    const row = r as Partial<SensitivityRow> | null;
    if (!row || typeof row.missionId !== 'string' || !Number.isInteger(row.version) || typeof row.readBy !== 'string' || row.readBy === '' || !Number.isFinite(row.readAt)) {
      out.push(`sensitivity.json rows[${i}] needs missionId, integer version, readBy and readAt`);
      return;
    }
    const key = `${row.missionId}@${row.version}`;
    if (seen.has(key)) out.push(`sensitivity.json rows[${i}] repeats ${key}`);
    seen.add(key);
  });
  return out;
}

/** Missions that carry the tag and lack a row for their current version. `release` turns the findings into errors. */
export function checkSensitivity(
  missions: readonly { id: string; version: number; tags: readonly string[] }[],
  rows: readonly SensitivityRow[],
  release: boolean,
): SensitivityResult {
  const read = new Set(rows.map((r) => `${r.missionId}@${r.version}`));
  const findings: SensitivityFinding[] = [];
  for (const m of [...missions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // QA-only missions (`m.dev.*`) never reach players, so they need no read
    if (m.id.startsWith('m.dev.') || !m.tags.includes(SENSITIVITY_TAG) || read.has(`${m.id}@${m.version}`)) continue;
    findings.push({ missionId: m.id, version: m.version, message: `${m.id} version ${m.version} has the tag ${SENSITIVITY_TAG} and no row in content/story/sensitivity.json` });
  }
  return release ? { errors: findings, warnings: [] } : { errors: [], warnings: findings };
}
