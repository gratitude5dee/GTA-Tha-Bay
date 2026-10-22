/**
 * The QA-only spike driver for the two cutscene fixtures (M04c). It plays a fixture through the real pool, budget and DOM host, and
 * measures the two ways of joining clips back to back on the device runs: an MSE `sequence`-mode source buffer and a ping-pong of two
 * pooled elements (U-S03-4). The full CutscenePlayer (resolve, triggers, sequences) is M05b2. Imported by the QA bridge only.
 */
import type { CutsceneManifest, CutsceneOutcome, FallbackTrigger } from '@dv/shared/contracts/c09-cutscene';
import { pickRendition, releaseDecoder, type DomCutsceneHost } from './dom-host.ts';
import type { FirstGestureUnlock } from './first-gesture.ts';
import type { MediaBudget } from './media-budget.ts';

export interface SpikeCue { startMs: number; endMs: number; text: string }
export interface SpikeFixture { id: string; baseUrl: string; manifest: CutsceneManifest; cues: SpikeCue[] }

export interface SpikeOverlay {
  show(s: { aiGenerated: boolean; credit?: string; cues: readonly SpikeCue[] }): void;
  setTime(ms: number): void;
  hide(): void;
}

export interface SpikeDeps {
  unlock: FirstGestureUnlock;
  host: DomCutsceneHost;
  budget: MediaBudget;
  overlay: SpikeOverlay;
  loadFixture(id: string): Promise<SpikeFixture>;
  dataSaver(): boolean;
  /** Canvas source (QA `useCanvasSource`): the same host fed from `canvas.captureStream(24)`, no codec involved. */
  createCanvas?: () => HTMLCanvasElement;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  globals?: { MediaSource?: MseClass; ManagedMediaSource?: MseClass };
}

export type SpikeStart = CutsceneOutcome & { done: Promise<CutsceneOutcome> };

interface MseClass {
  new (): MseInstance;
  isTypeSupported(type: string): boolean;
}
interface SourceBufferLike {
  mode: string;
  addEventListener(t: string, l: () => void): void;
  appendBuffer(b: ArrayBuffer): void;
  readonly updating: boolean;
  timestampOffset: number;
}
interface MseInstance {
  readyState: string;
  addEventListener(t: string, l: () => void, o?: unknown): void;
  addSourceBuffer(type: string): SourceBufferLike;
  endOfStream(): void;
}

export const TYPE_MP4 = 'video/mp4; codecs="avc1.640028"';
export const TYPE_WEBM = 'video/webm; codecs="vp9"';

export interface SequenceResult {
  skipped?: 'no-fmp4' | 'no-mse' | 'no-webm';
  /** `ManagedMediaSource` where present, else `MediaSource`. */
  cls: 'ManagedMediaSource' | 'MediaSource' | null;
  support: { mp4: boolean; webm: boolean };
  type: string | null;
  /** Whether the source buffer accepted `mode = 'sequence'`. */
  sequenceAccepted: boolean | null;
  /** Time the element spent waiting (waiting to playing) while the two clips played. */
  stallMs: number | null;
  /** Longest interval between two presented frames, ms (the join shows up as an excess over 1000/24). */
  maxFrameIntervalMs: number | null;
  durationMs: number | null;
  error?: string;
}
export interface PingPongResult { gapMs: number | null; error?: string }

const FRAME_MS = 1000 / 24;
const START_STALL_MS = 5000;

const once = (el: HTMLVideoElement, ev: string, timeoutMs: number): Promise<boolean> =>
  new Promise((res) => {
    const done = (ok: boolean): void => {
      clearTimeout(t);
      el.removeEventListener(ev, onEv);
      res(ok);
    };
    const onEv = (): void => done(true);
    const t = setTimeout(() => done(false), timeoutMs);
    el.addEventListener(ev, onEv);
  });

export class SpikePlayer {
  private canvasSource = false;
  private current: { finish(o: CutsceneOutcome): void } | null = null;
  private lastDone: Promise<CutsceneOutcome> = Promise.resolve({ path: 'fallback', skipped: false });
  constructor(private readonly deps: SpikeDeps) {}

