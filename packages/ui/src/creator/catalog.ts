/**
 * The creator catalog and the avatar rules (10-ui-pages.md sections 2.8 and 4.1). The catalog is data (`content/ui/creator/catalog.json`);
 * `normalizeAvatar` is the loader rule: an unknown or retired part id loads the slot's default part, a value out of range is clamped, and
 * the avatar never fails to load. The Ajv schema (`packages/shared/schemas/ui/avatar.v1.schema.json`) is checked in the unit tests; the
 * client does not ship a schema validator.
 */
import catalogJson from '../../../../content/ui/creator/catalog.json';
import defaultsJson from '../../../../content/ui/creator/defaults.json';

export type PartId = string;
export type MorphId = string;
export type CreatorSlot = 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory' | 'voice' | 'fightStyle';
export const CREATOR_SLOTS: readonly CreatorSlot[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'voice', 'fightStyle'];

export interface PlayerAvatar {
  v: 1;
  name: string;
  callsign: string;
  body: { preset: PartId; height: number; build: number };
  face: { preset: PartId; morphs: Partial<Record<MorphId, number>> };
  skinTone: number;
  hair: { style: PartId; color: number };
  outfit: { top: PartId; bottom: PartId; shoes: PartId; accessory?: PartId };
  voice: { id: PartId; pitch: number };
  fightStyle: PartId;
  customLook?: { pipelineJobId: string; tier: 'fictionalized' };
}

export interface CreatorPart {
  id: PartId;
  index: number;
  titleKey: string;
  model?: string;
  portrait?: string;
  tags: string[];
  unlock?: string;
  retired?: boolean;
  /** Mannequin variant hue (0..1) for parts without a model. */
  tint?: number;
  /** Mannequin colour `#rrggbb` for parts without a model; overrides `tint` (the Coast palette, DL-737). */
  color?: string;
  /** Symbol id in `assets/creator-kit/icons.svg`. */
  icon?: string;
}

export interface CreatorCatalog {
  v: 1;
  rev: number;
  slots: Record<CreatorSlot, CreatorPart[]>;
  palettes: { skin: string[]; hair: string[] };
  morphs: { id: MorphId; index: number; titleKey: string; target: string }[];
  defaults: PlayerAvatar;
}

export const CATALOG: CreatorCatalog = catalogJson as unknown as CreatorCatalog;
export const DEFAULT_AVATAR: PlayerAvatar = defaultsJson as unknown as PlayerAvatar;

