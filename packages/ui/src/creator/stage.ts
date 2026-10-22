/**
 * The creator stage (10-ui-pages.md section 2.8): the preview on the shared canvas through the menu scene. The drawing lives in the engine
 * (`@dv/engine/client/creator-stage`, which owns three and the `bay_rig_v1` mannequin); the UI sees only this port and the pure mapping
 * from an avatar to mannequin variant parameters. Parts without a `model` render as mannequin variants (height, build, palette tints).
 */
import { CATALOG, findPart, type CreatorCatalog, type PlayerAvatar } from './catalog.ts';

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
  const tint = (slot: 'top' | 'bottom' | 'shoes', id: string, s: number, l: number): number => tintColor(findPart(cat, slot, id)?.tint ?? 0, s, l);
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
  };
}
