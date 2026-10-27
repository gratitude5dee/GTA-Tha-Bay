/**
 * Automated gates A1, A2 and A8 of the character pipeline (spec/domains/05-assets-pipeline.md section 2) and the gate report each stage
 * leaves beside its output. A3 to A7 are pure cores in `packages/shared/src/assets/gates/`. A1 and A2 read a `VisionPort` verdict
 * (Haiku 5.5 in production); without one the verdict is `held` and the human gate decides, recorded. Pure: no IO, no clock.
 */
import type { LikenessTier } from '@dv/shared';
import type { ProvenanceRecord } from '@dv/shared/assets/provenance';
import { checkDerivation, checkLikenessRecord, checkRecord, finding, type ConsentIndex, type GateFinding } from '@dv/shared/assets/gates';
import type { CharacterSubject, HumanGateId } from './character.ts';

export type GateStatus = 'pass' | 'fail' | 'held';

export interface GateReport {
  schema: 'char-gate-report/1';
  gate: string;
  stage: string;
  /** What was judged: a file name or a candidate label. */
  target: string;
  status: GateStatus;
  findings: GateFinding[];
  notes: string[];
  at: string;
}

export function gateReport(gate: string, stage: string, target: string, findings: GateFinding[], at: string, notes: string[] = [], held = false): GateReport {
  return { schema: 'char-gate-report/1', gate, stage, target, status: findings.length > 0 ? 'fail' : held ? 'held' : 'pass', findings, notes, at };
}

// -- vision ---------------------------------------------------------------------------------------------------------------------

/** Answer of the vision check (schema A§5.4 item 7, extended with the A1 fields). */
export interface VisionFields {
  grid_cells?: number;
  full_body_in_cell?: boolean;
  t_pose_arms?: boolean;
  bg_uniform?: boolean;
  apparent_minor?: 'none' | 'possible' | 'likely';
  nudity?: 'none' | 'partial' | 'explicit';
  gore?: 'none' | 'stylized' | 'realistic';
  logos_or_jerseys?: boolean;
  weapon_present?: boolean;
  photoreal?: boolean;
  /** Text read out of the image, for the names lint. */
  text_in_image?: string[];
}

export type VisionVerdict = { status: 'held'; reason: string } | { status: 'answered'; fields: VisionFields };

export interface VisionPort {
  check(kind: 'A1' | 'A2', images: readonly Uint8Array[], ctx: { slug: string; label: string }): Promise<VisionVerdict>;
}

/** The port used when no vision key exists: every verdict is held for the human gate. */
export const heldVision = (reason: string): VisionPort => ({ check: () => Promise.resolve({ status: 'held', reason }) });

// -- A1 layout ------------------------------------------------------------------------------------------------------------------

/** Programmatic measurements of one cell of a sheet. Fractions are 0..1 of the cell edge. */
export interface CellStats {
  /** Bounding box of the non-background pixels, or null for an empty cell. */
  figure: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Standard deviation of the luminance of the cell border strip (0..255). */
  borderStd: number;
}

export const A1_MARGIN = 0.05;
export const A1_BORDER_STD = 6;

export interface SheetShape {
  width: number;
  height: number;
  cols: number;
  rows: number;
}

/** Sheet geometry per tier: Standard 2560 x 1440 (2 x 2 cells of 1280 x 720); Lean 2K from nano-banana, the same 2 x 2 grid of 16:9 cells. */
export const SHEET_GRID = { cols: 2, rows: 2 } as const;
export const STANDARD_SHEET = { width: 2560, height: 1440 } as const;

export function evaluateA1Sheet(file: string, shape: SheetShape, cells: readonly CellStats[], vision: VisionVerdict | null, at: string, tier: 'standard' | 'lean'): GateReport {
  const out: GateFinding[] = [];
  const f = (rule: string, detail: string): void => {
    out.push(finding('A1', file, rule, detail));
  };
  if (tier === 'standard' && (shape.width !== STANDARD_SHEET.width || shape.height !== STANDARD_SHEET.height)) {
    f('size', `sheet is ${shape.width}x${shape.height}, not ${STANDARD_SHEET.width}x${STANDARD_SHEET.height}`);
  }
  if (cells.length !== shape.cols * shape.rows) f('cells', `${cells.length} cells measured, ${shape.cols * shape.rows} expected`);
  cells.forEach((c, i) => {
    if (c.figure === null) {
      f('figure', `cell ${i + 1} holds no figure`);
      return;
    }
    const { x0, y0, x1, y1 } = c.figure;
    if (x0 < A1_MARGIN || y0 < A1_MARGIN || 1 - x1 < A1_MARGIN || 1 - y1 < A1_MARGIN) f('margin', `cell ${i + 1}: the figure is closer than ${A1_MARGIN * 100} % to the cell edge`);
    if (c.borderStd > A1_BORDER_STD) f('background', `cell ${i + 1}: the background is not uniform (border deviation ${c.borderStd.toFixed(1)})`);
  });
  const notes: string[] = [];
  let held = false;
  if (vision === null || vision.status === 'held') {
    held = true;
    notes.push(`vision check held: ${vision === null ? 'not run' : vision.reason}; the human gate decides`);
  } else {
    const v = vision.fields;
    if (v.grid_cells !== undefined && v.grid_cells !== shape.cols * shape.rows) f('vision-grid', `vision counts ${v.grid_cells} cells`);
    if (v.full_body_in_cell === false) f('vision-body', 'vision: a figure is not full body in its cell');
    if (v.t_pose_arms === false) f('vision-pose', 'vision: the arms are not near horizontal');
    if (v.bg_uniform === false) f('vision-background', 'vision: the background is not uniform');
  }
  return gateReport('A1', 'sheet', file, out, at, notes, held);
}

