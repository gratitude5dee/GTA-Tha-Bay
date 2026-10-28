/**
 * assets:verify --slug <slug> (M10a1; spec/domains/05-assets-pipeline.md section 12): the per-character path of `assets:verify`.
 * The whole-catalog gate runs first and its findings about this character are kept; then gates A4 (the bone set on the alias table),
 * A6 (the budget row, three fidelities), A7 (turntable SSIM of mid and lo against hi) and A8 (the provenance chain, the generated
 * root, the likeness block) run over the character's own files. A8 and the catalog gate are the same pure cores that `provenance:check`
 * and `likeness:gate` use, so a character that passes here passes there.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  checkA4Rig, checkA6Budget, checkA7Visual, checkDerivation, checkLikenessRecord, checkLikenessSummary, checkRecord, finding, frameStats, ssim, type ConsentIndex,
  type FidelityLimits, type GateFinding, type RigFamily,
} from '../../../packages/shared/src/assets/gates/index.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import { inspectRig, readGlb } from './glb-inspect.ts';
import { luma } from './image.ts';
import { frameOf, turntable } from './turntable.ts';
import { recordMap } from './lock.ts';
import { loadSpecs, type LoadedSpec } from './spec.ts';
import { assetGateFindings } from './verify.ts';

export const RIG = rigJson as unknown as RigFamily;
const GATE = 'assets:verify';

/** The refs a character owns. */
export function refsOf(slug: string): string[] {
  return [`character/${slug}`, `anim/${slug}.base`, `anim/${slug}.moves`, `portrait/${slug}`, `mouth_atlas/${slug}`];
}

const needles = (slug: string): string[] => [...refsOf(slug), `/${slug}/`, `/${slug}.`];
const belongs = (slug: string, f: GateFinding): boolean => needles(slug).some((n) => f.file.includes(n) || f.detail.includes(n));

export interface SlugReport {
  findings: GateFinding[];
  notes: string[];
}

