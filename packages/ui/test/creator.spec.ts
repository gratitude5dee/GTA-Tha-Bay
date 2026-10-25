import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { decodeAppearance, encodeAppearance, fromBase64, toBase64 } from '../src/creator/appearance.ts';
import {
  CATALOG, CREATOR_SLOTS, DEFAULT_AVATAR, cardsOf, checkName, defaultAvatar, mulberry32, normalizeAvatar, pairConsistent, partOf, partsOf,
  pickPart, randomize, realisticDefault, sameAvatar, withPart, type PlayerAvatar,
} from '../src/creator/catalog.ts';
import { mannequinParams } from '../src/creator/stage.ts';
import en from '../../../content/ui/i18n/en.json';

const repo = path.resolve(import.meta.dirname, '../../..');
const read = (p: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(repo, p), 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateAvatar = ajv.compile(read('packages/shared/schemas/ui/avatar.v1.schema.json'));
const validatePart = ajv.compile(read('packages/shared/schemas/ui/wardrobe-item.v1.schema.json'));

describe('creator catalog and schemas (AC-1)', () => {
  it('defaults.json validates against avatar.v1 and names live parts only', () => {
    expect(validateAvatar(DEFAULT_AVATAR), JSON.stringify(validateAvatar.errors)).toBe(true);
    expect(normalizeAvatar(DEFAULT_AVATAR).fallbacks).toEqual([]);
    expect(CATALOG.defaults).toEqual(DEFAULT_AVATAR);
  });

  it('every catalog row validates, indexes are unique per slot, the counts follow 2.8, title keys exist', () => {
    // The realistic kit keeps the 2.8 counts; the Coast set adds one row to each of six slots (2.8 rule 6, DL-737).
    const counts: Record<string, number> = { body: 12, face: 24, hair: 16, top: 12, bottom: 8, shoes: 6, accessory: 8, voice: 8 };
    const coast: Record<string, number> = { body: 1, face: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
    for (const slot of CREATOR_SLOTS) {
      const rows = CATALOG.slots[slot];
      expect(new Set(rows.map((r) => r.index)).size, slot).toBe(rows.length);
      expect(new Set(rows.map((r) => r.id)).size, slot).toBe(rows.length);
      const kit = rows.filter((r) => !r.tags.includes('coast'));
      expect(rows.length - kit.length, slot).toBe(coast[slot] ?? 0);
      if (counts[slot]) expect(kit.length, slot).toBe(counts[slot]);
      for (const r of rows) {
        expect(validatePart({ slot, ...r }), `${slot}/${r.id} ${JSON.stringify(validatePart.errors)}`).toBe(true);
        expect((en as Record<string, string>)[r.titleKey], r.titleKey).toBeTypeOf('string');
      }
    }
    expect(CATALOG.palettes.skin).toHaveLength(12);
    expect(CATALOG.palettes.hair).toHaveLength(12);
    expect(CATALOG.morphs.length).toBeLessThanOrEqual(24);
    expect(CATALOG.slots.hair.filter((r) => !r.tags.includes('coast')).length * CATALOG.palettes.hair.length).toBe(192);
  });

  it('an unknown or retired part loads the slot default, and the avatar never fails to load', () => {
    const retired = structuredClone(CATALOG);
    retired.slots.hair[3]!.retired = true;
    const a = withPart(defaultAvatar(), 'hair', retired.slots.hair[3]!.id);
    const n = normalizeAvatar(a, retired);
    expect(n.avatar.hair.style).toBe(retired.defaults.hair.style);
    expect(n.fallbacks).toContain('hair');
    const bad = normalizeAvatar({ body: { preset: 'nope' }, outfit: { top: 7, accessory: 'ghost' }, voice: { id: null, pitch: 9 } });
    expect(bad.avatar.body.preset).toBe(CATALOG.defaults.body.preset);
    expect(bad.avatar.outfit.top).toBe(CATALOG.defaults.outfit.top);
    expect(bad.avatar.outfit.accessory).toBeUndefined();
    expect(bad.avatar.voice.pitch).toBe(1);
    expect(validateAvatar(bad.avatar)).toBe(true);
    for (const junk of [null, 5, 'x', [], {}]) expect(validateAvatar(normalizeAvatar(junk).avatar)).toBe(true);
  });

  it('name rules: NFC, trimmed, 1 to 24 characters from the allowed set', () => {
    expect(checkName('  Coast  ')).toEqual({ ok: true, name: 'Coast' });
    expect(checkName('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkName('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkName('x'.repeat(25))).toEqual({ ok: false, problem: 'long' });
    expect(checkName('x'.repeat(24)).ok).toBe(true);
    expect(checkName('Bad<Name>')).toEqual({ ok: false, problem: 'chars' });
    expect(checkName("O'Neil-Jr._9").ok).toBe(true);
    expect(checkName('é')).toEqual({ ok: true, name: 'é' });
  });

  it('randomize yields valid, live-part avatars and keeps the name', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 25; i++) {
      const a = randomize({ ...defaultAvatar(), name: 'Kept' }, rand);
      expect(a.name).toBe('Kept');
      expect(validateAvatar(a)).toBe(true);
      expect(normalizeAvatar(a).fallbacks).toEqual([]);
    }
  });
});

const sample: PlayerAvatar = {
  v: 1,
  name: 'Golden',
  callsign: 'Coast',
  body: { preset: 'body-athletic', height: 0.8, build: 0.25 },
  face: { preset: 'face-mission', morphs: { 'brow-height': 0.5, 'eye-size': -1, smile: 1 } },
  skinTone: 5,
  hair: { style: 'hair-waves', color: 9 },
  outfit: { top: 'top-bomber', bottom: 'bottom-cargo', shoes: 'shoes-boots', accessory: 'acc-shades' },
  voice: { id: 'voice-deep', pitch: -0.5 },
  fightStyle: 'style-kicker',
};

describe('AppearanceV1 (AC-1)', () => {
  it('encodes the golden vector exactly and decodes it back', () => {
    const bytes = encodeAppearance(sample);
    // Catalog rev 2 (the Coast rows, DL-737) is the only change: offset 2 carries catalogRev, every part index byte is unchanged.
    expect(Array.from(bytes)).toEqual([1, 1, 2, 0, 3, 204, 64, 3, 5, 4, 9, 6, 3, 2, 3, 6, 193, 2, 3, 1, 64, 3, 129, 23, 127]);
    expect(toBase64(bytes)).toBe('AQECAAPMQAMFBAkGAwIDBsECAwFAA4EXfw==');
    // Against the rev-1 catalog header the bytes are the pre-Coast golden vector exactly.
    expect(Array.from(encodeAppearance(sample, { ...CATALOG, rev: 1 }))).toEqual([1, 1, 1, 0, 3, 204, 64, 3, 5, 4, 9, 6, 3, 2, 3, 6, 193, 2, 3, 1, 64, 3, 129, 23, 127]);
    expect(toBase64(encodeAppearance(sample, { ...CATALOG, rev: 1 }))).toBe('AQEBAAPMQAMFBAkGAwIDBsECAwFAA4EXfw==');
    const back = decodeAppearance(bytes, CATALOG, 'Golden');
    expect(back.body.preset).toBe('body-athletic');
    expect(back.body.height).toBeCloseTo(0.8, 2);
    expect(back.face.morphs['eye-size']).toBeCloseTo(-1, 2);
    expect(back.outfit.accessory).toBe('acc-shades');
    expect(back.voice.pitch).toBeCloseTo(-0.5, 1);
    expect(encodeAppearance(back)).toEqual(bytes);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('a no-accessory, no-morph avatar is 19 bytes with flags 0', () => {
    const a = defaultAvatar();
    const bytes = encodeAppearance(a);
    expect(bytes.length).toBe(19);
    expect(bytes[1]).toBe(0);
    expect(bytes[14]).toBe(0);
    expect(encodeAppearance(decodeAppearance(bytes, CATALOG, a.name))).toEqual(bytes);
    expect(sameAvatar(a, a)).toBe(true);
  });

  it('24 morphs encode to 67 B, under the 512 B limit', () => {
    const morphs: Record<string, number> = {};
    for (const m of CATALOG.morphs) morphs[m.id] = 0.1;
    const bytes = encodeAppearance({ ...defaultAvatar(), face: { preset: 'face-sunset', morphs } });
    expect(CATALOG.morphs).toHaveLength(24);
    expect(bytes.length).toBe(67);
    expect(bytes.length).toBeLessThanOrEqual(512);
    expect(toBase64(bytes).length).toBeLessThanOrEqual(92);
  });

  it('a wrong length or an unknown version returns the catalog default', () => {
    const good = encodeAppearance(sample);
    const def = defaultAvatar();
    expect(decodeAppearance(good.slice(0, good.length - 1)).body).toEqual(def.body);
    expect(decodeAppearance(new Uint8Array(0))).toEqual(def);
    const v2 = Uint8Array.from(good);
    v2[0] = 2;
    expect(decodeAppearance(v2)).toEqual(def);
    const long = new Uint8Array(513);
    long[0] = 1;
    expect(decodeAppearance(long)).toEqual(def);
  });

  it('an index above the catalog or a retired part renders the slot default', () => {
    const bytes = Uint8Array.from(encodeAppearance(sample));
    bytes[4] = 200;
    expect(decodeAppearance(bytes).body.preset).toBe(CATALOG.defaults.body.preset);
    const retired = structuredClone(CATALOG);
    retired.slots.top.find((p) => p.id === 'top-bomber')!.retired = true;
    expect(decodeAppearance(encodeAppearance(sample), retired).outfit.top).toBe(retired.defaults.outfit.top);
  });

  it('every slot has a default part', () => {
    for (const slot of CREATOR_SLOTS) if (slot !== 'accessory') expect(partOf(defaultAvatar(), slot), slot).toBeTruthy();
    expect(partsOf(CATALOG, 'body').length).toBe(13);
  });
});

describe('the Coast set (10-ui-pages.md 2.8 rule 6, DL-OWN-05, DL-737)', () => {
  const COAST = { body: 'body-coast', face: 'face-coast', hair: 'hair-coast', top: 'top-coast-hoodie', bottom: 'bottom-coast-jeans', shoes: 'shoes-coast-sneakers' } as const;

  it('is the default: name and callsign Coast, the six Coast rows, the sheet palette', () => {
    const d = defaultAvatar();
    expect(d.name).toBe('Coast');
    expect(d.callsign).toBe('Coast');
    expect(DEFAULT_AVATAR.name).toBe('Coast');
    expect(d.body.preset).toBe(COAST.body);
    expect(d.face.preset).toBe(COAST.face);
    expect(d.hair.style).toBe(COAST.hair);
    expect(d.outfit).toEqual({ top: COAST.top, bottom: COAST.bottom, shoes: COAST.shoes });
    expect(CATALOG.palettes.skin[d.skinTone]).toBe('#87502f');
    expect(CATALOG.palettes.hair[d.hair.color]).toBe('#0f0b09');
    expect(CATALOG.rev).toBe(2);
  });

  it('rows are appended with new indices, tagged starter, without a model (mannequin path), with i18n titles', () => {
    const before: Record<string, number> = { body: 12, face: 24, hair: 16, top: 12, bottom: 8, shoes: 6 };
    for (const [slot, id] of Object.entries(COAST) as [keyof typeof COAST, string][]) {
      const rows = CATALOG.slots[slot];
      const row = rows.find((r) => r.id === id)!;
      expect(row, id).toBeDefined();
      expect(row.index, id).toBe(before[slot]! + 1);
      expect(rows.indexOf(row), id).toBe(rows.length - 1);
      expect(row.tags, id).toContain('starter');
      expect(row.model, id).toBeUndefined();
      expect((en as Record<string, string>)[row.titleKey], id).toMatch(/^Coast/);
      // Existing rows keep their indices 1..n in catalog order.
      expect(rows.slice(0, -1).map((r) => r.index), slot).toEqual(Array.from({ length: before[slot]! }, (_, i) => i + 1));
    }
  });

  it('each Coast row is the first card of its tab; the other cards keep catalog order', () => {
    for (const [slot, id] of Object.entries(COAST) as [keyof typeof COAST, string][]) {
      const cards = cardsOf(CATALOG, slot);
      expect(cards[0]?.id, slot).toBe(id);
      expect(cards.slice(1).map((p) => p.id), slot).toEqual(partsOf(CATALOG, slot).filter((p) => p.id !== id).map((p) => p.id));
    }
    expect(cardsOf(CATALOG, 'accessory').map((p) => p.id)).toEqual(partsOf(CATALOG, 'accessory').map((p) => p.id));
  });

  it('body-coast and face-coast are a linked pair: picking either selects both', () => {
    const real = pickPart(pickPart(defaultAvatar(), 'body', 'body-broad'), 'face', 'face-mission');
    expect([real.body.preset, real.face.preset]).toEqual(['body-broad', 'face-mission']);
    const viaBody = pickPart(real, 'body', COAST.body);
    expect([viaBody.body.preset, viaBody.face.preset]).toEqual([COAST.body, COAST.face]);
    const viaFace = pickPart(real, 'face', COAST.face);
    expect([viaFace.body.preset, viaFace.face.preset]).toEqual([COAST.body, COAST.face]);
  });

  it('picking another body or face row while the pair is set leaves the other slot for the realistic default', () => {
    expect(realisticDefault(CATALOG, 'body')).toBe('body-lean');
    expect(realisticDefault(CATALOG, 'face')).toBe('face-sunset');
    const d = defaultAvatar();
    const b = pickPart(d, 'body', 'body-broad');
    expect([b.body.preset, b.face.preset]).toEqual(['body-broad', 'face-sunset']);
    const f = pickPart(d, 'face', 'face-mission');
    expect([f.body.preset, f.face.preset]).toEqual(['body-lean', 'face-mission']);
    // Unlinked picks with no pair set change only their own slot.
    const g = pickPart(b, 'face', 'face-mission');
    expect([g.body.preset, g.face.preset]).toEqual(['body-broad', 'face-mission']);
  });

  it('Coast hair and outfit rows fit any body', () => {
    const real = pickPart(defaultAvatar(), 'body', 'body-broad');
    const a = pickPart(pickPart(pickPart(pickPart(real, 'hair', COAST.hair), 'top', COAST.top), 'bottom', COAST.bottom), 'shoes', COAST.shoes);
    expect([a.body.preset, a.face.preset]).toEqual(['body-broad', 'face-sunset']);
    expect(a.hair.style).toBe(COAST.hair);
    expect(a.outfit).toMatchObject({ top: COAST.top, bottom: COAST.bottom, shoes: COAST.shoes });
    const back = pickPart(pickPart(defaultAvatar(), 'hair', 'hair-waves'), 'top', 'top-bomber');
    expect([back.body.preset, back.face.preset]).toEqual([COAST.body, COAST.face]);
  });

  it('a half pair loads repaired: a linked body brings its face, a linked face on a realistic body leaves for the realistic face', () => {
    const half1 = normalizeAvatar({ ...defaultAvatar(), face: { preset: 'face-mission', morphs: {} } });
    expect(half1.avatar.face.preset).toBe(COAST.face);
    expect(half1.fallbacks).toContain('face');
    const half2 = normalizeAvatar({ ...defaultAvatar(), body: { preset: 'body-broad', height: 0.5, build: 0.5 } });
    expect([half2.avatar.body.preset, half2.avatar.face.preset]).toEqual(['body-broad', 'face-sunset']);
    expect(validateAvatar(half2.avatar)).toBe(true);
    expect(normalizeAvatar(defaultAvatar()).fallbacks).toEqual([]);
  });

  it('Randomize draws the pair only as a pair, and draws it sometimes', () => {
    const rand = mulberry32(11);
    let pairs = 0;
    for (let i = 0; i < 400; i++) {
      const a = randomize(defaultAvatar(), rand);
      expect(pairConsistent(a), JSON.stringify([a.body.preset, a.face.preset])).toBe(true);
      expect(normalizeAvatar(a).fallbacks).toEqual([]);
      if (a.body.preset === COAST.body) {
        expect(a.face.preset).toBe(COAST.face);
        pairs++;
      } else expect(a.face.preset).not.toBe(COAST.face);
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('the default avatar encodes the Coast indices and round-trips', () => {
    const d0 = defaultAvatar();
    const bytes = encodeAppearance(d0);
    expect([bytes[4], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13]]).toEqual([13, 25, 6, 17, 0, 13, 9, 7]);
    const back = decodeAppearance(bytes, CATALOG, 'Coast');
    expect([back.body.preset, back.face.preset, back.hair.style, back.outfit]).toEqual([d0.body.preset, d0.face.preset, d0.hair.style, d0.outfit]);
    expect(encodeAppearance(back)).toEqual(bytes);
  });

  it('renders on the mannequin path: a part colour overrides the tint (black hoodie, dark jeans, grey sneakers, warm brown skin)', () => {
    const m = mannequinParams(defaultAvatar());
    expect(m.top).toBe(0x141414);
    expect(m.bottom).toBe(0x262c3f);
    expect(m.shoes).toBe(0x8b8e93);
    expect(m.skin).toBe(0x87502f);
    expect(m.hair).toBe(0x0f0b09);
    // Rows without a colour keep their tint.
    expect(mannequinParams(withPart(defaultAvatar(), 'top', 'top-hoodie')).top).not.toBe(0x141414);
  });
});
