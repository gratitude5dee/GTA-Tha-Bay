/**
 * assets:verify --probe-bones (M10a1; spec/domains/05-assets-pipeline.md section 4, U-AST-1): proposes the `bay_rig_v1` alias table from the first
 * rigged output of a vendor, when the M00c spike that would have recorded it was skipped. The vendor names are read from the file; the
 * mapping uses the Mixamo-style names that Meshy states (vendor marketing, medium confidence), after stripping a namespace prefix such as
 * `mixamorig:`. A bone this table cannot place stays unmapped, so gate A4 keeps failing until a human extends the table. The result is a
 * proposal for review (`probed: true`), never silently trusted.
 */
import type { RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { canonicalBone } from '../../../packages/shared/src/assets/gates/index.ts';
import { jointNodes, readGlb } from './glb-inspect.ts';

/** Mixamo-style bone name (lower case, prefix stripped, separators removed) to the canonical name. */
export const MIXAMO_STYLE: Readonly<Record<string, string>> = {
  hips: 'hips', spine: 'spine', spine1: 'chest', spine2: 'upperChest', neck: 'neck', head: 'head',
  leftshoulder: 'l_shoulder', leftarm: 'l_upperArm', leftforearm: 'l_lowerArm', lefthand: 'l_hand',
  rightshoulder: 'r_shoulder', rightarm: 'r_upperArm', rightforearm: 'r_lowerArm', righthand: 'r_hand',
  leftupleg: 'l_upperLeg', leftleg: 'l_lowerLeg', leftfoot: 'l_foot', lefttoebase: 'l_toes',
  rightupleg: 'r_upperLeg', rightleg: 'r_lowerLeg', rightfoot: 'r_foot', righttoebase: 'r_toes',
};

export const normalizeVendorName = (name: string): string => name.replace(/^.*:/, '').replace(/[\s_.-]/g, '').toLowerCase();

export interface BoneProbe {
  /** Bone names found in the file. */
  found: string[];
  /** Vendor name to canonical name, proposed. */
  aliases: Record<string, string>;
  /** Canonical bones no vendor bone was placed on. */
  missing: string[];
  /** Vendor bones with no canonical counterpart (fingers, face, extras): fine, reported for the review. */
  extra: string[];
}

export async function probeBones(glb: Uint8Array, rig: RigFamily): Promise<BoneProbe> {
  const doc = await readGlb(glb);
  const found = jointNodes(doc).map((n) => n.getName());
  const aliases: Record<string, string> = {};
  const placed = new Set<string>();
  const extra: string[] = [];
  for (const name of found) {
    const known = canonicalBone(rig, name);
    if (known !== null) {
      placed.add(known);
      continue;
    }
    const guess = MIXAMO_STYLE[normalizeVendorName(name)];
    if (guess !== undefined && rig.required.includes(guess) && !placed.has(guess)) {
      aliases[name] = guess;
      placed.add(guess);
    } else extra.push(name);
  }
  return { found, aliases, missing: rig.required.filter((r) => !placed.has(r)), extra };
}

/** The next alias table: the existing aliases plus the proposal, with `probed` set. */
export function withProbedAliases(table: Record<string, unknown>, probe: BoneProbe, source: string): Record<string, unknown> {
  const aliases = { ...(table['aliases'] as Record<string, string> | undefined), ...probe.aliases };
  const sorted = Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { ...table, probed: true, probedFrom: source, aliases: sorted };
}