  useCanvasSource(on: boolean): void {
    this.canvasSource = on;
  }

  /** Plays one fixture. Resolves when the first frames play (or at the fallback); `done` resolves at the end of the clip or on skip. */
  async play(id: string): Promise<SpikeStart> {
    const { unlock, host, budget, overlay } = this.deps;
    const fallback = (trigger: FallbackTrigger): SpikeStart => {
      const outcome: CutsceneOutcome = { path: 'fallback', skipped: false, trigger };
      return { ...outcome, done: Promise.resolve(outcome) };
    };
    if (this.current) this.skip();
    const video = unlock.acquireVideo();
    if (video === null) return fallback('not_permitted');
    const release = (): void => unlock.releaseVideo(video);
    let fx: SpikeFixture;
    try {
      fx = await this.deps.loadFixture(id);
    } catch {
      release();
      return fallback('not_ready');
    }
    const durationMs = (fx.manifest.frames / fx.manifest.fps) * 1000;
    const picked = this.canvasSource ? null : pickRendition(fx.manifest, (t) => video.canPlayType(t), { dataSaver: this.deps.dataSaver(), baseUrl: fx.baseUrl });
    if (!this.canvasSource && picked === null) {
      release();
      return fallback('codec');
    }
    const bytes = picked?.rendition.bytes ?? 0;
    const slot = budget.prepare(id, bytes);
    if (!slot.ok) {
      release();
      return fallback('budget');
    }

    let stream: MediaStream | null = null;
    let stopCanvas: (() => void) | null = null;
    if (this.canvasSource) {
      const canvas = this.deps.createCanvas?.() ?? document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      stopCanvas = drawLoop(canvas, durationMs);
      stream = canvas.captureStream(24);
      video.srcObject = stream;
    } else if (picked) video.src = picked.url;

    let finish: (o: CutsceneOutcome) => void = () => undefined;
    const done = new Promise<CutsceneOutcome>((res) => {
      finish = res;
    });
    let over = false;
    const timers: { ticker?: ReturnType<typeof setInterval>; cap?: ReturnType<typeof setTimeout> } = {};
    const end = (outcome: CutsceneOutcome): void => {
      if (over) return;
      over = true;
      clearInterval(timers.ticker);
      clearTimeout(timers.cap);
      stopCanvas?.();
      stream?.getTracks().forEach((t) => t.stop());
      video.removeEventListener('ended', onEnded);
      overlay.hide();
      void host.hide().finally(() => {
        budget.release(id);
        release();
        if (this.current === handle) this.current = null;
        finish(outcome);
      });
    };
    const onEnded = (): void => end({ path: 'video', skipped: false });
    const handle = { finish: end };
    this.current = handle;
    this.lastDone = done;
    video.addEventListener('ended', onEnded);

    await host.show(video);
    overlay.show({ aiGenerated: fx.manifest.provenance.aiGenerated, ...(fx.manifest.licence.uiCredit ? { credit: fx.manifest.licence.uiCredit } : {}), cues: fx.cues });
    try {
      await video.play();
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      const trigger: FallbackTrigger = name === 'NotAllowedError' ? 'not_permitted' : 'media_error';
      end({ path: 'fallback', skipped: false, trigger });
      return { path: 'fallback', skipped: false, trigger, done };
    }
    const started = await Promise.race([
      new Promise<boolean>((res) => {
        const check = setInterval(() => {
          if (video.currentTime > 0.05) {
            clearInterval(check);
            res(true);
          }
        }, 25);
        setTimeout(() => {
          clearInterval(check);
          res(false);
        }, START_STALL_MS);
      }),
    ]);
    if (!started) {
      end({ path: 'fallback', skipped: false, trigger: 'start_stall' });
      return { path: 'fallback', skipped: false, trigger: 'start_stall', done };
    }
    timers.ticker = setInterval(() => overlay.setTime(video.currentTime * 1000), 50);
    // A canvas stream never ends by itself, and a clip whose `ended` is lost must not hold the screen forever.
    timers.cap = setTimeout(() => end({ path: 'video', skipped: false }), durationMs + 2000);
    return { path: 'video', skipped: false, done };
  }

