/**
 * Bands of the economy harness (M04d): `config/econ-bands.json` (cents), its schema, percentile maths and the comparison.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { toolsRoot } from '../lib/common.ts';

export type Percentile = 'p10' | 'p50' | 'p90';
export const PERCENTILES: readonly Percentile[] = ['p10', 'p50', 'p90'];
export type Metric = 'endBalance' | 'totalIncome';
export const METRICS: readonly Metric[] = ['endBalance', 'totalIncome'];

export type Band = [min: number, max: number];

export interface SectionBands {
  /** Probe name -> exact cents. */
  exact: Record<string, number>;
  /** Policy -> metric -> percentile -> inclusive band, cents. */
  policies: Record<string, Partial<Record<Metric, Partial<Record<Percentile, Band>>>>>;
}

export interface EconBands {
  v: 1;
  unit: 'cents';
  sections: Record<string, SectionBands>;
}

/** Nearest-rank percentile of an ascending list of integers. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error('percentile of an empty list');
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1] as number;
}

export const BANDS_PATH = path.join(toolsRoot, 'config', 'econ-bands.json');
export const SCHEMA_PATH = path.join(toolsRoot, 'tools', 'ci', 'schemas', 'econ-bands.schema.json');

export function validateBands(data: unknown): EconBands {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  if (!validate(data)) {
    const first = (validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ');
    throw new Error(`econ bands do not match econ-bands.schema.json: ${first}`);
  }
  return data as EconBands;
}

export function loadBands(file: string = BANDS_PATH): EconBands {
  return validateBands(JSON.parse(readFileSync(file, 'utf8')));
}

/** What one section produced: exact probe results and per-policy percentile tables. */
export interface SectionResult {
  exact: Record<string, number>;
  policies: Record<string, Record<Metric, Record<Percentile, number>>>;
}

export interface BandFailure {
  where: string;
  got: number;
  want: string;
}

/** Compares a section result with its bands; every band and every exact value must hold, and each banded key must exist. */
export function checkSection(result: SectionResult, bands: SectionBands): BandFailure[] {
  const out: BandFailure[] = [];
  for (const [name, want] of Object.entries(bands.exact)) {
    const got = result.exact[name];
    if (got === undefined) out.push({ where: `exact.${name}`, got: NaN, want: `exactly ${want}` });
    else if (got !== want) out.push({ where: `exact.${name}`, got, want: `exactly ${want}` });
  }
  for (const [policy, metrics] of Object.entries(bands.policies)) {
    for (const metric of METRICS) {
      for (const p of PERCENTILES) {
        const band = metrics[metric]?.[p];
        if (!band) continue;
        const got = result.policies[policy]?.[metric]?.[p];
        const where = `${policy}.${metric}.${p}`;
        if (got === undefined) out.push({ where, got: NaN, want: `${band[0]}..${band[1]}` });
        else if (got < band[0] || got > band[1]) out.push({ where, got, want: `${band[0]}..${band[1]}` });
      }
    }
  }
  return out;
}
