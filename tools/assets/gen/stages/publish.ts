/**
 * Stage 8, `publish` (local): the asset specs, the optimized files and the provenance chain written into the repository for the lock PR,
 * gate A8 over them, then H5 (the PR review of the lock diff). `assets:verify --slug` and `assets:publish --slug` take it from here.
 *
 * Records: a generated root per vendor output (sheet, portrait, mouth atlas, mesh, rigged model) with the full generator block, and a
 * derived record per optimized file (`tool: assets:optimize`, `derived_from` the rigged model), so every chain ends in a generated root.
 * A mock run writes the same records with `executor: mock`, which `provenance:check` refuses by design: it can never be published.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AssetKind, AssetRef, KindExtras, LikenessSummary, VariantId, VariantStats } from '../../../../packages/shared/src/assets/c07.ts';
import type { ProvenanceRecord } from '../../../../packages/shared/src/assets/provenance.ts';
import { checkLikenessSummary } from '../../../../packages/shared/src/assets/gates/index.ts';
import { canonicalize } from '../../../../packages/shared/src/json.ts';
import { sha256Hex as sha256String } from '../../../../packages/shared/src/hash.ts';
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';
import { approvedDecision, type ReviewEntry, type StageResult } from '../../../../services/pipeline/src/steps/character.ts';
import { evaluateA8, type GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { FIDELITY_VARIANT, TOOL_NAME, TOOL_VERSION } from '../../src/optimize.ts';
import { sha256, type StageContext } from './context.ts';
import type { CropsOutcome } from './crops.ts';
import type { MeshOutcome } from './mesh.ts';
import type { OptOutcome } from './optimize.ts';
import type { PaidOk } from './portrait.ts';
import type { RigOutcome } from './rig.ts';

export interface PublishPort {
  write(rel: string, bytes: Uint8Array): void;
  exists(rel: string): boolean;
}

export function fsPublisher(root: string): PublishPort {
  return {
    write(rel, bytes) {
      const f = path.join(root, rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, bytes);
    },
    exists: (rel) => existsSync(path.join(root, rel)),
  };
}

export interface PublishInput {
  crops: Extract<CropsOutcome, { kind: 'ok' }>;
  sheet: { bytes: Uint8Array; result: StageResult; job: GenJob };
  portrait: PaidOk | null;
  atlas: PaidOk | null;
  mesh: Extract<MeshOutcome, { kind: 'ok' }>;
  pick: number;
  rig: Extract<RigOutcome, { kind: 'ok' }>;
  opt: Extract<OptOutcome, { kind: 'ok' }>;
  h4: ReviewEntry;
}

export type PublishOutcome = { kind: 'ok'; summary: string; records: ProvenanceRecord[]; a8: GateReport } | { kind: 'failed'; detail: string };

/** Recursively key-sorted JSON, two-space indent, trailing newline: the layout of the committed records. */
export function sortedJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, val]) => [k, sort(val)]));
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

