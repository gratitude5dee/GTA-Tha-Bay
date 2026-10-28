/**
 * The character pipeline end to end over MockFalPort and recorded fixture answers (M10a1 AC-4): every stage writes its gate report, the
 * provenance records chain to a generated root, a second run makes zero FalPort calls, and a 422 on the rig falls to the second mesh
 * candidate. Human gates are answered by fixture decisions between runs. Part of `pnpm check:pipeline`.
 */
import { describe, expect, it } from 'vitest';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { loadRun } from '../../../tools/assets/gen/executor.ts';
import type { VisionPort } from '../src/steps/gates.ts';
import { PORTRAIT_MICROS, stageDir } from '../src/steps/character.ts';
import { makeHarness, type Harness } from './helpers/character-harness.ts';

const reportNames = (h: Harness): string[] =>
  h.blob.keys(`work/character/${h.subject.slug}/reports/`).map((k) => k.replace(/^PRIVATE:work\/character\/[^/]+\/reports\//, '').replace(/\.json$/, '')).sort();

const records = (h: Harness): ProvenanceRecord[] =>
  [...h.published.entries()].filter(([k]) => k.startsWith('assets/provenance/')).map(([, v]) => JSON.parse(new TextDecoder().decode(v)) as ProvenanceRecord);

/** Walks a Standard character through every gate; `check` runs after each stage that waits for a human. */
async function walkStandard(h: Harness): Promise<void> {
  expect((await h.run('sheet')).gate).toBe('H0');
  await h.decide('H0');
  const afterSheet = await h.run('sheet');
  expect(afterSheet.status).toBe('awaiting');
  expect(afterSheet.gate).toBe('H1');
  await h.decide('H1', { choose: 2 });
  expect((await h.run('mesh')).gate).toBe('H2');
  await h.decide('H2', { choose: 1, atlas: 2 });
  expect((await h.run('mesh')).gate).toBe('H3');
  await h.decide('H3', { choose: 1 });
  expect((await h.run('rig')).gate).toBe('H4');
  await h.decide('H4', { choose: 1, data: { jaw: true, fingers: false, mouthAnchor: [0, 1.55, 0.09] } });
  const pub = await h.run('publish');
  expect(pub.gate, pub.detail).toBe('H5');
  await h.decide('H5');
}

describe('character pipeline, Standard tier (AC-4)', () => {
  it('runs from the tier check through publish, with every gate report and a provenance chain that ends in generated roots', async () => {
    const h = await makeHarness();
    await walkStandard(h);
    const done = await h.run('publish');
    expect(done.status).toBe('complete');
    expect(done.falCalls).toBe(0);

    // one sheet call, one portrait call, one atlas call, two mesh candidates, one rig
    expect(h.submits).toEqual([
      'openai/gpt-image-2.5/sunburst/edit', 'openai/gpt-image-2.5/sunburst/edit', 'openai/gpt-image-2.5/sunburst/edit',
      'meshy/v7.1/multi-image-to-3d', 'meshy/v7.1/multi-image-to-3d', 'fal-ai/meshy/rigging/multi-animation',
    ]);
    // spend: the registry prices of spec section 11, $3.67 in all
    expect(h.settled.reduce((n, s) => n + s.micros, 0)).toBe(3_666_590);
    expect(h.settled.filter((s) => s.micros === PORTRAIT_MICROS * 2)).toHaveLength(2);

    // every stage left a gate report beside its output
    const names = reportNames(h);
    for (const want of [
      'tier-check', 'sheet-1-A1', 'sheet-1-A2', 'sheet-2-A1', 'sheet-3-A2', 'crops-A1', 'portrait-1-A2', 'portrait-2-A2', 'mouth_atlas-1-A2', 'mouth_atlas-2-A2',
      'mesh-1-A3', 'mesh-2-A3', 'mesh-1-A2', 'mesh-2-A2', 'rig-A4', 'optimize-A6', 'optimize-A7', 'publish-A8',
    ]) expect(names, want).toContain(want);

    // the files the lock PR needs
    for (const rel of [
      'assets/src/character/fixture-mc/desktop.glb', 'assets/src/character/fixture-mc/mobile.glb', 'assets/src/character/fixture-mc/mobile-low.glb', 'assets/src/character/fixture-mc/asset.json',
      'assets/src/anim/fixture-mc.base/default.glb', 'assets/src/portrait/fixture-mc/default.png', 'assets/src/mouth_atlas/fixture-mc/default.png',
    ]) expect(h.published.has(rel), rel).toBe(true);

    // provenance: every derived record resolves to a generated root, mock records say so, the H4 data reached the spec
    const recs = records(h);
    const bySha = new Map(recs.map((r) => [r.sha256, r]));
    expect(recs.length).toBeGreaterThanOrEqual(8);
    for (const r of recs) {
      let cur: ProvenanceRecord | undefined = r;
      const seen = new Set<string>();
      while (cur !== undefined && cur.origin === 'derived') {
        expect(seen.has(cur.sha256)).toBe(false);
        seen.add(cur.sha256);
        cur = bySha.get(cur.derived_from[0] as string);
      }
      expect(cur?.origin, `${r.paths[0]} must chain to a generated root`).toBe('generated');
      expect(r.ai_generated).toBe(true);
      expect(r.likeness).toMatchObject({ tier: 'original', face_reference_used: false, photoreal: false });
    }
    const generated = recs.filter((r) => r.origin === 'generated');
    expect(generated.every((r) => r.generator?.executor === 'mock' && r.generator.env === 'test' && /^[0-9a-f]{64}$/.test(r.generator.job_key))).toBe(true);
    expect(generated.every((r) => r.generator?.input_refs.every((x) => /^sha256:[0-9a-f]{64}$/.test(x)))).toBe(true);
    const spec = JSON.parse(new TextDecoder().decode(h.published.get('assets/src/character/fixture-mc/asset.json'))) as { extras: { bones: { jaw: boolean }; mouthAnchor: number[]; heightM: number }; variants: Record<string, string>; tags: string[]; deps: string[] };
    expect(spec.extras.bones.jaw).toBe(true);
    expect(spec.extras.mouthAnchor).toEqual([0, 1.55, 0.09]);
    expect(spec.tags).toContain('char:fixture-mc');
    expect(Object.keys(spec.variants).sort()).toEqual(['desktop', 'mobile', 'mobile-low']);
    expect(spec.deps).toEqual(['anim/fixture-mc.base', 'portrait/fixture-mc', 'mouth_atlas/fixture-mc']);
    // review[] carries every human decision
    expect(recs.find((r) => r.kind === 'character')?.review.map((x) => x.gate)).toEqual(['H0', 'H1', 'H2', 'H3', 'H4', 'H5']);
  });

  it('makes zero FalPort calls on the second run, from a cold start of the executor over the same work files', async () => {
    const h = await makeHarness();
    await walkStandard(h);
    expect((await h.run('publish')).status).toBe('complete');
    const before = h.submits.length;
    const again = await h.run('publish');
    expect(again.status).toBe('complete');
    expect(again.falCalls).toBe(0);
    expect(h.submits.length).toBe(before);
    expect(h.recorder.count('submit')).toBe(6);
  });

  it('skips a stage whose result.json exists for its job key, also after the run record is gone', async () => {
    const h = await makeHarness();
    await h.decide('H0');
    expect((await h.run('sheet')).gate).toBe('H1');
    const calls = h.submits.length;
    expect(calls).toBe(1);
    // forget the run record: the files stay, so the sheet is a cache hit
    const run = await loadRun(h.blob, h.subject, '2026-10-27T00:00:00Z');
    expect(Object.keys(run.jobs)).toEqual(['sheet']);
    await h.blob.put('PRIVATE', `work/character/${h.subject.slug}/run.json`, new TextEncoder().encode(JSON.stringify({ ...run, review: [{ gate: 'H0', by: 'art-lead', at: '2026-10-27T12:30:00Z', decision: 'approve', choose: 1 }] })));
    expect((await h.run('sheet')).falCalls).toBe(0);
    expect(h.submits.length).toBe(calls);
    const key = run.jobs.sheet?.[0] as string;
    expect(await h.blob.head('PRIVATE', `${stageDir(h.subject.slug, 'sheet', key)}/result.json`)).not.toBeNull();
  });

  it('falls to the second mesh candidate when the rigger answers 422, and does not pay again for the refusal', async () => {
    const h = await makeHarness({ rigRefuses: ['model-1.glb'] });
    await h.decide('H0');
    await h.run('sheet');
    await h.decide('H1', { choose: 1 });
    await h.run('mesh');
    await h.decide('H2');
    await h.run('mesh');
    await h.decide('H3', { choose: 1 });
    const rig = await h.run('rig');
    expect(rig.gate).toBe('H4');
    expect(h.submits.filter((e) => e === 'fal-ai/meshy/rigging/multi-animation')).toHaveLength(2);
    expect(rig.run.rigRejected).toEqual([0]);
    // the refusal settled at 0; only the second rig call was charged: sheet + portrait + atlas + 2 meshes + one rig
    expect(h.settled.reduce((n, s) => n + s.micros, 0)).toBe(3_666_590);
    await h.decide('H4');
    await h.run('publish');
    await h.decide('H5');
    const fin = await h.run('publish');
    expect(fin.status, fin.detail).toBe('complete');
    // the rigged model hangs off the second candidate
    const recs = records(h);
    const mesh2 = recs.find((r) => r.paths[0]?.includes('/mesh.'));
    expect(mesh2?.generator?.seed).toBeDefined();
    // a rerun re-uses the cached refusal: zero calls
    const again = await h.run('publish');
    expect(again.falCalls).toBe(0);
  });

  it('hands the run to H4 when both mesh candidates are refused by the rigger', async () => {
    const h = await makeHarness({ rigRefuses: ['model-1.glb', 'model-2.glb'] });
    await h.decide('H0');
    await h.run('sheet');
    await h.decide('H1', { choose: 1 });
    await h.run('mesh');
    await h.decide('H2');
    await h.run('mesh');
    await h.decide('H3', { choose: 2 });
    const rig = await h.run('rig');
    expect(rig.status).toBe('awaiting');
    expect(rig.gate).toBe('H4');
    expect(rig.detail).toMatch(/Blender repair/);
    expect(rig.run.rigRejected.sort()).toEqual([0, 1]);
  });

  it('stops at every human gate until a decision is recorded, and never crosses one on its own', async () => {
    const h = await makeHarness();
    expect((await h.run('publish')).gate).toBe('H0');
    expect(h.submits).toHaveLength(0);
    await h.decide('H0');
    expect((await h.run('publish')).gate).toBe('H1');
    expect(h.submits).toHaveLength(1);
    // a rejection overrides an earlier approval
    await h.decide('H1', { choose: 1 });
    await h.decide('H1', { decision: 'reject', choose: 1 });
    expect((await h.run('publish')).gate).toBe('H1');
    expect(h.submits).toHaveLength(1);
  });

  it('refuses an H1 choice that points at a sheet which failed its gate, and holds the vision checks for the human when no model is wired', async () => {
    const strict: VisionPort = {
      check: (kind, _images, ctx) =>
        Promise.resolve(kind === 'A2' && ctx.label === 'sheet-1' ? { status: 'answered', fields: { apparent_minor: 'possible' } } : { status: 'held', reason: 'test' }),
    };
    const h = await makeHarness({ vision: strict });
    await h.decide('H0');
    const s = await h.run('sheet');
    expect(s.detail).toMatch(/2 of 3 usable/);
    await h.decide('H1', { choose: 1 });
    const next = await h.run('mesh');
    expect(next.gate).toBe('H1');
    expect(next.detail).toMatch(/not a usable sheet \(usable: 2, 3\)/);
    const rep = JSON.parse(new TextDecoder().decode((await h.blob.get('PRIVATE', `work/character/fixture-mc/reports/sheet-1-A2.json`)) as Uint8Array)) as { status: string; findings: { rule: string }[] };
    expect(rep.status).toBe('fail');
    expect(rep.findings[0]?.rule).toBe('apparent-minor');
    const held = JSON.parse(new TextDecoder().decode((await h.blob.get('PRIVATE', `work/character/fixture-mc/reports/sheet-2-A1.json`)) as Uint8Array)) as { status: string; notes: string[] };
    expect(held.status).toBe('held');
    expect(held.notes[0]).toMatch(/human gate decides/);
  });
});

describe('character pipeline, retakes', () => {
  it('a retake of a stage is a new seed and so a new job key: it calls again and the first result stays', async () => {
    const h = await makeHarness();
    await h.decide('H0');
    await h.run('sheet');
    expect(h.submits).toHaveLength(1);
    h.cfg.attempts = { sheet: 1 };
    const again = await h.run('sheet');
    expect(again.falCalls).toBe(1);
    expect(h.submits).toHaveLength(2);
    const run = await loadRun(h.blob, h.subject, '2026-10-27T00:00:00Z');
    expect(run.jobs.sheet).toHaveLength(2);
    h.cfg.attempts = {};
    expect((await h.run('sheet')).falCalls).toBe(0);
  });
});

describe('character pipeline, kill and gate refusals', () => {
  it('stops with KILLED when the character is killed between mesh and rig, and no later stage starts', async () => {
    const h = await makeHarness({ subject: { tier: 'parody', standIn: 'character/standin_rapper' } });
    await h.decide('H0');
    await h.run('sheet');
    await h.decide('H1', { choose: 1 });
    await h.run('mesh');
    await h.decide('H2');
    const mesh = await h.run('mesh');
    expect(mesh.gate).toBe('H3');
    await h.decide('H3', { choose: 1 });
    h.setKilled(['all']);
    const rig = await h.run('rig');
    expect(rig.status).toBe('refused');
    expect(rig.detail).toMatch(/^KILLED/);
    expect(h.submits.filter((e) => e.includes('rigging'))).toHaveLength(0);
    expect(rig.stage).toBe('tier-check');
  });
});

describe('character pipeline, Lean tier', () => {
  it('runs sheet, mesh and rig without a portrait or atlas, merges the base clips, and publishes three fidelities', async () => {
    const h = await makeHarness({ subject: { pipeline: 'lean', slug: 'lean-one' } });
    expect((await h.run('publish')).gate).toBe('H1');
    await h.decide('H1', { choose: 1 });
    expect((await h.run('publish')).gate).toBe('H3');
    await h.decide('H3', { choose: 2 });
    expect((await h.run('publish')).gate).toBe('H4');
    await h.decide('H4');
    expect((await h.run('publish')).gate).toBe('H5');
    await h.decide('H5');
    const done = await h.run('publish');
    expect(done.status).toBe('complete');
    expect(h.submits).toEqual(['google/nano-banana-2.1/edit', 'tripo3d/h3.1/multiview-to-3d', 'tripo3d/h3.1/multiview-to-3d', 'fal-ai/meshy/rigging']);
    expect(h.settled.reduce((n, s) => n + s.micros, 0)).toBe(1_052_000);
    expect(h.published.has('assets/src/mouth_atlas/lean-one/default.png')).toBe(false);
    expect(h.published.has('assets/src/portrait/lean-one/default.png')).toBe(true);
    const spec = JSON.parse(new TextDecoder().decode(h.published.get('assets/src/character/lean-one/asset.json'))) as { deps: string[] };
    expect(spec.deps).toEqual(['anim/lean-one.base', 'portrait/lean-one']);
    const rep = JSON.parse(new TextDecoder().decode((await h.blob.get('PRIVATE', 'work/character/lean-one/reports/rig-A4.json')) as Uint8Array)) as { notes: string[] };
    expect(rep.notes[0]).toMatch(/2 clips/);
  });
});
