/**
 * Mixed sequences (spec/domains/03-story-cutscenes.md sections D1 and D7; fight intros `[walkIn(P1), walkIn(P2), faceOff]`): items
 * play back to back. Two ways to join ready clips, both measured on devices by M04c (U-S03-4):
 *   - MSE `sequence` mode: one element, one source buffer, the clips appended in order (`ManagedMediaSource` with
 *     `disableRemotePlayback` on iOS). Used only when every item is ready, none is degraded and every rendition is an fMP4 file the
 *     browser accepts.
 *   - ping-pong: two pooled elements; the next clip is prepared and pre-rolled while the current one plays and starts at its `ended`.
 *     This is the default and the fallback of the MSE path.
 * An item that is `null`, suppressed or not ready plays its DirectorScript in-engine; the player tells the sim per item.
 */
import type { PickedRendition } from '../../platform/media/dom-host.ts';
import type { Timers } from './triggers.ts';

export interface MseInstance {
  readyState: string;
  addEventListener(t: string, l: () => void, o?: unknown): void;
  addSourceBuffer(type: string): MseSourceBuffer;
  endOfStream(): void;
}
export interface MseSourceBuffer {
  mode: string;
  addEventListener(t: string, l: () => void): void;
  appendBuffer(b: ArrayBuffer): void;
  readonly updating: boolean;
}
export interface MseClass {
  new (): MseInstance;
  isTypeSupported(type: string): boolean;
}
export interface MseGlobals {
  MediaSource?: MseClass;
  ManagedMediaSource?: MseClass;
}

export interface MseDeps {
  globals: MseGlobals;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  createObjectURL(source: unknown): string;
  revokeObjectURL(url: string): void;
}

export const MSE_TYPE_MP4 = 'video/mp4; codecs="avc1.640028"';

/** `ManagedMediaSource` where the browser has it (iPhone), else `MediaSource`. */
export function mseClass(g: MseGlobals): { cls: MseClass; managed: boolean } | null {
  if (g.ManagedMediaSource) return { cls: g.ManagedMediaSource, managed: true };
  if (g.MediaSource) return { cls: g.MediaSource, managed: false };
  return null;
}

export interface MseItem {
  picked: PickedRendition;
  durationMs: number;
  degraded: boolean;
}

/** True when the whole run can use one MSE source: every item an fMP4 rendition, none degraded, the type supported. */
export function canJoinWithMse(items: readonly MseItem[], g: MseGlobals): boolean {
  const found = mseClass(g);
  if (found === null || items.length < 2) return false;
  if (!found.cls.isTypeSupported(MSE_TYPE_MP4)) return false;
  return items.every((i) => !i.degraded && i.picked.rendition.file.endsWith('.mp4'));
}

interface VideoLike {
  src: string;
  currentTime: number;
  disableRemotePlayback: boolean;
  setAttribute(n: string, v: string): void;
  addEventListener(t: string, l: () => void): void;
  removeEventListener(t: string, l: () => void): void;
  play(): Promise<void>;
}

export interface MseRunResult {
  ok: boolean;
  /** `sequence` mode was accepted by the source buffer. */
  sequenceMode: boolean;
  error?: string;
}

/**
 * Plays the items in one MSE source buffer. `onItem(i)` runs when the playhead enters item `i` (item 0 at the start); the promise
 * resolves at the end of the stream. The caller owns the element, the host and the sim protocol.
 */
export async function playMseRun(video: VideoLike, items: readonly MseItem[], deps: MseDeps, timers: Timers, onItem: (i: number) => void): Promise<MseRunResult> {
  const found = mseClass(deps.globals);
  if (found === null) return { ok: false, sequenceMode: false, error: 'no-mse' };
  let url: string | null = null;
  try {
    const buffers = await Promise.all(items.map((i) => deps.fetchBytes(i.picked.url)));
    const ms = new found.cls();
    url = deps.createObjectURL(ms);
    video.disableRemotePlayback = true;
    video.setAttribute('disableremoteplayback', '');
    video.src = url;
    await new Promise<void>((res) => ms.addEventListener('sourceopen', () => res(), { once: true }));
    const sb = ms.addSourceBuffer(MSE_TYPE_MP4);
    try {
      sb.mode = 'sequence';
    } catch {
      // some implementations refuse the assignment
    }
    const sequenceMode = sb.mode === 'sequence';
    for (const b of buffers) {
      await new Promise<void>((res) => {
        sb.addEventListener('updateend', () => res());
        sb.appendBuffer(b);
      });
    }
    if (ms.readyState === 'open') ms.endOfStream();
    const starts: number[] = [];
    let at = 0;
    for (const it of items) {
      starts.push(at);
      at += it.durationMs;
    }
    let current = -1;
    const enter = (ms2: number): void => {
      for (let i = starts.length - 1; i >= 0; i--) {
        if (ms2 >= (starts[i] as number) && i > current) {
          for (let k = current + 1; k <= i; k++) onItem(k);
          current = i;
          break;
        }
      }
    };
    return await new Promise<MseRunResult>((resolve) => {
      let cap: unknown = null;
      const done = (r: MseRunResult): void => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        if (cap !== null) timers.clearTimeout(cap);
        resolve(r);
      };
      const onTime = (): void => enter(video.currentTime * 1000);
      const onEnded = (): void => done({ ok: true, sequenceMode });
      const onError = (): void => done({ ok: false, sequenceMode, error: 'media_error' });
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      // A stream whose `ended` is lost must not hold the screen.
      cap = timers.setTimeout(() => done({ ok: true, sequenceMode }), at + 3000);
      enter(0);
      video.play().catch(() => done({ ok: false, sequenceMode, error: 'not_permitted' }));
    });
  } catch (e) {
    return { ok: false, sequenceMode: false, error: (e as { name?: string } | null)?.name ?? 'Error' };
  } finally {
    if (url !== null) deps.revokeObjectURL(url);
  }
}
