/**
 * The flat DOM cutscene host (`CutsceneHostKind 'dom-overlay'`, 03-story-cutscenes.md section D7). It mounts a pooled `<video>` above
 * the canvas on black (`object-fit: contain`), stops the render loop and pauses the sim while the clip covers the screen, keeps the
 * GPU resources resident (nothing is disposed), holds a screen wake lock on mobile tiers, and undoes all of it on `hide`. Releasing
 * the element drops its decoder: `removeAttribute('src'); load()`.
 *
 * Around the clip (BD-FIX-CI10-R01), the world the host hides is not drawn either, while the loop and the sim keep running: the armed
 * in-engine frame is held on the canvas while the player resolves the clip (`holdFrame`), `poster.webp` covers the screen on black
 * while the clip pre-rolls (`holdPoster`), and `last.webp` after a mid-play stall (`holdStill`). Each goes through the loop's
 * `holdWorld`; the cue-only layer of the in-engine fallback is translucent and keeps the world drawn.
 */
import type { CutsceneManifest, Rendition } from '@dv/shared/contracts/c09-cutscene';
import type { ScreenWakeLock } from './wake-lock.ts';

/** The part of the RendererHost the host drives; the real host satisfies it. */
export interface LoopControl {
  stopLoop(): void;
  startLoop(): void;
  /**
   * Skips the world and backdrop passes while the loop keeps running (`RendererHost.holdWorld`); returns the release. Optional: a loop
   * without it (the QA media page's stand-in) draws as before.
   */
  holdWorld?(kind: 'cover' | 'frame', armed?: () => boolean): () => void;
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
  /** Present on real elements; the tap prompt of `waitForTap` needs it (M05b2). */
  addEventListener?(type: string, listener: (e: unknown) => void): void;
  textContent?: string | null;
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
  /**
   * True once the frame `holdFrame` keeps is in the view (the page: the snapshot of the tick that armed the beat has arrived). Without
   * it the frame drawn next is held.
   */
  frameArmed?: () => boolean;
}

export class DomCutsceneHost {
  readonly kind = 'dom-overlay' as const;
  /** Where the UI overlay (skip, subtitles, AI chip) mounts: above the video, inside the host layer. */
  readonly overlayRoot: HostElement;
  private readonly layer: HostElement;
  private shown: HTMLVideoElement | null = null;
  private simWasPaused = false;
  private mobile: boolean;
  /** The still image that replaced the video during a mid-play stall (M05b2); the sim runs behind it. */
  private still: HostElement | null = null;
  /** The layer is up with no cover: subtitles over the live world (the in-engine fallback, M05b2). */
  private cuesOnly = false;
  /** `poster.webp` on black while the clip pre-rolls; the sim runs behind it (BD-FIX-CI10-R01). */
  private poster: HostElement | null = null;
  /** Releases of the loop's `holdWorld`: the held in-engine frame, and the opaque cover (poster or still). */
  private frameHold: (() => void) | null = null;
  private coverHold: (() => void) | null = null;

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

  /** A clip, its poster or the still of a stalled clip covers the screen. */
  get visible(): boolean {
    return this.shown !== null || this.still !== null || this.poster !== null;
  }

  /** What keeps the world from being drawn now: the loop is stopped under a clip, a cover hides it, or its armed frame is held. */
  get held(): 'stopped' | 'cover' | 'frame' | null {
    if (this.shown !== null) return 'stopped';
    if (this.coverHold !== null) return 'cover';
    return this.frameHold !== null ? 'frame' : null;
  }

  /**
   * The CutscenePlayer is resolving a clip (section D7 step 2): the armed in-engine frame stays on the canvas, the loop and the sim run
   * on, and the world is not drawn again until the poster, the clip or the in-engine fallback takes over (or `hide`).
   */
  holdFrame(): void {
    if (this.frameHold !== null || this.visible || this.cuesOnly) return;
    this.frameHold = this.opts.loop.holdWorld?.('frame', this.opts.frameArmed) ?? null;
  }

  /**
   * `poster.webp` covers the screen on black while the clip pre-rolls to its first frame (section D7 step 2). The sim is not paused
   * (it has not heard `video` yet) and the loop runs; only the world passes are skipped. No-op while a clip or a still is up.
   */
  holdPoster(url: string): void {
    if (this.shown !== null || this.still !== null || this.poster !== null) return;
    this.releaseFrame();
    if (this.cuesOnly) {
      this.cuesOnly = false;
      this.opts.parent.removeChild(this.layer);
    }
    const img = this.opts.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('alt', '');
    img.setAttribute('data-testid', 'cutscene-poster');
    Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    Object.assign(this.layer.style, { background: '#000' });
    this.layer.appendChild(img);
    this.layer.appendChild(this.overlayRoot);
    this.opts.parent.appendChild(this.layer);
    this.opts.root?.setAttribute('data-dv-cutscene', 'on');
    this.poster = img;
    this.coverHold = this.opts.loop.holdWorld?.('cover') ?? null;
  }