export async function runPublish(ctx: StageContext, i: PublishInput): Promise<PublishOutcome> {
  const { cfg, subject, ports } = ctx.deps;
  const cls = subject.hero ? 'class:hero' : 'class:npc';
  const at = ctx.now();
  const h2 = approvedDecision(ctx.run, 'H2');
  const reviews = ctx.run.review.map((r) => ({ gate: r.gate, by: r.by, at: r.at, decision: r.decision, ...(r.note !== undefined ? { note: r.note } : {}) }));
  const held = ctx.reportNames.length > 0 && (await heldAnywhere(ctx));

  const likeness: LikenessSummary = {
    tier: subject.tier, subjectId: null, soulVersion: subject.soulVersion, faceReferenceUsed: false, voiceMode: 'none', photoreal: false,
    ...(subject.standIn !== null ? { standIn: subject.standIn as AssetRef } : {}),
    disclaimer: subject.tier === 'original' ? 'none' : 'fictional',
  };
  const lf = checkLikenessSummary(`character/${subject.slug}`, likeness);
  if (lf.length > 0) return { kind: 'failed', detail: `publish: ${lf.map((f) => f.detail).join('; ')}` };

  const recLikeness = { subject_id: null, tier: subject.tier, face_reference_used: false, voice_mode: 'none' as const, photoreal: false };
  const base = (sha: string, paths: string[], kind: AssetKind): Omit<ProvenanceRecord, 'origin' | 'derived_from'> => ({
    schema: 'provenance/1.0', sha256: sha, paths, kind, license: 'LicenseRef-DeeVerse-Owned', authors: [`profile:${cfg.requestedBy}`],
    likeness: recLikeness, review: reviews, ip_checks: { signatures: 'n/a', strings: 'pass', similarity: 'n/a', vision: held ? 'review' : 'pass' },
    ai_generated: true, c2pa: 'absent', status: 'active', created_at: at,
  });
  const generated = (sha: string, paths: string[], kind: AssetKind, job: GenJob, result: StageResult): ProvenanceRecord => {
    const { prompt: _prompt, ...params } = job.params as Record<string, unknown>;
    void _prompt;
    const ep = cfg.registry.endpoints[job.endpointKey];
    return {
      ...base(sha, paths, kind), origin: 'generated', derived_from: [],
      generator: {
        vendor: 'fal', endpoint: job.endpointKey, endpoint_registry_key: job.endpointKey, endpoint_updated_at: ep?.pinnedUpdatedAt ?? null, request_id: result.requestId,
        seed: job.params['seed'] as number, job_key: job.jobKey, params_sha256: sha256String(canonicalize(params)), prompt_template: job.promptTemplate, prompt_sha256: job.promptSha256,
        input_refs: job.inputs.map((f) => `sha256:${f.sha256}`), terms_snapshot: cfg.termsSnapshot, cost_usd_micros: result.costUsdMicros, generated_at: result.generatedAt,
        executor: cfg.mode === 'mock' ? 'mock' : 'cli', env: cfg.mode === 'mock' ? 'test' : 'production',
      },
    };
  };
  const derived = (sha: string, paths: string[], kind: AssetKind, parent: string, args: unknown): ProvenanceRecord => ({
    ...base(sha, paths, kind), origin: 'derived', derived_from: [parent], tool: { name: TOOL_NAME, version: TOOL_VERSION, args_sha256: sha256String(canonicalize(args as never)) },
  });

  const records: ProvenanceRecord[] = [];
  const sheetSha = sha256(i.sheet.bytes);
  records.push(generated(sheetSha, [`PRIVATE/sheets/${subject.slug}/sheet.${sheetSha.slice(0, 12)}.png`], 'character_sheet', i.sheet.job, i.sheet.result));

  // portrait and mouth atlas (Standard) or the front crop (Lean)
  const files: { rel: string; bytes: Uint8Array }[] = [];
  let portraitSha: string;
  let portraitBytes: Uint8Array;
  if (i.portrait !== null) {
    const idx = Math.max(0, (h2?.choose ?? 1) - 1);
    const pf = i.portrait.files[idx] ?? i.portrait.files[0];
    if (pf === undefined) return { kind: 'failed', detail: 'publish: no portrait output' };
    portraitBytes = pf.bytes;
    portraitSha = pf.sha256;
    records.push(generated(portraitSha, [`assets/src/portrait/${subject.slug}/default.png`], 'portrait', i.portrait.job, i.portrait.result));
  } else {
    const front = i.crops.crops[0];
    if (front === undefined) return { kind: 'failed', detail: 'publish: no front crop' };
    portraitBytes = front.bytes;
    portraitSha = front.sha256;
    records.push(derived(portraitSha, [`assets/src/portrait/${subject.slug}/default.png`], 'portrait', sheetSha, { stage: 'crops', crop: 'front' }));
  }
  files.push({ rel: `assets/src/portrait/${subject.slug}/default.png`, bytes: portraitBytes });
  let atlasSha: string | null = null;
  if (i.atlas !== null) {
    const idx = Math.max(0, (h2?.atlas ?? h2?.choose ?? 1) - 1);
    const af = i.atlas.files[idx] ?? i.atlas.files[0];
    if (af === undefined) return { kind: 'failed', detail: 'publish: no mouth atlas output' };
    atlasSha = af.sha256;
    records.push(generated(af.sha256, [`assets/src/mouth_atlas/${subject.slug}/default.png`], 'mouth_atlas', i.atlas.job, i.atlas.result));
    files.push({ rel: `assets/src/mouth_atlas/${subject.slug}/default.png`, bytes: af.bytes });
  }

  // the chosen mesh and the rigged model: generated roots (private intermediates)
  const cand = i.mesh.candidates[i.rig.candidate];
  if (cand !== null && cand !== undefined && cand.glb !== null) {
    records.push(generated(cand.glb.sha256, [`PRIVATE/work/${subject.slug}/mesh.${cand.glb.sha256.slice(0, 12)}.glb`], 'character', cand.job, cand.result));
  }
  records.push(generated(i.rig.riggedSha256, [`PRIVATE/work/${subject.slug}/rigged.${i.rig.riggedSha256.slice(0, 12)}.glb`], 'character', i.rig.job, i.rig.result));

  // the optimized files: derived from the rigged model
  const variants: Partial<Record<VariantId, string>> = {};
  const stats: Partial<Record<VariantId, VariantStats>> = {};
  for (const v of i.opt.result.variants) {
    const id = FIDELITY_VARIANT[v.fidelity];
    const rel = `assets/src/character/${subject.slug}/${id}.glb`;
    variants[id] = rel;
    stats[id] = v.stats;
    files.push({ rel, bytes: v.glb });
    records.push(derived(v.sha256, [rel], 'character', i.rig.riggedSha256, { fidelity: v.fidelity, slug: subject.slug }));
  }
  let animRef: AssetRef | null = null;
  if (i.opt.result.anim !== null) {
    const rel = `assets/src/anim/${subject.slug}.base/default.glb`;
    const sha = sha256(i.opt.result.anim);
    files.push({ rel, bytes: i.opt.result.anim });
    records.push(derived(sha, [rel], 'anim', i.rig.riggedSha256, { slug: subject.slug, clips: i.opt.result.clips }));
    animRef = `anim/${subject.slug}.base` as AssetRef;
  }

  // A8 over what will be written
  const a8 = evaluateA8({ storedSha256: files.map((f) => sha256(f.bytes)), records, recordLicenses: cfg.recordLicenses, consent: cfg.consent, nowIso: at, mock: cfg.mode === 'mock' }, at);
  await ctx.writeReport(a8, 'publish-A8');
  if (a8.status === 'fail') return { kind: 'failed', detail: `publish: gate A8 failed: ${a8.findings.map((f) => `${f.rule} (${f.detail})`).join('; ')}` };

  // asset specs
  const portraitRef = `portrait/${subject.slug}` as AssetRef;
  const atlasRef = atlasSha === null ? null : (`mouth_atlas/${subject.slug}` as AssetRef);
  const tags = [`char:${subject.slug}`, cls];
  const specs: { rel: string; spec: unknown }[] = [];
  const deps = [animRef, portraitRef, atlasRef].filter((x): x is AssetRef => x !== null);
  const extras: KindExtras = {
    t: 'character', npcId: subject.slug, rigFamily: 'bay_rig_v1', heightM: subject.heightM,
    bones: { jaw: i.h4.data?.['jaw'] === true, fingers: i.h4.data?.['fingers'] === true },
    animSets: animRef === null ? [] : [animRef], portrait: portraitRef, ...(atlasRef !== null ? { mouthAtlas: atlasRef } : {}),
    ...(Array.isArray(i.h4.data?.['mouthAnchor']) && (i.h4.data?.['mouthAnchor'] as unknown[]).length === 3 ? { mouthAnchor: i.h4.data?.['mouthAnchor'] as [number, number, number] } : {}),
  };
  specs.push({ rel: `assets/src/character/${subject.slug}/asset.json`, spec: { kind: 'character', id: subject.slug, variants, deps, tags, extras, likeness, stats, codec: { mesh: 'meshopt' }, status: 'active', visibility: 'public' } });
  if (animRef !== null) specs.push({ rel: `assets/src/anim/${subject.slug}.base/asset.json`, spec: { kind: 'anim', id: `${subject.slug}.base`, variants: { default: `assets/src/anim/${subject.slug}.base/default.glb` }, deps: [], tags, likeness, status: 'active', visibility: 'public' } });
  specs.push({ rel: `assets/src/portrait/${subject.slug}/asset.json`, spec: { kind: 'portrait', id: subject.slug, variants: { default: `assets/src/portrait/${subject.slug}/default.png` }, deps: [], tags, likeness, status: 'active', visibility: 'public' } });
  if (atlasRef !== null) specs.push({ rel: `assets/src/mouth_atlas/${subject.slug}/asset.json`, spec: { kind: 'mouth_atlas', id: subject.slug, variants: { default: `assets/src/mouth_atlas/${subject.slug}/default.png` }, deps: [], tags, likeness, status: 'active', visibility: 'public' } });

  const summary = `${i.opt.result.variants.length} fidelities, ${i.opt.result.clips.length} clips, ${records.length} records, SSIM mid ${i.opt.ssimMid.toFixed(2)} lo ${i.opt.ssimLo.toFixed(2)}${cfg.publisher === null ? ', dry (no publisher)' : ''}`;
  if (cfg.publisher === null) {
    ports.log(`publish (dry): would write ${files.length} files, ${specs.length} specs, ${records.length} provenance records`);
    return { kind: 'ok', summary, records, a8 };
  }
  for (const f of files) cfg.publisher.write(f.rel, f.bytes);
  for (const s of specs) cfg.publisher.write(s.rel, enc(sortedJson(s.spec)));
  for (const r of records) cfg.publisher.write(`assets/provenance/${r.sha256.slice(0, 2)}/${r.sha256}.json`, enc(sortedJson(r)));
  return { kind: 'ok', summary, records, a8 };
}

/** True when any vision check of this run was held for the human gate. */
async function heldAnywhere(ctx: StageContext): Promise<boolean> {
  for (const name of ctx.reportNames) {
    const rep = await ctx.getJson<GateReport>(`work/character/${ctx.subject.slug}/reports/${name}.json`);
    if (rep?.status === 'held') return true;
  }
  return false;
}
