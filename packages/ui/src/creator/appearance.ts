/**
 * `AppearanceV1` (10-ui-pages.md section 4.2): the binary look sent in C11 `EV Joined` / `Appearance`. Pure functions with golden
 * vectors in `packages/ui/test/creator.spec.ts`. 19 + 2n bytes for n morphs, so 24 morphs are 67 B (limit 512 B).
 *
 * | offset | type | field |
 * | 0 | u8 | version = 1 |
 * | 1 | u8 | flags (bit0: accessory present) |
 * | 2 | u16 le | catalogRev |
 * | 4 | u8 x4 | body.preset, body.height (0..255), body.build, face.preset |
 * | 8 | u8 x3 | skinTone, hair.style, hair.color |
 * | 11 | u8 x4 | top, bottom, shoes, accessory (0 none) |
 * | 15 | u8, i8, u8 | voice, pitch (-127..127), fightStyle |
 * | 18 | u8 | morph count n (<= 24) |
 * | 19 | n x (u8 morph index, i8 value) | face morphs, ascending by index |
 */
import {
  CATALOG, defaultAvatar, normalizeAvatar, partByIndex, findPart, type CreatorCatalog, type CreatorSlot, type PlayerAvatar,
} from './catalog.ts';

export const APPEARANCE_VERSION = 1;
export const APPEARANCE_MAX_BYTES = 512;
export const APPEARANCE_HEADER = 19;

const u8 = (x: number): number => Math.min(255, Math.max(0, Math.round(x)));
const i8 = (x: number): number => Math.min(127, Math.max(-127, Math.round(x)));

function indexOf(cat: CreatorCatalog, slot: CreatorSlot, id: string | undefined): number {
  return id === undefined ? 0 : (findPart(cat, slot, id)?.index ?? 0);
}

export function encodeAppearance(a: PlayerAvatar, cat: CreatorCatalog = CATALOG): Uint8Array {
  const morphs = cat.morphs
    .filter((m) => typeof a.face.morphs[m.id] === 'number')
    .sort((x, y) => x.index - y.index)
    .slice(0, 24);
  const out = new Uint8Array(APPEARANCE_HEADER + morphs.length * 2);
  const dv = new DataView(out.buffer);
  out[0] = APPEARANCE_VERSION;
  out[1] = a.outfit.accessory !== undefined ? 1 : 0;
  dv.setUint16(2, cat.rev, true);
  out[4] = indexOf(cat, 'body', a.body.preset);
  out[5] = u8(a.body.height * 255);
  out[6] = u8(a.body.build * 255);
  out[7] = indexOf(cat, 'face', a.face.preset);
  out[8] = u8(a.skinTone);
  out[9] = indexOf(cat, 'hair', a.hair.style);
  out[10] = u8(a.hair.color);
  out[11] = indexOf(cat, 'top', a.outfit.top);
  out[12] = indexOf(cat, 'bottom', a.outfit.bottom);
  out[13] = indexOf(cat, 'shoes', a.outfit.shoes);
  out[14] = indexOf(cat, 'accessory', a.outfit.accessory);
  out[15] = indexOf(cat, 'voice', a.voice.id);
  dv.setInt8(16, i8(a.voice.pitch * 127));
  out[17] = indexOf(cat, 'fightStyle', a.fightStyle);
  out[18] = morphs.length;
  morphs.forEach((m, i) => {
    out[APPEARANCE_HEADER + i * 2] = m.index;
    dv.setInt8(APPEARANCE_HEADER + i * 2 + 1, i8((a.face.morphs[m.id] as number) * 127));
  });
  return out;
}

/**
 * Decodes bytes to an avatar. A wrong length or an unknown version returns the catalog default; an index above the local catalog or a
 * retired part renders the slot default. Names travel separately (`Joined.name`), so the caller passes it.
 */
export function decodeAppearance(bytes: Uint8Array, cat: CreatorCatalog = CATALOG, name?: string): PlayerAvatar {
  const fallback = (): PlayerAvatar => (name ? { ...defaultAvatar(cat), name } : defaultAvatar(cat));
  if (bytes.length < APPEARANCE_HEADER || bytes.length > APPEARANCE_MAX_BYTES || bytes[0] !== APPEARANCE_VERSION) return fallback();
  const n = bytes[18] as number;
  if (n > 24 || bytes.length !== APPEARANCE_HEADER + n * 2) return fallback();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (slot: CreatorSlot, i: number): string | undefined => {
    const p = partByIndex(cat, slot, bytes[i] as number);
    return p && p.retired !== true ? p.id : undefined;
  };
  const morphs: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const m = cat.morphs.find((x) => x.index === bytes[APPEARANCE_HEADER + i * 2]);
    if (m) morphs[m.id] = dv.getInt8(APPEARANCE_HEADER + i * 2 + 1) / 127;
  }
  const accessory = (bytes[1] as number) & 1 ? id('accessory', 14) : undefined;
  const raw = {
    v: 1,
    name: name ?? cat.defaults.name,
    callsign: cat.defaults.callsign,
    body: { preset: id('body', 4), height: (bytes[5] as number) / 255, build: (bytes[6] as number) / 255 },
    face: { preset: id('face', 7), morphs },
    skinTone: bytes[8],
    hair: { style: id('hair', 9), color: bytes[10] },
    outfit: { top: id('top', 11), bottom: id('bottom', 12), shoes: id('shoes', 13), ...(accessory ? { accessory } : {}) },
    voice: { id: id('voice', 15), pitch: dv.getInt8(16) / 127 },
    fightStyle: id('fightStyle', 17),
  };
  return normalizeAvatar(raw, cat).avatar;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  try {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}
