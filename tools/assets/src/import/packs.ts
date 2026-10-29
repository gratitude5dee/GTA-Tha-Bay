/**
 * The third-party art pack register (docs/legal/licenses/packs.json, M10d0): loading, schema check and snapshot hashing.
 * The semantic rules are the pure gates in packages/shared/src/assets/gates/provenance.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ArtPack, ArtPackRegister } from '../../../../packages/shared/src/assets/gates/provenance.ts';
import { finding, type GateFinding } from '../../../../packages/shared/src/assets/gates/types.ts';
import { sha256Hex, toolsRoot } from '../../../ci/lib/common.ts';

export const PACKS_PATH = 'docs/legal/licenses/packs.json';
const GATE = 'provenance:check';

type Validate = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
const validators = new Map<string, Validate>();

/** Validator for the tool's own config/schemas/<name>.schema.json; returns one message per violation. */
export function configSchemaValidator(name: string): (data: unknown) => string[] {
  let v = validators.get(name);
  if (!v) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    v = ajv.compile(JSON.parse(readFileSync(path.join(toolsRoot, 'config', 'schemas', `${name}.schema.json`), 'utf8'))) as Validate;
    validators.set(name, v);
  }
  const fn = v;
  return (data) => (fn(data) ? [] : (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`));
}

export interface PackLoad { packs: ArtPack[]; findings: GateFinding[]; present: boolean }

/** The register of a checkout; an absent file is an empty register (a checkout from before M10d0), a malformed one is a finding. */
export function loadPackRegister(root: string): PackLoad {
  const file = path.join(root, PACKS_PATH);
  if (!existsSync(file)) return { packs: [], findings: [], present: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { packs: [], findings: [finding(GATE, PACKS_PATH, 'art-register-invalid', (e as Error).message)], present: true };
  }
  const errors = configSchemaValidator('art-packs')(raw);
  if (errors.length > 0) return { packs: [], findings: errors.map((m) => finding(GATE, PACKS_PATH, 'art-register-invalid', m)), present: true };
  const reg = raw as ArtPackRegister;
  const findings: GateFinding[] = [];
  const seenHosts = new Map<string, string>();
  for (const p of reg.packs) {
    for (const h of p.hosts) {
      const other = seenHosts.get(h);
      if (other !== undefined && other !== p.id) findings.push(finding(GATE, PACKS_PATH, 'art-register-invalid', `host ${h} is listed by packs ${other} and ${p.id}`));
      seenHosts.set(h, p.id);
    }
  }
  return { packs: reg.packs, findings, present: true };
}

/** SHA-256 of each pack's snapshot file as it is on disk; null when the file is missing. */
export function snapshotHashes(root: string, packs: readonly ArtPack[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const p of packs) {
    const abs = path.join(root, p.snapshot.path);
    out[p.id] = existsSync(abs) ? sha256Hex(readFileSync(abs)) : null;
  }
  return out;
}
