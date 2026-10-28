/**
 * Gates A3 to A7 and the stage gate of the character pipeline (M10a1 AC-5 and AC-6). Good fixtures pass; each bad fixture fails with its
 * gate id. AC-6 drives the pipeline's own `assertStageAllowed` through the stages of a character.
 */
import { describe, expect, it } from 'vitest';
import denylistRaw from '../../../../../config/ip-denylist.json';
import { assertStageAllowed, type GateConfig, type GateStage } from '../../../../../services/pipeline/src/gate.ts';
import { GENAI_REGISTRY, PROMPT_LINT_CONFIG } from '../../../../../services/pipeline/src/registry.ts';
import type { RosterEntry } from '../../../../../services/pipeline/src/ports.ts';
import { buildStageJob, stagePlans, type CharacterSubject, type PaidStage } from '../../../../../services/pipeline/src/steps/character.ts';
import rigJson from '../../rig/bay_rig_v1.json';
import type { GenJob } from '../../genai/types.ts';
import {
  A7_SSIM_LO, A7_SSIM_MID, checkA3Mesh, checkA4Rig, checkA5Retarget, checkA6Budget, checkA7Visual, frameStats, gpuTexBytes, hipDrift, missingBones, ssim,
  type FidelityLimits, type MeshStats, type RigFamily, type RigStats,
} from './index.ts';

const rig = rigJson as unknown as RigFamily;
const HERO_HI: FidelityLimits = { tris: 30_000, maxTexPx: 2048, materials: 3, gpuTexBytes: 16_777_216, fileBytes: 6_291_456 };

const goodMesh: MeshStats = { validatorErrors: 0, triangles: 12_000, heightM: 1.75, facesPlusZ: true, maxTexPx: 2048, skins: 0 };
const goodRig: RigStats = { boneNames: rig.required, maxWeightSumDeviation: 0.001, maxInfluences: 4, clipCount: 5, tPoseRest: true };

describe('A3 mesh', () => {
  it('passes a good mesh', () => {
    expect(checkA3Mesh('m.glb', goodMesh, { targetTris: 12_000 })).toEqual([]);
  });
  it('fails 1.2 x the target triangles and a 2.4 m height', () => {
    const f = checkA3Mesh('m.glb', { ...goodMesh, triangles: 14_400, heightM: 2.4 }, { targetTris: 12_000 });
    expect(f.map((x) => `${x.gate}:${x.rule}`).sort()).toEqual(['A3:height', 'A3:triangles']);
  });
  it('fails validator errors, a back-facing model, a 4096 px texture and a skin', () => {
    const f = checkA3Mesh('m.glb', { ...goodMesh, validatorErrors: 2, facesPlusZ: false, maxTexPx: 4096, skins: 1 }, { targetTris: 12_000 });
    expect(f.map((x) => x.rule).sort()).toEqual(['facing', 'skin', 'texture', 'validator']);
  });
});

describe('A4 rig', () => {
  it('passes the required set with the exact clip count', () => {
    expect(checkA4Rig('r.glb', goodRig, rig, 5)).toEqual([]);
  });
  it('fails an unmapped bone and weights that sum to 0.9', () => {
    const f = checkA4Rig('r.glb', { ...goodRig, boneNames: rig.required.filter((b) => b !== 'l_toes'), maxWeightSumDeviation: 0.1 }, rig, 5);
    expect(f.map((x) => `${x.gate}:${x.rule}`).sort()).toEqual(['A4:bone-unmapped', 'A4:weights']);
    expect(missingBones(rig, rig.required.filter((b) => b !== 'l_toes'))).toEqual(['l_toes']);
  });
  it('maps vendor names through the alias table and nowhere else', () => {
    const table: RigFamily = { ...rig, aliases: { Hips: 'hips' } };
    expect(missingBones(table, ['Hips']).includes('hips')).toBe(false);
    expect(missingBones(rig, ['Hips']).includes('hips')).toBe(true);
  });
  it('fails five influences, a wrong clip count and a rest pose that is not a T-pose', () => {
    const f = checkA4Rig('r.glb', { ...goodRig, maxInfluences: 5, clipCount: 4, tPoseRest: false }, rig, 5);
    expect(f.map((x) => x.rule).sort()).toEqual(['clips', 'influences', 'rest-pose']);
  });
});

