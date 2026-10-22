/**
 * The flat DOM cutscene host (`CutsceneHostKind 'dom-overlay'`, 03-story-cutscenes.md section D7). It mounts a pooled `<video>` above
 * the canvas on black (`object-fit: contain`), stops the render loop and pauses the sim while the clip covers the screen, keeps the
 * GPU resources resident (nothing is disposed), holds a screen wake lock on mobile tiers, and undoes all of it on `hide`. Releasing
 * the element drops its decoder: `removeAttribute('src'); load()`.
 */
import type { CutsceneManifest, Rendition } from '@dv/shared/contracts/c09-cutscene';
import type { ScreenWakeLock } from './wake-lock.ts';

/** The part of the RendererHost the host drives; the real host satisfies it. */
export interface LoopControl {
  stopLoop(): void;
  startLoop(): void;
}
/** The part of the engine handle the host drives; `EngineHandle` satisfies it. */
export interface SimPause {
  readonly paused: boolean;
  setPaused(paused: boolean): void;
}
export interface HostElement {
  appendChild(child: unknown): unknown;
  removeChild(child: unknown): unknown;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: object;
}

export type RenditionKey = 'v540' | 'v768' | 'v1080' | 'p720';
export interface PickedRendition { key: RenditionKey; rendition: Rendition; url: string; type: string }

/** The MIME type to ask `canPlayType` about: the container from the file extension, the codec string from the manifest. */
export function renditionType(r: Rendition): string {
  const container = r.file.endsWith('.webm') ? 'video/webm' : r.file.endsWith('.mp4') ? 'video/mp4' : 'video/mp4';
  return `${container}; codecs="${r.codecs}"`;
}

/**
 * First rendition whose type `canPlayType` accepts, preferring `v768` (`v540` first on data saver). `baseUrl` is the directory of the
 * manifest (ends with a slash). Null when none plays: the caller falls back with trigger `codec`.
 */
export function pickRendition(
  manifest: Pick<CutsceneManifest, 'renditions'>,
  canPlayType: (type: string) => string,
  opts: { dataSaver: boolean; baseUrl: string },
): PickedRendition | null {
  const order: RenditionKey[] = opts.dataSaver ? ['v540', 'v768', 'v1080', 'p720'] : ['v768', 'v540', 'v1080', 'p720'];
  for (const key of order) {
    const rendition = manifest.renditions[key];
    if (!rendition) continue;
    const type = renditionType(rendition);
    if (canPlayType(type) !== '') return { key, rendition, url: `${opts.baseUrl}${rendition.file}`, type };
  }
  return null;
}

export interface DomHostOptions {
  parent: HostElement;
  createElement: (tag: string) => HostElement;
  loop: LoopControl;
  sim: SimPause;
  /** Quality tier id; a wake lock is held on `mobile-*` tiers only. */
  tier: string;
  wakeLock?: ScreenWakeLock | null;
  /** Sets `data-dv-cutscene` on the document element so that the HUD hides (10-ui-hud-xr.md section 1). */
  root?: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
}

export class DomCutsceneHost {
  readonly kind = 'dom-overlay' as const;
  /** Where the UI overlay (skip, subtitles, AI chip) mounts: above the video, inside the host layer. */
  readonly overlayRoot: HostElement;
  private readonly layer: HostElement;
  private shown: HTMLVideoElement | null = null;
  private simWasPaused = false;
  private mobile: boolean;

  constructor(private readonly opts: DomHostOptions) {
    this.mobile = opts.tier.startsWith('mobile');
    this.layer = opts.createElement('div');
    this.layer.setAttribute('class', 'dv-cutscene-host');
    this.layer.setAttribute('data-testid', 'cutscene-host');
    Object.assign(this.layer.style, { position: 'fixed', inset: '0', background: '#000', zIndex: '40' });
    this.overlayRoot = opts.createElement('div');
    this.overlayRoot.setAttribute('class', 'dv-cutscene-ui');
    Object.assign(this.overlayRoot.style, { position: 'absolute', inset: '0' });
  }

  get visible(): boolean {
    return this.shown !== null;
  }

  /** Covers the canvas with `video`. Rendering stops and the sim pauses (once; a second `show` swaps the element). */
  async show(video: HTMLVideoElement): Promise<void> {
    if (this.shown === null) {
      this.simWasPaused = this.opts.sim.paused;
      this.opts.loop.stopLoop();
      if (!this.simWasPaused) this.opts.sim.setPaused(true);
      this.opts.parent.appendChild(this.layer);
      this.opts.root?.setAttribute('data-dv-cutscene', 'on');
      if (this.mobile && this.opts.wakeLock) await this.opts.wakeLock.acquire();
    } else {
      this.layer.removeChild(this.shown);
    }
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    this.layer.appendChild(video);
    // The overlay is appended last so that it sits above the video (appendChild moves a node that is already a child).
    this.layer.appendChild(this.overlayRoot);
    this.shown = video;
  }

  /** Uncovers the canvas: drops the element's decoder, restores the loop and the sim, releases the wake lock. */
  async hide(): Promise<void> {
    const video = this.shown;
    if (video === null) return;
    this.shown = null;
    try {
      video.pause();
    } catch {
      // nothing playing
    }
    releaseDecoder(video);
    this.layer.removeChild(video);
    this.opts.parent.removeChild(this.layer);
    this.opts.root?.removeAttribute('data-dv-cutscene');
    if (!this.simWasPaused) this.opts.sim.setPaused(false);
    this.opts.loop.startLoop();
    if (this.mobile && this.opts.wakeLock) await this.opts.wakeLock.release();
  }
}

/** Drops the decoder behind an element without destroying it (the pool keeps the element). */
export function releaseDecoder(video: HTMLVideoElement): void {
  video.removeAttribute('src');
  (video as { srcObject?: unknown }).srcObject = null;
  video.load();
}
