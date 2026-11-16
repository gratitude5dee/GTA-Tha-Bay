/**
 * The creator stage's figure against its latest `show` (BD-FIX-CREATOR-SHOES-01, CI run 41581312609): `state.pending` stays true until
 * the stage draws what the latest show asked for, and a part load started for an earlier avatar never draws over a later one.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleAvatar, type AssembledPart } from '../src/client/avatar/assemble.ts';
import { parsePersonGlb } from '../src/client/avatar/person-glb.ts';
import { createCreatorStage, type StageAssets, type StageParams, type StagePart } from '../src/client/creator-stage.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const bytes = (ref: string): Uint8Array => new Uint8Array(readFileSync(path.join(repo, 'assets/src/character', ref.replace('character/', ''), 'mobile.glb')));

/** An asset port whose loads the test releases one ref at a time. */
function heldAssets(): StageAssets & { release(ref: string): void; asked: string[] } {
  const waiting = new Map<string, () => void>();
  const asked: string[] = [];
  return {
    asked,
    load(ref) {
      asked.push(ref);
      return new Promise((resolve) => waiting.set(ref, () => resolve(bytes(ref))));
    },
    release(ref) {
      const go = waiting.get(ref);
      if (!go) throw new Error(`no load of ${ref} is waiting`);
      waiting.delete(ref);
      go();
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

const model = (slot: StagePart['slot'], id: string): StagePart => ({ slot, ref: `character/pc-${id}`, path: 'model' });
const params = (parts: StagePart[]): StageParams => ({
  heightScale: 1, buildScale: 1, skin: 0xc58c5f, hair: 0x2a1c14, top: 0x141414, bottom: 0x262c3f, shoes: 0x8b8e93, hairStyle: 1, accessory: false, faceIndex: 1, parts,
});
const host = { setMenuScene: vi.fn(), clearMenuScene: vi.fn() };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('creator stage', () => {
  it('keeps pending true while a changed part loads behind the earlier figure, then draws the figure of the latest parts', async () => {
    const assets = heldAssets();
    const stage = createCreatorStage(host, assets);
    const before = [model('body', 'body-athletic'), model('face', 'face-karl'), { slot: 'shoes', ref: 'character/pc-shoes-sneakers', path: 'fallback' } as StagePart];
    stage.show(params(before));
    expect(stage.state.pending).toBe(true);
    expect(stage.state.figure).toBe('mannequin');
    for (const p of before) assets.release(p.ref);
    await settle();
    expect(stage.state.pending).toBe(false);
    expect(stage.state.figure).toBe('models');
    const first = stage.state.triangles;

    // The CI failure: the boots arrive while the sneakers figure is on stage. The stage keeps that figure until the boots are in, and
    // says so: `figure` is still 'models', but of the earlier parts.
    const after = [model('body', 'body-athletic'), model('face', 'face-karl'), model('shoes', 'shoes-boots')];
    stage.show(params(after));
    await settle();
    expect(stage.state.parts).toEqual(after);
    expect(stage.state.figure).toBe('models');
    expect(stage.state.pending).toBe(true);
    expect(stage.state.triangles).toBe(first);
    assets.release('character/pc-shoes-boots');
    await settle();
    expect(stage.state.pending).toBe(false);
    const parts: AssembledPart[] = after.map((p) => ({ slot: p.slot, mesh: parsePersonGlb(bytes(p.ref)) }));
    expect(stage.state.triangles).toBe(assembleAvatar({ parts, colors: { skin: 0, hair: 0, top: 0, bottom: 0, shoes: 0, accessory: 0 } }).triangles);
    expect(assets.asked).toEqual([...before.map((p) => p.ref), 'character/pc-shoes-boots']);
  });

  it('a load started for an earlier avatar never draws over a later mannequin choice', async () => {
    const assets = heldAssets();
    const stage = createCreatorStage(host, assets);
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl')]));
    expect(stage.state.pending).toBe(true);
    // The Coast pair (no models yet): the mannequin, at once.
    const coast: StagePart[] = [{ slot: 'body', ref: '', path: 'mannequin' }, { slot: 'face', ref: '', path: 'mannequin' }];
    stage.show(params(coast));
    expect(stage.state.figure).toBe('mannequin');
    expect(stage.state.pending).toBe(false);
    // The earlier avatar's models arrive afterwards.
    assets.release('character/pc-body-athletic');
    assets.release('character/pc-face-karl');
    await settle();
    expect(stage.state.parts).toEqual(coast);
    expect(stage.state.figure).toBe('mannequin');
    expect(stage.state.triangles).toBe(0);
    expect(stage.state.pending).toBe(false);
  });

  it('a figure that cannot be assembled falls back to the mannequin and ends pending (BD-FIX-CREATOR-SHOES-02)', async () => {
    const assets = heldAssets();
    const broken: StageAssets = {
      load: (ref) => assets.load(ref),
      texture: () => {
        throw new Error('texture port broken');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stage = createCreatorStage(host, broken);
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl')]));
    expect(stage.state.pending).toBe(true);
    assets.release('character/pc-body-athletic');
    assets.release('character/pc-face-karl');
    await settle();
    expect(stage.state.pending).toBe(false);
    expect(stage.state.figure).toBe('mannequin');
    expect(stage.state.triangles).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('a hidden stage is not pending, and showing it again loads the latest parts', async () => {
    const assets = heldAssets();
    const stage = createCreatorStage(host, assets);
    const parts = [model('body', 'body-athletic'), model('face', 'face-karl')];
    stage.show(params(parts));
    stage.hide();
    expect(stage.state.pending).toBe(false);
    assets.release('character/pc-body-athletic');
    assets.release('character/pc-face-karl');
    await settle();
    expect(stage.state.figure).toBe('mannequin');
    stage.show(params(parts));
    await settle();
    expect(stage.state.pending).toBe(false);
    expect(stage.state.figure).toBe('models');
  });
});
