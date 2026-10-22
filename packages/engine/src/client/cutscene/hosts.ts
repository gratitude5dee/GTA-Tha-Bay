/**
 * Hosts and renditions of the CutscenePlayer (spec/domains/03-story-cutscenes.md section D7, table "Hosts and renditions per tier").
 * This milestone has the flat host (`dom-overlay`, the M04c `DomCutsceneHost`); the XR hosts come with M11b2. The player talks to
 * the ports below, so the unit tests drive it with fakes.
 */
import type { CutsceneHostKind, CutsceneManifest, Rendition } from '@dv/shared/contracts/c09-cutscene';
import { renditionType, type PickedRendition, type RenditionKey } from '../../platform/media/dom-host.ts';
import type { CutsceneConfig } from './triggers.ts';

/** What the player needs of a host. `DomCutsceneHost` satisfies it. */
export interface CutsceneHostPort {
  readonly kind: CutsceneHostKind;
  /** A clip (or the still of a stalled clip) covers the screen. */
  readonly visible: boolean;
  show(video: HTMLVideoElement): Promise<void>;
  hide(): Promise<void>;
  showCues(): void;
  hideCues(): void;
  holdStill(url: string): void;
  waitForTap(label: string, ms: number): Promise<boolean>;
}

/** What the player needs of the UI overlay (skip, subtitles, AI chip). `mountCutsceneOverlay` returns it. */
export interface OverlayPort {
  show(s: { aiGenerated: boolean; credit?: string; cues: readonly { startMs: number; endMs: number; text: string }[] }): void;
  setTime(ms: number): void;
  hide(): void;
}

/** What the player needs of the media budget. `MediaBudget` satisfies it. */
export interface BudgetPort {
  prepare(id: string, bytes: number): { ok: true } | { ok: false; reason: 'budget' };
  release(id: string): void;
  bytes(): number;
  /** The mobile media line in MB; null where the tier has none. */
  readonly limitMB: number | null;
}

export interface RenditionContext {
  dataSaver: boolean;
  /** Measured throughput in Mbps; null when unknown. */
  throughputMbps: number | null;
  screenHeightPx: number;
  baseUrl: string;
  cfg: CutsceneConfig;
  canPlayType(type: string): string;
}

/**
 * The renditions to try, best first: `v540` leads on data saver or measured throughput below the line; `v1080` leads on screens
 * of 1440 px and taller when the manifest has it; `v768` otherwise. Renditions whose codec `canPlayType` refuses are left out.
 */
export function renditionCandidates(manifest: Pick<CutsceneManifest, 'renditions'>, ctx: RenditionContext): PickedRendition[] {
  const low = ctx.dataSaver || (ctx.throughputMbps !== null && ctx.throughputMbps < ctx.cfg.dataSaverMbps);
  const wide = ctx.screenHeightPx >= ctx.cfg.v1080MinScreenHeightPx;
  const order: RenditionKey[] = low ? ['v540', 'v768', 'p720'] : wide ? ['v1080', 'v768', 'v540', 'p720'] : ['v768', 'v540', 'p720'];
  const out: PickedRendition[] = [];
  for (const key of order) {
    const r: Rendition | undefined = manifest.renditions[key];
    if (!r) continue;
    const type = renditionType(r);
    if (ctx.canPlayType(type) !== '') out.push({ key, rendition: r, url: `${ctx.baseUrl}${r.file}`, type });
  }
  return out;
}

/** The directory of a manifest URL, with a trailing slash. */
export function baseOf(manifestUrl: string): string {
  const i = manifestUrl.lastIndexOf('/');
  return i < 0 ? '' : manifestUrl.slice(0, i + 1);
}

/** True when taking `bytes` more would put the accounted media above `fraction` of the tier's line. */
export function overBudget(b: Pick<BudgetPort, 'bytes' | 'limitMB'>, bytes: number, fraction: number): boolean {
  return b.limitMB !== null && (b.bytes() + bytes) / (1024 * 1024) > b.limitMB * fraction;
}