export async function verifySlug(root: string, slug: string): Promise<SlugReport> {
  const findings: GateFinding[] = [];
  const notes: string[] = [];
  const whole = assetGateFindings(root);
  findings.push(...whole.findings.filter((f) => belongs(slug, f)));
  const { specs } = loadSpecs(root);
  const own = specs.filter((s) => refsOf(slug).includes(s.ref));
  const char = own.find((s) => s.ref === `character/${slug}`);
  if (char === undefined) {
    findings.push(finding(GATE, `assets/src/character/${slug}`, 'slug-missing', `no character/${slug} spec; run assets:gen run -- --slug ${slug} --until publish first`));
    return { findings, notes };
  }
  // the lock: an active public asset ships only with an approved entry (assets:lock after the H5 review)
  for (const s of own) {
    if (s.spec.status === 'active' && s.spec.visibility === 'public' && whole.lock?.entries[s.ref] === undefined && !findings.some((f) => f.rule === 'not-in-lock' && f.detail.includes(s.ref))) {
      findings.push(finding(GATE, s.specPath, 'not-in-lock', `${s.ref} is active and public but has no entry in assets/assets.lock.json; run pnpm assets:lock -- --approved-by <handle> after the H5 review`));
    }
  }
  // A4: the bone set of the shipped model on the alias table
  const hi = char.files.find((f) => f.variant === 'desktop');
  const mid = char.files.find((f) => f.variant === 'mobile');
  const lo = char.files.find((f) => f.variant === 'mobile-low');
  if (hi === undefined || mid === undefined || lo === undefined) {
    findings.push(finding(GATE, char.specPath, 'fidelity-missing', 'the character needs desktop, mobile and mobile-low files'));
    return { findings, notes };
  }
  const bytes = (f: { abs: string }): Uint8Array => new Uint8Array(readFileSync(f.abs));
  const hiRig = await inspectRig(bytes(hi), RIG);
  const animSpec = own.find((s) => s.ref === `anim/${slug}.base`);
  let clips = hiRig.stats.clipCount;
  if (animSpec?.files[0] !== undefined) clips = (await readGlb(bytes(animSpec.files[0]))).getRoot().listAnimations().length;
  findings.push(...checkA4Rig(hi.path, { ...hiRig.stats, clipCount: clips }, RIG, clips));
  notes.push(`A4: ${hiRig.stats.boneNames.length} bones, ${clips} clips`);

  // A6: the budget row
  const budgets = JSON.parse(readFileSync(path.join(root, 'config/asset-budgets.json'), 'utf8')) as { rows: { id: string; tag?: string; kind: string; fidelity: Record<'hi' | 'mid' | 'lo', FidelityLimits> }[] };
  const row = budgets.rows.find((r) => r.kind === 'character' && (r.tag === undefined || char.spec.tags.includes(r.tag)));
  if (row === undefined) findings.push(finding(GATE, char.specPath, 'budget-row', 'no character budget row matches the spec tags (class:hero or class:npc)'));
  else {
    for (const [fid, f, v] of [['hi', hi, 'desktop'], ['mid', mid, 'mobile'], ['lo', lo, 'mobile-low']] as const) {
      const s = char.spec.stats?.[v];
      if (s === undefined) {
        findings.push(finding(GATE, char.specPath, 'stats-missing', `${v}: asset.json records no stats`));
        continue;
      }
      findings.push(...checkA6Budget(f.path, fid, { tris: s.tris ?? 0, maxTexPx: s.texMaxPx ?? 0, materials: s.materials ?? 0, gpuTexBytes: s.texGpuBytes ?? 0, fileBytes: f.bytes }, row.fidelity[fid]));
    }
  }

  // A7: the three fidelities against each other
  const docs = await Promise.all([hi, mid, lo].map(async (f) => readGlb(bytes(f))));
  const [dHi, dMid, dLo] = docs;
  if (dHi && dMid && dLo) {
    const frame = frameOf(dHi);
    const [vHi, vMid, vLo] = [dHi, dMid, dLo].map((d) => turntable(d, frame));
    const avg = (a: typeof vHi, b: typeof vHi): number => (a && b && a.length > 0 ? a.reduce((n, r, i) => n + ssim(luma(r), luma(b[i] ?? r), r.width, r.height), 0) / a.length : 0);
    const ssimMid = avg(vHi, vMid);
    const ssimLo = avg(vHi, vLo);
    findings.push(...checkA7Visual(hi.path, { ssimMid, ssimLo, frames: (vHi ?? []).map((r) => frameStats(luma(r))) }));
    notes.push(`A7: SSIM mid ${ssimMid.toFixed(3)}, lo ${ssimLo.toFixed(3)}`);
  }

  // A8: provenance chain, generated root, likeness
  const bySha = recordMap(root);
  const chain = collectChain(own, bySha);
  const license = JSON.parse(readFileSync(path.join(root, 'config/license-allowlist.json'), 'utf8')) as { record: string[] };
  const consentFile = path.join(root, 'config/consent-index.json');
  const consent: ConsentIndex = existsSync(consentFile) ? (JSON.parse(readFileSync(consentFile, 'utf8')) as ConsentIndex) : { schema: 'consent-index/1', entries: [] };
  for (const r of chain) {
    findings.push(...checkRecord(r, { recordLicenses: license.record, release: true }));
    findings.push(...checkLikenessRecord(r, consent, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')));
  }
  findings.push(...checkDerivation(chain));
  for (const s of own) {
    if (s.spec.likeness === undefined) findings.push(finding(GATE, s.specPath, 'likeness-missing', `${s.ref} has no likeness block`));
    else findings.push(...checkLikenessSummary(s.ref, s.spec.likeness));
    for (const f of s.files) {
      let cur = bySha.get(f.sha256);
      const seen = new Set<string>();
      while (cur !== undefined && cur.origin === 'derived' && !seen.has(cur.sha256)) {
        seen.add(cur.sha256);
        cur = bySha.get((cur.derived_from[0] ?? '').replace(/^sha256:/, ''));
      }
      if (cur === undefined || (cur.origin !== 'generated' && cur.origin !== 'authored')) findings.push(finding(GATE, f.path, 'chain-root', 'the provenance chain does not end in a generated or authored root'));
    }
  }
  notes.push(`A8: ${chain.length} provenance records on the chain`);
  return { findings, notes };
}

/** Records of the character's files and every ancestor. */
function collectChain(own: readonly LoadedSpec[], bySha: ReadonlyMap<string, ProvenanceRecord>): ProvenanceRecord[] {
  const out = new Map<string, ProvenanceRecord>();
  const visit = (sha: string): void => {
    const r = bySha.get(sha);
    if (r === undefined || out.has(sha)) return;
    out.set(sha, r);
    for (const p of r.derived_from) visit(p.replace(/^sha256:/, ''));
  };
  for (const s of own) for (const f of s.files) visit(f.sha256);
  return [...out.values()];
}
