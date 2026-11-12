/**
 * BD-FIX-CREATOR-SHOES-02: an assembly that throws after a figure is on stage. The replaced figure is disposed exactly once (the
 * stage forgets it before assembling the next, so the fallback's `dropFigure` cannot dispose it again), the stage shows the mannequin
 * and ends `pending`, and a later pick assembles again. A rejected atlas read is asked again on the next pick.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Assemble from '../src/client/avatar/assemble.ts';

const ctl = vi.hoisted(() => ({ throwNext: false, disposed: [] as number[], built: 0 }));

vi.mock('../src/client/avatar/assemble.ts', async (importOriginal) => {
  const real = await importOriginal<typeof Assemble>();
  return {
    ...real,
    assembleAvatar: (...args: Parameters<typeof real.assembleAvatar>) => {
      if (ctl.throwNext) {
        ctl.throwNext = false;
        throw new Error('assembly failed');
      }
      const fig = real.assembleAvatar(...args);
      const id = ++ctl.built;
      const dispose = fig.dispose.bind(fig);
      fig.dispose = () => {
        ctl.disposed.push(id);
        dispose();
      };
      return fig;
    },
  };
});

const { createCreatorStage } = await import('../src/client/creator-stage.ts');
type StageParams = Parameters<ReturnType<typeof createCreatorStage>['show']>[0];
type StagePart = NonNullable<StageParams['parts']>[number];

const repo = path.resolve(import.meta.dirname, '../../..');
const bytes = (ref: string): Uint8Array => new Uint8Array(readFileSync(path.join(repo, 'assets/src/character', ref.replace('character/', ''), 'mobile.glb')));
const model = (slot: StagePart['slot'], id: string): StagePart => ({ slot, ref: `character/pc-${id}`, path: 'model' });
const params = (parts: StagePart[]): StageParams => ({
  heightScale: 1, buildScale: 1, skin: 0xc58c5f, hair: 0x2a1c14, top: 0x141414, bottom: 0x262c3f, shoes: 0x8b8e93, hairStyle: 1, accessory: false, faceIndex: 1, parts,
});
const host = { setMenuScene: vi.fn(), clearMenuScene: vi.fn() };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  ctl.throwNext = false;
  ctl.disposed.length = 0;
  ctl.built = 0;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('creator stage, assembly failures', () => {
  it('a throw while replacing a figure disposes the old one once, shows the mannequin, and a later pick assembles again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stage = createCreatorStage(host, { load: async (ref) => bytes(ref) });
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl')]));
    await settle();
    expect(stage.state.figure).toBe('models');
    expect(ctl.built).toBe(1);

    ctl.throwNext = true;
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl'), model('shoes', 'shoes-boots')]));
    await settle();
    expect(ctl.disposed).toEqual([1]);
    expect(stage.state.figure).toBe('mannequin');
    expect(stage.state.triangles).toBe(0);
    expect(stage.state.pending).toBe(false);
    expect(warn).toHaveBeenCalledOnce();

    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl'), model('shoes', 'shoes-sneakers')]));
    await settle();
    expect(stage.state.figure).toBe('models');
    expect(stage.state.pending).toBe(false);
    expect(ctl.built).toBe(2);
    expect(ctl.disposed).toEqual([1]);
  });

  it('a rejected atlas read is asked again on the next pick', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let asks = 0;
    const stage = createCreatorStage(host, {
      load: async (ref) => bytes(ref),
      texture: () => {
        asks++;
        if (asks <= 3) throw new Error('texture port broken'); // the first read of the three pages
        return Promise.resolve(null);
      },
    });
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl')]));
    await settle();
    expect(stage.state.figure).toBe('mannequin');
    expect(stage.state.pending).toBe(false);
    stage.show(params([model('body', 'body-athletic'), model('face', 'face-karl'), model('shoes', 'shoes-boots')]));
    await settle();
    expect(asks).toBeGreaterThan(1);
    expect(stage.state.figure).toBe('models');
    expect(stage.state.pending).toBe(false);
  });
});
