import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { decodeAppearance, encodeAppearance, fromBase64, toBase64 } from '../src/creator/appearance.ts';
import {
  CATALOG, CREATOR_SLOTS, DEFAULT_AVATAR, checkName, defaultAvatar, mulberry32, normalizeAvatar, partOf, partsOf, randomize, sameAvatar, withPart,
  type PlayerAvatar,
} from '../src/creator/catalog.ts';
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
    const counts: Record<string, number> = { body: 12, face: 24, hair: 16, top: 12, bottom: 8, shoes: 6, accessory: 8, voice: 8 };
    for (const slot of CREATOR_SLOTS) {
      const rows = CATALOG.slots[slot];
      expect(new Set(rows.map((r) => r.index)).size, slot).toBe(rows.length);
      expect(new Set(rows.map((r) => r.id)).size, slot).toBe(rows.length);
      if (counts[slot]) expect(rows.length, slot).toBe(counts[slot]);
      for (const r of rows) {
        expect(validatePart({ slot, ...r }), `${slot}/${r.id} ${JSON.stringify(validatePart.errors)}`).toBe(true);
        expect((en as Record<string, string>)[r.titleKey], r.titleKey).toBeTypeOf('string');
      }
    }
    expect(CATALOG.palettes.skin).toHaveLength(12);
    expect(CATALOG.palettes.hair).toHaveLength(12);
    expect(CATALOG.morphs.length).toBeLessThanOrEqual(24);
    expect(CATALOG.slots.hair.length * CATALOG.palettes.hair.length).toBe(192);
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
    expect(checkName('  Dee  ')).toEqual({ ok: true, name: 'Dee' });
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
  callsign: 'Rookie',
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
    expect(Array.from(bytes)).toEqual([1, 1, 1, 0, 3, 204, 64, 3, 5, 4, 9, 6, 3, 2, 3, 6, 193, 2, 3, 1, 64, 3, 129, 23, 127]);
    expect(toBase64(bytes)).toBe('AQEBAAPMQAMFBAkGAwIDBsECAwFAA4EXfw==');
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
    expect(partsOf(CATALOG, 'body').length).toBe(12);
  });
});