describe('A5 retarget', () => {
  it('passes a looping idle with 1 % drift and a closed pose', () => {
    expect(checkA5Retarget('c', { heightM: 1.75, hipDriftM: 0.0175, endPoseDistM: 0.004 })).toEqual([]);
  });
  it('fails 5 % hip drift', () => {
    const f = checkA5Retarget('c', { heightM: 1.75, hipDriftM: 0.0875, endPoseDistM: 0.004 });
    expect(f.map((x) => `${x.gate}:${x.rule}`)).toEqual(['A5:hip-drift']);
  });
  it('fails an end pose 2 cm from the start', () => {
    expect(checkA5Retarget('c', { heightM: 1.75, hipDriftM: 0, endPoseDistM: 0.02 }).map((x) => x.rule)).toEqual(['end-pose']);
  });
  it('measures the horizontal travel of the hips', () => {
    expect(hipDrift([[0, 1, 0], [0.3, 2, 0.4]])).toBeCloseTo(0.5, 6);
    expect(hipDrift([])).toBe(0);
  });
});

describe('A6 budget', () => {
  const ok = { tris: 28_000, maxTexPx: 2048, materials: 3, gpuTexBytes: 8_000_000, fileBytes: 5_000_000 };
  it('passes a Hero hi file inside its row', () => {
    expect(checkA6Budget('h.glb', 'hi', ok, HERO_HI)).toEqual([]);
  });
  it('fails a 4096 px texture', () => {
    const f = checkA6Budget('h.glb', 'hi', { ...ok, maxTexPx: 4096, gpuTexBytes: gpuTexBytes([4096]) }, HERO_HI);
    expect(f.map((x) => `${x.gate}:${x.rule}`).sort()).toEqual(['A6:gpu-bytes', 'A6:texture']);
  });
  it('counts ASTC 4x4 texels plus a third for mips', () => {
    expect(gpuTexBytes([1024])).toBe(Math.ceil((1024 * 1024 * 4) / 3));
  });
});

describe('A7 visual', () => {
  const frames = [{ meanLuma: 90, stdLuma: 40 }];
  it('passes SSIM 0.97 and 0.93 with live frames', () => {
    expect(checkA7Visual('c', { ssimMid: 0.97, ssimLo: 0.93, frames })).toEqual([]);
  });
  it('fails SSIM 0.80', () => {
    const f = checkA7Visual('c', { ssimMid: 0.8, ssimLo: 0.93, frames });
    expect(f.map((x) => `${x.gate}:${x.rule}`)).toEqual(['A7:ssim-mid']);
    expect(A7_SSIM_MID).toBe(0.93);
    expect(A7_SSIM_LO).toBe(0.88);
  });
  it('fails a black frame and an empty one', () => {
    const f = checkA7Visual('c', { ssimMid: 1, ssimLo: 1, frames: [{ meanLuma: 0, stdLuma: 0 }, { meanLuma: 120, stdLuma: 0.5 }] });
    expect(f.map((x) => x.rule)).toEqual(['frame-black', 'frame-empty']);
  });
  it('gives SSIM 1 for identical images and less for different ones', () => {
    const a = new Uint8Array(64 * 64).map((_, i) => (i % 64) * 4);
    const b = a.map((v, i) => (i % 7 === 0 ? 255 - v : v));
    expect(ssim(a, a, 64, 64)).toBeCloseTo(1, 9);
    expect(ssim(a, b, 64, 64)).toBeLessThan(0.9);
    expect(frameStats(new Uint8Array(100).fill(7))).toEqual({ meanLuma: 7, stdLuma: 0 });
  });
});

// ---- AC-6: assertStageAllowed at every stage ---------------------------------------------------------------------------------------

const subjectOf = (over: Partial<CharacterSubject> = {}): CharacterSubject => ({
  slug: 'fixture-mc', tier: 'parody', soulVersion: 1, visualBrief: 'Lean performer in a yellow jacket, round glasses and white sneakers.', heightM: 1.7, moves: [],
  standIn: 'character/standin_rapper', pipeline: 'standard', hero: false, killed: [], ...over,
});

const gateCfg = (over: Partial<GateConfig> = {}): GateConfig => ({ falMode: 'mock', environment: 'dev', registry: GENAI_REGISTRY, lint: PROMPT_LINT_CONFIG, ...over });