/** Name rules (10-ui-pages.md 2.8 rule 2): NFC, trimmed, 1 to 24 characters, letters, digits, space, - ' . _ */
export const NAME_MAX = 24;
const NAME_RE = /^[\p{L}\p{N} '._-]+$/u;
export type NameProblem = 'empty' | 'long' | 'chars';

export function checkName(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = raw.normalize('NFC').trim();
  if (name.length === 0) return { ok: false, problem: 'empty' };
  if ([...name].length > NAME_MAX) return { ok: false, problem: 'long' };
  if (!NAME_RE.test(name)) return { ok: false, problem: 'chars' };
  return { ok: true, name };
}

export function partsOf(cat: CreatorCatalog, slot: CreatorSlot): CreatorPart[] {
  return cat.slots[slot].filter((p) => p.retired !== true);
}

export function findPart(cat: CreatorCatalog, slot: CreatorSlot, id: string | undefined): CreatorPart | undefined {
  return id === undefined ? undefined : cat.slots[slot].find((p) => p.id === id);
}

export function partByIndex(cat: CreatorCatalog, slot: CreatorSlot, index: number): CreatorPart | undefined {
  return cat.slots[slot].find((p) => p.index === index);
}

/**
 * Card order of a tab (10-ui-pages.md 2.8 rule 6): the slot's default part leads, the other live parts follow in catalog order. Rows are
 * appended with new indices (AppearanceV1 stays byte-equal), so the order is a display rule, never a renumbering.
 */
export function cardsOf(cat: CreatorCatalog, slot: CreatorSlot): CreatorPart[] {
  const live = partsOf(cat, slot);
  const lead = slot === 'accessory' ? undefined : slotDefault(cat, slot);
  const first = live.find((p) => p.id === lead);
  return first ? [first, ...live.filter((p) => p !== first)] : live;
}

/** Linked body and face rows (rule 6): a `pair:<id>` tag on one body row and one face row. A stylized head never sits on a realistic body. */
const PAIR_PREFIX = 'pair:';
type PairSlot = 'body' | 'face';
const isPairSlot = (slot: CreatorSlot): slot is PairSlot => slot === 'body' || slot === 'face';
const otherOf = (slot: PairSlot): PairSlot => (slot === 'body' ? 'face' : 'body');

export function pairOf(part: CreatorPart | undefined): string | undefined {
  return part?.tags.find((t) => t.startsWith(PAIR_PREFIX))?.slice(PAIR_PREFIX.length);
}

/** The live partner of a linked row in the other pair slot, or undefined for an unlinked row. */
export function pairPartner(cat: CreatorCatalog, slot: PairSlot, id: PartId): PartId | undefined {
  const pair = pairOf(findPart(cat, slot, id));
  if (pair === undefined) return undefined;
  return partsOf(cat, otherOf(slot)).find((p) => pairOf(p) === pair)?.id;
}

/** The realistic kit's slot default: the first live row of the slot that belongs to no linked pair (body-lean, face-sunset). */
export function realisticDefault(cat: CreatorCatalog, slot: PairSlot): PartId | undefined {
  return partsOf(cat, slot).find((p) => pairOf(p) === undefined)?.id;
}

/** True when the avatar's body and face are not a half pair (both linked to the same pair, or both unlinked). */
export function pairConsistent(a: PlayerAvatar, cat: CreatorCatalog = CATALOG): boolean {
  return pairOf(findPart(cat, 'body', a.body.preset)) === pairOf(findPart(cat, 'face', a.face.preset));
}

/** The default part of a slot: the catalog default's part when it is live, else the first live part. */
export function slotDefault(cat: CreatorCatalog, slot: CreatorSlot): PartId | undefined {
  const d = cat.defaults;
  const id =
    slot === 'body' ? d.body.preset
    : slot === 'face' ? d.face.preset
    : slot === 'hair' ? d.hair.style
    : slot === 'voice' ? d.voice.id
    : slot === 'fightStyle' ? d.fightStyle
    : d.outfit[slot];
  const live = partsOf(cat, slot);
  return live.find((p) => p.id === id)?.id ?? live[0]?.id;
}

const clamp = (x: unknown, lo: number, hi: number, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
const obj = (x: unknown): Record<string, unknown> => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

export interface Normalized { avatar: PlayerAvatar; fallbacks: string[] }

/** Loads any stored value as a valid avatar; every slot that fell back is listed (the `ui.avatar.fallback` log). */
export function normalizeAvatar(raw: unknown, cat: CreatorCatalog = CATALOG): Normalized {
  const fallbacks: string[] = [];
  const r = obj(raw);
  const d = cat.defaults;
  const pick = (slot: CreatorSlot, id: unknown, optional = false): PartId | undefined => {
    if (optional && (id === undefined || id === null)) return undefined;
    const p = typeof id === 'string' ? findPart(cat, slot, id) : undefined;
    if (p && p.retired !== true) return p.id;
    fallbacks.push(slot);
    if (optional) return undefined;
    return slotDefault(cat, slot) ?? '';
  };
  const body = obj(r['body']);
  const face = obj(r['face']);
  const hair = obj(r['hair']);
  const outfit = obj(r['outfit']);
  const voice = obj(r['voice']);
  const morphIds = new Set(cat.morphs.map((m) => m.id));
  const morphs: Partial<Record<MorphId, number>> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj(face['morphs']))) {
    if (!morphIds.has(k) || typeof v !== 'number' || !Number.isFinite(v) || n >= 24) continue;
    morphs[k] = clamp(v, -1, 1, 0);
    n++;
  }
  const nm = typeof r['name'] === 'string' ? checkName(r['name']) : null;
  const cs = typeof r['callsign'] === 'string' ? checkName(r['callsign']) : null;
  const accessory = pick('accessory', outfit['accessory'], true);
  const avatar: PlayerAvatar = {
    v: 1,
    name: nm?.ok ? nm.name : d.name,
    callsign: cs?.ok ? cs.name : d.callsign,
    body: { preset: pick('body', body['preset']) ?? '', height: clamp(body['height'], 0, 1, d.body.height), build: clamp(body['build'], 0, 1, d.body.build) },
    face: { preset: pick('face', face['preset']) ?? '', morphs },
    skinTone: Math.round(clamp(r['skinTone'], 0, cat.palettes.skin.length - 1, d.skinTone)),
    hair: { style: pick('hair', hair['style']) ?? '', color: Math.round(clamp(hair['color'], 0, cat.palettes.hair.length - 1, d.hair.color)) },
    outfit: {
      top: pick('top', outfit['top']) ?? '',
      bottom: pick('bottom', outfit['bottom']) ?? '',
      shoes: pick('shoes', outfit['shoes']) ?? '',
      ...(accessory !== undefined ? { accessory } : {}),
    },
    voice: { id: pick('voice', voice['id']) ?? '', pitch: clamp(voice['pitch'], -1, 1, 0) },
    fightStyle: pick('fightStyle', r['fightStyle']) ?? '',
  };
  // Rule 6: a half pair is repaired. A linked body brings its face; a linked face on an unlinked body leaves for the realistic face.
  if (!pairConsistent(avatar, cat)) {
    const partner = pairPartner(cat, 'body', avatar.body.preset);
    avatar.face.preset = partner ?? realisticDefault(cat, 'face') ?? avatar.face.preset;
    fallbacks.push('face');
  }
  return { avatar, fallbacks };
}

export function defaultAvatar(cat: CreatorCatalog = CATALOG): PlayerAvatar {
  return normalizeAvatar(cat.defaults, cat).avatar;
}