  /** Ends the clip that plays now as skipped; resolves with its outcome (immediately when none plays). */
  skip(): Promise<CutsceneOutcome> {
    const cur = this.current;
    const d = this.lastDone;
    cur?.finish({ path: 'video', skipped: true });
    return cur ? d : Promise.resolve({ path: 'fallback', skipped: false });
  }

  private async bytes(url: string): Promise<ArrayBuffer> {
    return this.deps.fetchBytes ? this.deps.fetchBytes(url) : (await fetch(url)).arrayBuffer();
  }

  /** MSE `sequence`-mode playback of the fixtures one after the other; measures the join. */
  async sequence(ids: string[]): Promise<SequenceResult> {
    const g = this.deps.globals ?? (globalThis as { MediaSource?: MseClass; ManagedMediaSource?: MseClass });
    const Cls = g.ManagedMediaSource ?? g.MediaSource ?? null;
    const cls = g.ManagedMediaSource ? 'ManagedMediaSource' : g.MediaSource ? 'MediaSource' : null;
    const out: SequenceResult = { cls, support: { mp4: false, webm: false }, type: null, sequenceAccepted: null, stallMs: null, maxFrameIntervalMs: null, durationMs: null };
    if (Cls === null) return { ...out, skipped: 'no-mse' };
    out.support = { mp4: Cls.isTypeSupported(TYPE_MP4), webm: Cls.isTypeSupported(TYPE_WEBM) };
    // The source buffer type follows the container (DL-654): ManagedMediaSource (iPhone) takes the H.264 fMP4 rendition only.
    const wantMp4 = cls === 'ManagedMediaSource' || !out.support.webm;
    const type = wantMp4 ? TYPE_MP4 : TYPE_WEBM;
    if (!(wantMp4 ? out.support.mp4 : out.support.webm)) return { ...out, skipped: wantMp4 ? 'no-fmp4' : 'no-webm' };
    const fixtures = await Promise.all(ids.map((id) => this.deps.loadFixture(id)));
    const files = fixtures.map((f) => {
      const r = Object.values(f.manifest.renditions).find((x) => (wantMp4 ? x.file.endsWith('.mp4') : x.file.endsWith('.webm')));
      return r ? `${f.baseUrl}${r.file}` : null;
    });
    if (files.some((f) => f === null)) return { ...out, type, skipped: wantMp4 ? 'no-fmp4' : 'no-webm' };
    const video = this.deps.unlock.acquireVideo();
    if (video === null) return { ...out, type, error: 'not_permitted' };
    out.type = type;
    try {
      const buffers = await Promise.all((files as string[]).map((u) => this.bytes(u)));
      const ms = new Cls();
      const url = URL.createObjectURL(ms as unknown as Blob);
      video.src = url;
      await new Promise<void>((res) => ms.addEventListener('sourceopen', () => res(), { once: true }));
      const sb = ms.addSourceBuffer(type);
      try {
        sb.mode = 'sequence';
      } catch {
        // some implementations refuse the assignment
      }
      out.sequenceAccepted = sb.mode === 'sequence';
      const append = (b: ArrayBuffer): Promise<void> =>
        new Promise((res) => {
          sb.addEventListener('updateend', () => res());
          sb.appendBuffer(b);
        });
      for (const b of buffers) await append(b);
      if (ms.readyState === 'open') ms.endOfStream();
      const total = fixtures.reduce((n, f) => n + (f.manifest.frames / f.manifest.fps) * 1000, 0);
      out.durationMs = total;
      const m = measureFrames(video);
      await video.play();
      await Promise.race([once(video, 'ended', total + 4000)]);
      const r = m.stop();
      out.stallMs = r.stallMs;
      out.maxFrameIntervalMs = r.maxIntervalMs;
      URL.revokeObjectURL(url);
    } catch (e) {
      out.error = (e as { name?: string } | null)?.name ?? 'Error';
    } finally {
      releaseDecoder(video);
      this.deps.unlock.releaseVideo(video);
    }
    return out;
  }

