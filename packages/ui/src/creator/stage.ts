/**
 * The creator stage (10-ui-pages.md section 2.8): the preview on the shared canvas through the menu scene. The drawing lives in the engine
 * (`@dv/engine/client/creator-stage`, which owns three and the `bay_rig_v1` mannequin); the UI sees only this port and the pure mapping
 * from an avatar to mannequin variant parameters. Parts without a `model` render as mannequin variants (height, build, palette tints).
 */
import { CATALOG, findPart, type CreatorCatalog, type CreatorSlot, type PlayerAvatar } from './catalog.ts';

export interface MannequinParams {
  /** Vertical scale of the whole figure, 0.92 .. 1.08. */
  heightScale: number;
  /** Horizontal scale, 0.9 .. 1.18. */
  buildScale: number;
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  /** Hair style index (1-based, catalog order): the stage picks a cap shape from it. */
  hairStyle: number;
  accessory: boolean;
  /** The face preset index shifts the head scale a little so every preset reads differently. */
  faceIndex: number;
  /** The part model of each slot and how it draws (M10d4): `model`, `fallback` (a Coast row's same-slot realistic row) or `mannequin`. */
  parts: StagePart[];
  /** The face morph weights of the avatar by catalog morph id. */
  morphs: Partial<Record<string, number>>;
  accessoryColor: number;
}

export type StageSlot = Extract<CreatorSlot, 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory'>;
export interface StagePart {
  slot: StageSlot;
  /** The part's `character/pc-…` ref; empty for the mannequin path. */
  ref: string;
  path: 'model' | 'fallback' | 'mannequin';
}

const MODEL_SLOTS: readonly StageSlot[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessory'];

/**
 * How each chosen part draws (10-ui-pages.md 2.8 rules 3 and 6). A row with a `model` draws it. A Coast row without one draws its
 * `fallbackPart` (hair, tops, bottoms, shoes, accessories), tinted with the Coast row's own colour; the Coast body and face stay on the
 * mannequin path, and the stage draws the mannequin whenever the body or the face is on it.
 */
export function stageParts(a: PlayerAvatar, cat: CreatorCatalog = CATALOG): StagePart[] {
  const ids: Record<StageSlot, string | undefined> = {
    body: a.body.preset, face: a.face.preset, hair: a.hair.style, top: a.outfit.top, bottom: a.outfit.bottom, shoes: a.outfit.shoes, accessory: a.outfit.accessory,
  };
  const out: StagePart[] = [];
  for (const slot of MODEL_SLOTS) {
    const id = ids[slot];
    if (id === undefined) continue;
    const row = findPart(cat, slot, id);
    if (row?.model) {
      out.push({ slot, ref: row.model, path: 'model' });
      continue;
    }
    const fb = slot !== 'body' && slot !== 'face' && row?.fallbackPart ? findPart(cat, slot, row.fallbackPart) : undefined;
    if (fb?.model) out.push({ slot, ref: fb.model, path: 'fallback' });
    else out.push({ slot, ref: '', path: 'mannequin' });
  }
  return out;
}

export type StageZoom = 'full' | 'head';

/** What the page needs from the stage. The app supplies it when the engine has a renderer host; a missing port shows the page without a preview. */
export interface CreatorStagePort {
  show(params: MannequinParams): void;
  setZoom(zoom: StageZoom): void;
  /** Turntable drag, radians. */
  rotate(dyaw: number): void;
  /** No auto-rotation under reduced motion. */
  setReducedMotion(on: boolean): void;
  /** The URL of a card portrait (`portrait/pc-<part>`); null when the asset is not available. Absent on a stage without an asset port. */
  portrait?(ref: string): Promise<string | null>;
  hide(): void;
}

function hex(s: string): number {
  return Number.parseInt(s.replace('#', ''), 16);
}

/** HSL to 0xRRGGBB for the mannequin tints (hue 0..1). */
export function tintColor(h: number, s: number, l: number): number {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to = (x: number): number => Math.round(x * 255);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

export function mannequinParams(a: PlayerAvatar, cat: CreatorCatalog = CATALOG): MannequinParams {
  const tint = (slot: 'top' | 'bottom' | 'shoes', id: string, s: number, l: number): number => {
    const part = findPart(cat, slot, id);
    return part?.color !== undefined ? hex(part.color) : tintColor(part?.tint ?? 0, s, l);
  };
  return {
    heightScale: 0.92 + 0.16 * a.body.height,
    buildScale: 0.9 + 0.28 * a.body.build,
    skin: hex(cat.palettes.skin[a.skinTone] ?? cat.palettes.skin[0] ?? '#cccccc'),
    hair: hex(cat.palettes.hair[a.hair.color] ?? cat.palettes.hair[0] ?? '#222222'),
    top: tint('top', a.outfit.top, 0.55, 0.5),
    bottom: tint('bottom', a.outfit.bottom, 0.4, 0.32),
    shoes: tint('shoes', a.outfit.shoes, 0.2, 0.75),
    hairStyle: findPart(cat, 'hair', a.hair.style)?.index ?? 1,
    accessory: a.outfit.accessory !== undefined,
    faceIndex: findPart(cat, 'face', a.face.preset)?.index ?? 1,
    parts: stageParts(a, cat),
    morphs: a.face.morphs,
    accessoryColor: ((): number => {
      const part = findPart(cat, 'accessory', a.outfit.accessory);
      return part?.color !== undefined ? hex(part.color) : tintColor(part?.tint ?? 0, 0.5, 0.5);
    })(),
  };
}
