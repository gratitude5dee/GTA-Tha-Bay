/** M10d4 AC-7 (UI half): the creator catalog's models, portraits and Coast fallbacks, and how the stage resolves each part. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { encodeAppearance } from '../src/creator/appearance.ts';
import { CATALOG, CREATOR_SLOTS, DEFAULT_AVATAR, findPart, type CreatorCatalog, type CreatorPart, type CreatorSlot, type PlayerAvatar } from '../src/creator/catalog.ts';
import { mannequinParams, stageParts } from '../src/creator/stage.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const MODEL_SLOTS: CreatorSlot[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessory'];
const isCoast = (r: CreatorPart): boolean => r.tags.includes('coast');
const validatePart = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(path.join(repo, 'packages/shared/schemas/ui/wardrobe-item.v1.schema.json'), 'utf8')) as object);

const specOf = (ref: string): { variants: Record<string, string>; extras?: { portrait?: string } } | null => {
  const [kind, id] = ref.split('/') as [string, string];
  const file = path.join(repo, 'assets/src', kind, id, 'asset.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { variants: Record<string, string> }) : null;
};

const withoutCoastModels = (cat: CreatorCatalog): CreatorCatalog => {
  const out = structuredClone(cat);
  for (const slot of MODEL_SLOTS) for (const r of out.slots[slot]) if (isCoast(r)) delete r.model;
  return out;
};

const avatarWith = (patch: Partial<{ body: string; face: string; hair: string; top: string; bottom: string; shoes: string; accessory: string }>): PlayerAvatar => {
  const a = structuredClone(DEFAULT_AVATAR);
  if (patch.body) a.body.preset = patch.body;
  if (patch.face) a.face.preset = patch.face;
  if (patch.hair) a.hair.style = patch.hair;
  if (patch.top) a.outfit.top = patch.top;
  if (patch.bottom) a.outfit.bottom = patch.bottom;
  if (patch.shoes) a.outfit.shoes = patch.shoes;
  if (patch.accessory) a.outfit.accessory = patch.accessory;
  return a;
};

describe('every non-Coast row has a model and a portrait that resolve', () => {
  it('lists the 86 realistic rows of the seven slots, each with character/pc-<id> and portrait/pc-<id>', () => {
    let n = 0;
    for (const slot of MODEL_SLOTS) {
      for (const r of CATALOG.slots[slot].filter((x) => !isCoast(x))) {
        n++;
        expect(r.model, `${slot}/${r.id}`).toBe(`character/pc-${r.id}`);
        expect(r.portrait, `${slot}/${r.id}`).toBe(`portrait/pc-${r.id}`);
        expect(specOf(r.model as string), `${r.model} has no asset.json`).not.toBeNull();
        expect(specOf(r.portrait as string), `${r.portrait} has no asset.json`).not.toBeNull();
        expect(Object.keys(specOf(r.model as string)?.variants ?? {}).sort()).toEqual(['desktop', 'mobile', 'mobile-low']);
        expect(validatePart({ slot, ...r }), JSON.stringify(validatePart.errors)).toBe(true);
      }
    }
    expect(n).toBe(86);
  });

  it('keeps voice and fight-style rows as they were (no model)', () => {
    for (const slot of ['voice', 'fightStyle'] as CreatorSlot[]) for (const r of CATALOG.slots[slot]) expect(r.model).toBeUndefined();
  });
});

describe('the Coast rows', () => {
  const coastRows = MODEL_SLOTS.flatMap((slot) => CATALOG.slots[slot].filter(isCoast).map((r) => [slot, r] as const));

  it('keep their indices and each has a valid same-slot fallbackPart (a realistic row with a model)', () => {
    expect(coastRows.map(([, r]) => [r.id, r.index])).toEqual([
      ['body-coast', 13], ['face-coast', 25], ['hair-coast', 17], ['top-coast-hoodie', 13], ['bottom-coast-jeans', 9], ['shoes-coast-sneakers', 7],
    ]);
    for (const [slot, r] of coastRows) {
      const fb = findPart(CATALOG, slot, r.fallbackPart);
      expect(fb, `${r.id} fallbackPart ${r.fallbackPart}`).toBeDefined();
      expect(isCoast(fb as CreatorPart)).toBe(false);
      expect((fb as CreatorPart).model).toBeDefined();
      expect(validatePart({ slot, ...r }), JSON.stringify(validatePart.errors)).toBe(true);
      // where M10a2 has set a model it must resolve
      if (r.model !== undefined) expect(specOf(r.model), r.model).not.toBeNull();
    }
  });

  it('draws the Coast pair on the mannequin and Coast hair, hoodie, jeans and sneakers from their fallback (no Coast model yet)', () => {
    const cat = withoutCoastModels(CATALOG);
    const parts = stageParts(DEFAULT_AVATAR, cat);
    const by = (slot: string) => parts.find((p) => p.slot === slot);
    expect(by('body')).toEqual({ slot: 'body', ref: '', path: 'mannequin' });
    expect(by('face')).toEqual({ slot: 'face', ref: '', path: 'mannequin' });
    expect(by('hair')).toEqual({ slot: 'hair', ref: 'character/pc-hair-crop', path: 'fallback' });
    expect(by('top')).toEqual({ slot: 'top', ref: 'character/pc-top-hoodie', path: 'fallback' });
    expect(by('bottom')?.path).toBe('fallback');
    expect(by('shoes')?.path).toBe('fallback');
  });

  it('draws Coast hair and the hoodie from their fallback on a realistic body, and from their own model when M10a2 set one', () => {
    const a = avatarWith({ body: 'body-athletic', face: 'face-karl', hair: 'hair-coast', top: 'top-coast-hoodie' });
    const bare = stageParts(a, withoutCoastModels(CATALOG));
    expect(bare.find((p) => p.slot === 'body')?.path).toBe('model');
    expect(bare.find((p) => p.slot === 'hair')).toEqual({ slot: 'hair', ref: 'character/pc-hair-crop', path: 'fallback' });
    expect(bare.find((p) => p.slot === 'top')?.path).toBe('fallback');
    // a fixture where M10a2 has modelled the Coast pair and hair
    const modelled = structuredClone(CATALOG);
    for (const slot of MODEL_SLOTS) for (const r of modelled.slots[slot]) if (isCoast(r)) r.model = `character/pc-${r.id}`;
    const coastPair = stageParts(DEFAULT_AVATAR, modelled);
    expect(coastPair.map((p) => p.path)).toEqual(expect.not.arrayContaining(['mannequin']));
    expect(coastPair.find((p) => p.slot === 'body')).toEqual({ slot: 'body', ref: 'character/pc-body-coast', path: 'model' });
    expect(stageParts(a, modelled).find((p) => p.slot === 'hair')).toEqual({ slot: 'hair', ref: 'character/pc-hair-coast', path: 'model' });
  });

  it('tints a fallback with the Coast row colour through the mannequin params (the stage reads params.top)', () => {
    const p = mannequinParams(DEFAULT_AVATAR);
    expect(p.top).toBe(0x141414);
    expect(p.bottom).toBe(0x262c3f);
    expect(p.shoes).toBe(0x8b8e93);
    expect(p.parts.map((x) => x.slot)).toEqual(['body', 'face', 'hair', 'top', 'bottom', 'shoes']);
  });
});

describe('faces and the preview budget', () => {
  it('every face model carries the 24 morph targets of the catalog, in order', () => {
    const want = CATALOG.morphs.map((m) => m.target);
    expect(want).toHaveLength(24);
    for (const r of CATALOG.slots.face.filter((x) => !isCoast(x))) {
      const spec = specOf(r.model as string) as { variants: Record<string, string> };
      for (const rel of Object.values(spec.variants)) {
        const b = readFileSync(path.join(repo, rel));
        const len = b.readUInt32LE(12);
        const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as { meshes: { extras: { targetNames: string[] } }[] };
        expect(json.meshes[0]?.extras.targetNames, `${r.id} ${rel}`).toEqual(want);
      }
    }
  });

  it('sums a full avatar at the mid fidelity to at most 40,000 triangles with three textures of at most 1,024 px', () => {
    const a = avatarWith({ body: 'body-broad', face: 'face-haight', hair: 'hair-locs', top: 'top-raincoat', bottom: 'bottom-overalls', shoes: 'shoes-boots', accessory: 'acc-backpack' });
    let tris = 0;
    for (const p of stageParts(a)) {
      const spec = specOf(p.ref) as { variants: Record<string, string> };
      const s = JSON.parse(readFileSync(path.join(repo, path.dirname(spec.variants['mobile'] as string), 'asset.json'), 'utf8')) as { stats: Record<string, { tris: number; texMaxPx: number }> };
      tris += (s.stats['mobile'] as { tris: number }).tris;
      expect((s.stats['desktop'] as { texMaxPx: number }).texMaxPx).toBeLessThanOrEqual(1024);
    }
    expect(tris).toBeLessThanOrEqual(40_000);
    for (const page of ['pc.skin', 'pc.cloth', 'pc.hair']) expect(specOf(`texture/${page}`)).not.toBeNull();
  });
});

describe('AppearanceV1 is unchanged', () => {
  it('keeps the catalog rev and the M04b2 golden vector (offset 2 carries catalogRev)', () => {
    expect(CATALOG.rev).toBe(2);
    const sample = structuredClone(DEFAULT_AVATAR);
    const bytes = Array.from(encodeAppearance(sample, { ...CATALOG, rev: 1 }));
    expect(bytes[0]).toBe(1);
    expect(bytes[2]).toBe(1);
    for (const slot of CREATOR_SLOTS) expect(CATALOG.slots[slot].every((r) => r.index >= 1)).toBe(true);
  });
});