/** A1 on the crops: four 1280 x 720 PNGs in the order front, left, back, right (spec section 1, stage 3a). */
export function evaluateA1Crops(files: readonly { name: string; width: number; height: number }[], at: string, expect: { width: number; height: number }): GateReport {
  const out: GateFinding[] = [];
  if (files.length !== 4) out.push(finding('A1', 'crops', 'count', `${files.length} crops, 4 expected`));
  for (const f of files) {
    if (f.width !== expect.width || f.height !== expect.height) out.push(finding('A1', f.name, 'size', `${f.width}x${f.height}, ${expect.width}x${expect.height} expected`));
  }
  return gateReport('A1', 'crops', 'crops', out, at);
}

// -- A2 safety ------------------------------------------------------------------------------------------------------------------

export function evaluateA2(file: string, stage: string, vision: VisionVerdict | null, textLint: (text: string) => boolean, at: string): GateReport {
  if (vision === null || vision.status === 'held') {
    return gateReport('A2', stage, file, [], at, [`vision check held: ${vision === null ? 'not run' : vision.reason}; the human gate decides`], true);
  }
  const v = vision.fields;
  const out: GateFinding[] = [];
  const f = (rule: string, detail: string): void => {
    out.push(finding('A2', file, rule, detail));
  };
  if (v.apparent_minor !== undefined && v.apparent_minor !== 'none') f('apparent-minor', `apparent_minor is ${v.apparent_minor}`);
  if (v.nudity !== undefined && v.nudity !== 'none') f('nudity', `nudity is ${v.nudity}`);
  if (v.gore === 'realistic') f('gore', 'realistic gore');
  if (v.logos_or_jerseys === true) f('logos', 'logos or jerseys');
  if (v.weapon_present === true) f('weapon', 'a weapon is present');
  if (v.photoreal === true) f('photoreal', 'the image is photoreal');
  for (const t of v.text_in_image ?? []) if (!textLint(t)) f('text-in-image', 'text in the image fails the names lint');
  return gateReport('A2', stage, file, out, at);
}

// -- A8 record ------------------------------------------------------------------------------------------------------------------

export interface A8Input {
  /** Every file the run stored for publication (sha256 of the bytes). */
  storedSha256: readonly string[];
  records: readonly ProvenanceRecord[];
  recordLicenses: readonly string[];
  consent: ConsentIndex;
  nowIso: string;
  /** The run used `MockFalPort`: records carry executor `mock` and env `test` by design, so those two rules are skipped (provenance:check still refuses them, they can never be published). */
  mock: boolean;
}

export function evaluateA8(i: A8Input, at: string): GateReport {
  const out: GateFinding[] = [];
  const bySha = new Map(i.records.map((r) => [r.sha256, r]));
  for (const sha of i.storedSha256) {
    if (!bySha.has(sha)) out.push(finding('A8', sha, 'no-record', `no provenance record for sha256 ${sha.slice(0, 12)}`));
  }
  for (const r of i.records) {
    for (const x of checkRecord(r, { recordLicenses: i.recordLicenses, release: false })) {
      if (i.mock && (x.rule === 'mock-reference' || x.rule === 'env-not-production')) continue;
      out.push(x);
    }
    out.push(...checkLikenessRecord(r, i.consent, i.nowIso));
  }
  out.push(...checkDerivation(i.records));
  // Every derived chain must end in a generated or authored root.
  const rootOf = (r: ProvenanceRecord, seen = new Set<string>()): ProvenanceRecord | null => {
    if (seen.has(r.sha256)) return null;
    seen.add(r.sha256);
    if (r.origin !== 'derived') return r;
    for (const p of r.derived_from) {
      const parent = bySha.get(p.replace(/^sha256:/, ''));
      if (parent !== undefined) return rootOf(parent, seen);
    }
    return null;
  };
  for (const r of i.records) {
    if (r.origin !== 'derived') continue;
    const root = rootOf(r);
    if (root === null || root.origin !== 'generated') out.push(finding('A8', r.paths[0] ?? r.sha256, 'root', 'the derivation chain does not end in a generated root'));
  }
  return gateReport('A8', 'publish', 'records', out, at, i.mock ? ['mock run: records carry executor mock and env test, and cannot pass provenance:check'] : []);
}

// -- H1 checklist ---------------------------------------------------------------------------------------------------------------

/** The H1 checklist for `parody` and `fictionalized` designs (spec section 2, legal L1). Printed by `gate` and acknowledged with `--checklist`. */
export function h1Checklist(tier: LikenessTier): string[] {
  if (tier === 'original' || tier === 'consented') return [];
  return [
    'display name is at least 0.4 edit distance from the real name and every alias',
    'no real tattoos, jerseys, numbers, logos or catchphrases',
    'not shown in the subject\'s fame domain',
    'no firearms, gore, drugs or crime (D-30)',
    'design visibly transformed (proportion, palette or era shift)',
    'disclaimer id set and a standIn exists',
  ];
}

/** Which gates a run must have approved before the next stage may start. */
export function gateRequired(gate: HumanGateId, subject: Pick<CharacterSubject, 'pipeline'>): boolean {
  if (subject.pipeline === 'lean' && gate === 'H2') return false;
  return true;
}