/** Returns a new avatar with one slot set (part tabs and tests). */
export function withPart(a: PlayerAvatar, slot: CreatorSlot, id: PartId | undefined): PlayerAvatar {
  const next: PlayerAvatar = structuredClone(a);
  switch (slot) {
    case 'body': next.body.preset = id ?? a.body.preset; break;
    case 'face': next.face.preset = id ?? a.face.preset; break;
    case 'hair': next.hair.style = id ?? a.hair.style; break;
    case 'voice': next.voice.id = id ?? a.voice.id; break;
    case 'fightStyle': next.fightStyle = id ?? a.fightStyle; break;
    case 'accessory':
      if (id === undefined) delete next.outfit.accessory;
      else next.outfit.accessory = id;
      break;
    default: next.outfit[slot] = id ?? a.outfit[slot];
  }
  return next;
}

/**
 * A card pick in the creator (rule 6): like `withPart`, plus the body and face link. Picking a linked row selects its partner too;
 * picking an unlinked body or face row while a pair is set keeps the picked row and sets the other slot to the realistic kit's default.
 * Hair and outfit rows fit any body.
 */
export function pickPart(a: PlayerAvatar, slot: CreatorSlot, id: PartId | undefined, cat: CreatorCatalog = CATALOG): PlayerAvatar {
  const next = withPart(a, slot, id);
  if (!isPairSlot(slot) || id === undefined) return next;
  const other = otherOf(slot);
  const partner = pairPartner(cat, slot, id);
  if (partner !== undefined) return withPart(next, other, partner);
  const otherId = partOf(next, other);
  if (pairOf(findPart(cat, other, otherId)) !== undefined) return withPart(next, other, realisticDefault(cat, other));
  return next;
}

export function partOf(a: PlayerAvatar, slot: CreatorSlot): PartId | undefined {
  switch (slot) {
    case 'body': return a.body.preset;
    case 'face': return a.face.preset;
    case 'hair': return a.hair.style;
    case 'voice': return a.voice.id;
    case 'fightStyle': return a.fightStyle;
    case 'accessory': return a.outfit.accessory;
    default: return a.outfit[slot];
  }
}

/** A tiny seeded generator for Randomize (the creator is UI code, not sim code; any stream will do and tests pass their own). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Randomizes the look but keeps the name, callsign, voice id and fight style the player chose. */
export function randomize(a: PlayerAvatar, rand: () => number, cat: CreatorCatalog = CATALOG): PlayerAvatar {
  const pickOf = (slot: CreatorSlot): PartId => {
    const live = partsOf(cat, slot);
    return (live[Math.floor(rand() * live.length)] ?? live[0])?.id ?? '';
  };
  const morphs: Partial<Record<MorphId, number>> = {};
  for (const m of cat.morphs) if (rand() < 0.4) morphs[m.id] = Math.round((rand() * 2 - 1) * 100) / 100;
  // Rule 6: the linked pair is drawn only as a pair. The face draw always consumes one number, so the stream length does not depend on it.
  const body = pickOf('body');
  const faceDraw = rand();
  const partner = pairPartner(cat, 'body', body);
  const faces = partsOf(cat, 'face').filter((p) => pairOf(p) === undefined);
  const face = partner ?? (faces[Math.floor(faceDraw * faces.length)] ?? faces[0])?.id ?? '';
  const out: PlayerAvatar = {
    ...structuredClone(a),
    body: { preset: body, height: Math.round(rand() * 100) / 100, build: Math.round(rand() * 100) / 100 },
    face: { preset: face, morphs },
    skinTone: Math.floor(rand() * cat.palettes.skin.length),
    hair: { style: pickOf('hair'), color: Math.floor(rand() * cat.palettes.hair.length) },
    outfit: { top: pickOf('top'), bottom: pickOf('bottom'), shoes: pickOf('shoes') },
  };
  if (rand() < 0.5) out.outfit.accessory = pickOf('accessory');
  return out;
}

/** Deep equality for the look fields (the Undo history skips no-op edits). */
export function sameAvatar(a: PlayerAvatar, b: PlayerAvatar): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return x;
}

/** Undo and Redo for the creator: up to `limit` steps (20), a new edit clears the redo branch, a no-op edit is not recorded. */
export class EditHistory {
  private past: PlayerAvatar[] = [];
  private future: PlayerAvatar[] = [];
  constructor(private current: PlayerAvatar, private readonly limit = 20) {}

  get value(): PlayerAvatar {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private lastKey = '';
  private lastAt = 0;

  /**
   * Records an edit. Returns true when it changed anything. Edits with the same `key` within `windowMs` of each other (a slider drag)
   * replace the newest step instead of adding one.
   */
  push(next: PlayerAvatar, key = '', now = 0, windowMs = 600): boolean {
    if (sameAvatar(next, this.current)) return false;
    const merge = key !== '' && key === this.lastKey && now - this.lastAt < windowMs && this.past.length > 0;
    this.lastKey = key;
    this.lastAt = now;
    if (merge) {
      this.future = [];
      this.current = next;
      return true;
    }
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return true;
  }

  undo(): PlayerAvatar {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.current);
      this.current = prev;
    }
    return this.current;
  }

  redo(): PlayerAvatar {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