  /** Two pooled elements: A plays, B is preloaded and starts at A's `ended`. The gap is the time between the two. */
  async pingPong(ids: [string, string]): Promise<PingPongResult> {
    const a = this.deps.unlock.acquireVideo();
    const b = this.deps.unlock.acquireVideo();
    try {
      if (a === null || b === null) return { gapMs: null, error: 'not_permitted' };
      const [fa, fb] = await Promise.all(ids.map((id) => this.deps.loadFixture(id)));
      if (!fa || !fb) return { gapMs: null, error: 'not_ready' };
      const pa = pickRendition(fa.manifest, (t) => a.canPlayType(t), { dataSaver: false, baseUrl: fa.baseUrl });
      const pb = pickRendition(fb.manifest, (t) => b.canPlayType(t), { dataSaver: false, baseUrl: fb.baseUrl });
      if (!pa || !pb) return { gapMs: null, error: 'codec' };
      a.src = pa.url;
      b.src = pb.url;
      b.load();
      await Promise.all([once(b, 'canplaythrough', 5000), a.play()]);
      let endedAt = 0;
      await new Promise<void>((res) => {
        a.addEventListener('ended', () => {
          endedAt = performance.now();
          res();
        }, { once: true });
        setTimeout(res, ((fa.manifest.frames / fa.manifest.fps) * 1000) + 4000);
      });
      await b.play();
      const first = await firstFrame(b);
      return { gapMs: endedAt > 0 && first !== null ? Math.max(0, first - endedAt) : null };
    } catch (e) {
      return { gapMs: null, error: (e as { name?: string } | null)?.name ?? 'Error' };
    } finally {
      for (const v of [a, b]) {
        if (v) {
          v.pause();
          releaseDecoder(v);
          this.deps.unlock.releaseVideo(v);
        }
      }
    }
  }
}

interface FrameCb { (cb: (now: number) => void): number }
function frameSource(video: HTMLVideoElement): FrameCb {
  const rv = (video as { requestVideoFrameCallback?: FrameCb }).requestVideoFrameCallback;
  return rv ? rv.bind(video) : (cb) => requestAnimationFrame(cb);
}

function firstFrame(video: HTMLVideoElement): Promise<number | null> {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 3000);
    frameSource(video)((now) => {
      clearTimeout(t);
      res(now);
    });
  });
}

/** Longest gap between presented frames, and the time spent in `waiting`, while the element plays. */
function measureFrames(video: HTMLVideoElement): { stop(): { stallMs: number; maxIntervalMs: number } } {
  let last = 0;
  let maxIntervalMs = 0;
  let stallMs = 0;
  let waitStart = 0;
  let live = true;
  const next = frameSource(video);
  const onFrame = (now: number): void => {
    if (!live) return;
    if (last > 0) maxIntervalMs = Math.max(maxIntervalMs, now - last);
    last = now;
    next(onFrame);
  };
  const onWait = (): void => {
    waitStart = performance.now();
  };
  const onPlaying = (): void => {
    if (waitStart > 0) stallMs += performance.now() - waitStart;
    waitStart = 0;
  };
  video.addEventListener('waiting', onWait);
  video.addEventListener('playing', onPlaying);
  next(onFrame);
  return {
    stop() {
      live = false;
      video.removeEventListener('waiting', onWait);
      video.removeEventListener('playing', onPlaying);
      return { stallMs: Math.round(stallMs), maxIntervalMs: Math.round(Math.max(maxIntervalMs, FRAME_MS)) };
    },
  };
}

/** Animates a canvas (colour field and a moving disc) for the canvas-source mode. */
function drawLoop(canvas: HTMLCanvasElement, durationMs: number): () => void {
  const ctx = canvas.getContext('2d');
  const t0 = performance.now();
  let id = 0;
  const draw = (): void => {
    const t = (performance.now() - t0) / 1000;
    if (ctx) {
      ctx.fillStyle = `hsl(${(210 + 20 * t) % 360},50%,25%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(canvas.width * (0.5 + 0.35 * Math.cos(t * 1.5)), canvas.height * (0.5 + 0.3 * Math.sin(t * 2)), 18, 0, Math.PI * 2);
      ctx.fill();
    }
    if (performance.now() - t0 < durationMs + 1500) id = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(id);
}