  private releaseFrame(): void {
    this.frameHold?.();
    this.frameHold = null;
  }

  private releaseCover(): void {
    this.coverHold?.();
    this.coverHold = null;
  }

  private dropPoster(): void {
    if (this.poster === null) return;
    this.layer.removeChild(this.poster);
    this.poster = null;
  }

  /** True while the layer shows only the overlay (subtitles) above the running world. */
  get cues(): boolean {
    return this.cuesOnly;
  }

  /**
   * Subtitles over the live world, with no cover and no pause: the overlay of the in-engine fallback (a cue-only sequence has no
   * manifest and shows no AI chip). The HUD hides as it does for a clip.
   */
  showCues(): void {
    // The in-engine fallback draws the world: a held frame goes.
    this.releaseFrame();
    if (this.cuesOnly || this.visible) return;
    this.cuesOnly = true;
    Object.assign(this.layer.style, { background: 'transparent' });
    this.opts.parent.appendChild(this.layer);
    this.layer.appendChild(this.overlayRoot);
    this.opts.root?.setAttribute('data-dv-cutscene', 'on');
  }

  hideCues(): void {
    if (!this.cuesOnly) return;
    this.cuesOnly = false;
    this.opts.parent.removeChild(this.layer);
    this.opts.root?.removeAttribute('data-dv-cutscene');
    Object.assign(this.layer.style, { background: '#000' });
  }

  /**
   * A mid-play stall: the last frame replaces the video and covers the screen while the loop and the sim run again behind it, so the
   * in-engine DirectorScript can finish the beat. `hide()` removes the layer when the beat is over.
   */
  holdStill(url: string): void {
    const video = this.shown;
    if (video === null) return;
    const img = this.opts.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('alt', '');
    Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    this.shown = null;
    try {
      video.pause();
    } catch {
      // nothing playing
    }
    releaseDecoder(video);
    this.layer.removeChild(video);
    this.layer.appendChild(img);
    this.layer.appendChild(this.overlayRoot);
    this.still = img;
    if (!this.simWasPaused) this.opts.sim.setPaused(false);
    // The still is opaque: the loop runs again for the sim and the DirectorScript, without drawing the world behind it.
    this.coverHold = this.opts.loop.holdWorld?.('cover') ?? null;
    this.opts.loop.startLoop();
  }

  /**
   * "Tap to play" for a `play()` that the browser refused (Low Power Mode): a button over the layer; resolves true when it is tapped
   * within `ms`, false when the time is up. The caller calls `play()` again on true.
   */
  waitForTap(label: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const btn = this.opts.createElement('button');
      btn.setAttribute('type', 'button');
      btn.setAttribute('class', 'dv-btn dv-cutscene-tap');
      btn.setAttribute('data-testid', 'cutscene-tap-to-play');
      btn.textContent = label;
      Object.assign(btn.style, { position: 'absolute', insetBlockEnd: '30%', insetInlineStart: '50%', transform: 'translateX(-50%)', zIndex: '2' });
      let done = false;
      const finish = (tapped: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.overlayRoot.removeChild(btn);
        resolve(tapped);
      };
      const timer = setTimeout(() => finish(false), ms);
      btn.addEventListener?.('click', () => finish(true));
      this.overlayRoot.appendChild(btn);
    });
  }

  /** Covers the canvas with `video`. Rendering stops and the sim pauses (once; a second `show` swaps the element). */
  async show(video: HTMLVideoElement): Promise<void> {
    if (this.cuesOnly) {
      this.cuesOnly = false;
      Object.assign(this.layer.style, { background: '#000' });
    }
    if (this.still !== null) {
      this.layer.removeChild(this.still);
      this.still = null;
      this.shown = null;
    }
    // The clip replaces its poster (or the held frame); the stopped loop draws nothing, and a hold ends with the clip.
    this.dropPoster();
    this.releaseFrame();
    this.releaseCover();
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
    this.releaseFrame();
    if (this.poster !== null) {
      // The clip never showed: the poster goes and the world is drawn again (the sim was never paused).
      this.dropPoster();
      this.opts.parent.removeChild(this.layer);
      this.opts.root?.removeAttribute('data-dv-cutscene');
      this.releaseCover();
      return;
    }
    if (this.still !== null) {
      const img = this.still;
      this.still = null;
      this.layer.removeChild(img);
      this.opts.parent.removeChild(this.layer);
      this.opts.root?.removeAttribute('data-dv-cutscene');
      this.releaseCover();
      if (this.mobile && this.opts.wakeLock) await this.opts.wakeLock.release();
      return;
    }
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
