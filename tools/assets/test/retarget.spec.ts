/** assets:retarget: mannequin clips onto a character of another height (M10a1 AC-8). */
import { describe, expect, it } from 'vitest';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import type { RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { readGlb } from '../src/glb-inspect.ts';
import { retargetClips } from '../src/retarget.ts';
import { buildMannequin } from './helpers/mannequin.ts';

const rig = rigJson as unknown as RigFamily;

describe('assets:retarget', () => {
  it('keeps the clip names, holds the hips in place over a loop and ends where it began, on a shorter character', async () => {
    const clipsGlb = await buildMannequin({ clipsOnly: true, heightM: 1.75, clips: [{ name: 'idle_loop', seconds: 1 }, { name: 'guard_up', seconds: 0.5 }] });
    const targetGlb = await buildMannequin({ heightM: 1.5 });
    const r = await retargetClips({ clipsGlb, targetGlb, slug: 'short', heightM: 1.5, rig });
    expect(r.clips.map((c) => c.name)).toEqual(['idle_loop', 'guard_up']);
    expect(r.findings).toEqual([]);
    const idle = r.clips[0]!;
    expect(idle.stats.hipDriftM).toBeLessThanOrEqual(0.03 * 1.5);
    expect(idle.stats.endPoseDistM).toBeLessThanOrEqual(0.01);
    expect(idle.frames).toBeGreaterThanOrEqual(30);
    const doc = await readGlb(r.glb);
    expect(doc.getRoot().listAnimations().map((a) => a.getName())).toEqual(['idle_loop', 'guard_up']);
    expect(doc.getRoot().listAnimations().map((a) => (a.getExtras() as { frames: number }).frames)).toEqual(r.clips.map((c) => c.frames));
    expect(doc.getRoot().getExtras()).toMatchObject({ assetId: 'anim/short.moves', rig: 'bay_rig_v1' });
    // The hip height follows the target: 0.53 of 1.5 m, not of 1.75 m.
    const hipsTrack = doc.getRoot().listAnimations()[0]!.listChannels().find((c) => c.getTargetNode()?.getName() === 'hips' && c.getTargetPath() === 'translation')!;
    const first = hipsTrack.getSampler()!.getOutput()!.getElement(0, [0, 0, 0]);
    expect(first[1]).toBeCloseTo(0.53 * 1.5 * 1.01, 1);
  });

  it('fails gate A5 for a clip whose last pose is not its first', async () => {
    const clipsGlb = await buildMannequin({ clipsOnly: true, clips: [{ name: 'raise', seconds: 0.5, openEnd: true }] });
    const targetGlb = await buildMannequin({ heightM: 1.9 });
    const r = await retargetClips({ clipsGlb, targetGlb, slug: 'tall', heightM: 1.9, rig });
    expect(r.findings.some((f) => f.gate === 'A5' && f.rule === 'end-pose')).toBe(true);
  });

  it('reports a travelling clip as hip drift', async () => {
    const clipsGlb = await buildMannequin({ clipsOnly: true, clips: [{ name: 'step', seconds: 1, driftM: 0.4 }] });
    const targetGlb = await buildMannequin({ heightM: 1.75 });
    const r = await retargetClips({ clipsGlb, targetGlb, slug: 'drift', heightM: 1.75, rig });
    expect(r.findings.some((f) => f.gate === 'A5' && f.rule === 'hip-drift')).toBe(true);
  });
});