function jobFor(subject: CharacterSubject, stage: PaidStage, inputs: { role: string; sha256: string; origin: 'user_upload' | 'first_party_generated' }[] = []): GenJob {
  const plan = stagePlans(subject, GENAI_REGISTRY).find((p) => p.stage === stage);
  if (plan === undefined) throw new Error(`no ${stage} plan`);
  return buildStageJob({ subject, stage, plan, inputs, registry: GENAI_REGISTRY, requestedBy: 'test', env: 'test' });
}

function ports(entry: () => RosterEntry | null) {
  return {
    roster: { lookup: () => Promise.resolve(entry()) },
    flags: { killSwitches: () => Promise.resolve(new Set<string>()) },
    budget: { reserve: () => Promise.resolve({ ok: true, level: 0 as const }), settle: () => Promise.resolve(), level: () => Promise.resolve(0 as const) },
  };
}

describe('assertStageAllowed on the character stages (AC-6)', () => {
  const row = (killed: string[] = []): RosterEntry => ({ id: 'fixture-mc', tier: 'parody', soulVersion: 1, killed });

  it('passes a clean parody job at every stage', async () => {
    const s = subjectOf();
    for (const stage of ['tier-check', 'sheet', 'portrait', 'mouth_atlas', 'mesh', 'rig'] as GateStage[]) {
      const v = await assertStageAllowed(jobFor(s, 'sheet'), stage, ports(() => row()), gateCfg({ lintPrompt: () => ({ ok: true }) }));
      expect(v, stage).toEqual({ ok: true });
    }
  });

  it('refuses a user upload for a parody character with FACE_REF_FORBIDDEN', async () => {
    const job = jobFor(subjectOf(), 'sheet', [{ role: 'ref-1', sha256: 'a'.repeat(64), origin: 'user_upload' }]);
    const v = await assertStageAllowed(job, 'sheet', ports(() => row()), gateCfg());
    expect(v).toMatchObject({ ok: false, code: 'FACE_REF_FORBIDDEN' });
  });

  it('refuses a prompt that holds a registry alias with NAME_IN_PROMPT', async () => {
    const s = subjectOf({ visualBrief: 'Lean performer known as Zed Alias, in a yellow jacket and white sneakers.' });
    const cfg = gateCfg({ lint: { denylist: denylistRaw as never, banned: PROMPT_LINT_CONFIG.banned, displayNames: ['Zed Alias'] } });
    const v = await assertStageAllowed(jobFor(s, 'sheet'), 'sheet', ports(() => row()), cfg);
    expect(v).toMatchObject({ ok: false, code: 'NAME_IN_PROMPT' });
  });

  it('refuses with KILLED once a kill flag is set between mesh and rig, and no later stage starts', async () => {
    const s = subjectOf();
    let killed: string[] = [];
    const p = ports(() => row(killed));
    const started: string[] = [];
    for (const stage of ['sheet', 'mesh', 'rig', 'optimize', 'publish'] as GateStage[]) {
      const v = await assertStageAllowed(jobFor(s, 'sheet'), stage, p, gateCfg({ lintPrompt: () => ({ ok: true }) }));
      if (!v.ok) {
        expect(v.code).toBe('KILLED');
        break;
      }
      started.push(stage);
      if (stage === 'mesh') killed = ['all'];
    }
    expect(started).toEqual(['sheet', 'mesh']);
  });

  it('refuses an unknown roster entry and a minor with TIER_UNKNOWN', async () => {
    const s = subjectOf();
    expect(await assertStageAllowed(jobFor(s, 'sheet'), 'tier-check', ports(() => null), gateCfg())).toMatchObject({ ok: false, code: 'TIER_UNKNOWN' });
    expect(await assertStageAllowed(jobFor(s, 'sheet'), 'tier-check', ports(() => ({ ...row(), minor: true })), gateCfg())).toMatchObject({ ok: false, code: 'TIER_UNKNOWN' });
  });

  it('refuses a registry endpoint that is still pending once the job is production (the Lean mesher and rigger)', async () => {
    const lean = subjectOf({ pipeline: 'lean', tier: 'fictionalized' });
    const plan = stagePlans(lean, GENAI_REGISTRY).find((p) => p.stage === 'mesh') as never;
    const job = buildStageJob({ subject: lean, stage: 'mesh', plan, inputs: [], registry: GENAI_REGISTRY, requestedBy: 'test', env: 'production' });
    const v = await assertStageAllowed(job, 'mesh', ports(() => ({ id: 'fixture-mc', tier: 'fictionalized', soulVersion: 1, killed: [] })), gateCfg());
    expect(v).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
  });
});
