/**
 * FirstGestureUnlock (C13 1.1, 11-platform-pwa.md section 7): the single handler of the title screen's first gesture. It creates or
 * resumes the shared AudioContext (through `AudioService.unlock()`), sets `navigator.audioSession.type = 'playback'` (the audio
 * service does that when it creates the context), and unlocks a pool of three `<video>` elements by playing a 0.1 s same-origin
 * blank clip in each, then pausing. S03's CutscenePlayer and in-world video textures acquire elements from this pool; cutscene
 * `<video>` elements are never created anywhere else.
 *
 * An element whose blank `play()` rejects (or never settles) stays in the pool and stays acquirable: iOS Low Power Mode refuses
 * playback without a gesture, and whether an element unlocked once keeps working with a new `src` is the device question U-PLT-17.
 */

export const POOL_SIZE = 3;
export const BLANK_MP4 = '/media/blank.mp4';
export const BLANK_WEBM = '/media/blank.webm';
/** The H.264 type the production blank clip and the `cut@1` renditions use. */
export const MP4_TYPE = 'video/mp4; codecs="avc1.640028"';
/** A blank `play()` that has not settled after this long counts as failed (`TimeoutError`). */
const BLANK_TIMEOUT_MS = 1500;

export interface BlankError { stage: 'blank'; index: number; name: string }
export interface GestureState {
  audio: 'none' | 'suspended' | 'running';
  unlocked: boolean;
  pool: number;
  free: number;
  blank: 'mp4' | 'webm';
  errors: BlankError[];
}

export interface GestureTarget {
  addEventListener(type: string, listener: (e: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (e: unknown) => void): void;
}

export interface FirstGestureOptions {
  audio: { unlock(): Promise<void>; readonly context?: { readonly state: string } | null };
  /** Creates one `<video>` element. Default: `document.createElement('video')`. */
  createVideo?: () => HTMLVideoElement;
  /** Origin prefix of the blank clips (default empty: same origin). */
  base?: string;
  blankTimeoutMs?: number;
}

export interface FirstGestureUnlock {
  /** Handle the gesture now (the Title's button calls this); idempotent. */
  trigger(): Promise<void>;
  /** Listens for the first `pointerup`, `touchend` or `keydown` on `target`, then stops. Returns the detach function. */
  attach(target: GestureTarget): () => void;
  /** Resolves when the first gesture has been handled and every blank `play()` has settled or timed out. */
  readonly ready: Promise<void>;
  state(): GestureState;
  acquireVideo(): HTMLVideoElement | null;
  releaseVideo(v: HTMLVideoElement): void;
}

const GESTURE_EVENTS = ['pointerup', 'touchend', 'keydown'] as const;

export function createFirstGestureUnlock(opts: FirstGestureOptions): FirstGestureUnlock {
  const make = opts.createVideo ?? ((): HTMLVideoElement => document.createElement('video'));
  const base = opts.base ?? '';
  const timeoutMs = opts.blankTimeoutMs ?? BLANK_TIMEOUT_MS;
  const pool: HTMLVideoElement[] = [];
  const free = new Set<HTMLVideoElement>();
  const errors: BlankError[] = [];
  let blank: 'mp4' | 'webm' = 'webm';
  let handled = false;
  let unlocked = false;
  let running: Promise<void> | null = null;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((res) => {
    resolveReady = res;
  });

  const prepare = (v: HTMLVideoElement): void => {
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('disableremoteplayback', '');
    v.disableRemotePlayback = true;
    v.setAttribute('crossorigin', 'anonymous');
    v.crossOrigin = 'anonymous';
    v.setAttribute('preload', 'auto');
    v.preload = 'auto';
  };

  const playBlank = async (v: HTMLVideoElement, index: number): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const played = Promise.resolve(v.play());
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('blank play timed out'), { name: 'TimeoutError' })), timeoutMs);
      });
      await Promise.race([played, timeout]);
    } catch (e) {
      errors.push({ stage: 'blank', index, name: (e as { name?: string } | null)?.name ?? 'Error' });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        v.pause();
      } catch {
        // an element that never started has nothing to pause
      }
    }
  };

  const run = async (): Promise<void> => {
    // Everything that needs the gesture starts synchronously, before the first await.
    const audioDone = opts.audio.unlock().catch(() => undefined);
    for (let i = 0; i < POOL_SIZE; i++) {
      const v = make();
      prepare(v);
      pool.push(v);
      free.add(v);
    }
    const first = pool[0] as HTMLVideoElement;
    blank = first.canPlayType(MP4_TYPE) !== '' ? 'mp4' : 'webm';
    const src = `${base}${blank === 'mp4' ? BLANK_MP4 : BLANK_WEBM}`;
    const plays = pool.map((v, i) => {
      v.src = src;
      return playBlank(v, i);
    });
    await Promise.all([audioDone, ...plays]);
    unlocked = true;
    resolveReady();
  };

  const trigger = (): Promise<void> => {
    handled = true;
    running ??= run();
    return running;
  };

  return {
    trigger,
    ready,
    attach(target) {
      const go = (): void => {
        off();
        void trigger();
      };
      const off = (): void => {
        for (const ev of GESTURE_EVENTS) target.removeEventListener(ev, go);
      };
      for (const ev of GESTURE_EVENTS) target.addEventListener(ev, go);
      return off;
    },
    state(): GestureState {
      const ctxState = opts.audio.context?.state;
      return {
        audio: ctxState === undefined ? 'none' : ctxState === 'running' ? 'running' : 'suspended',
        unlocked: unlocked && handled,
        pool: pool.length,
        free: free.size,
        blank,
        errors: errors.map((e) => ({ ...e })),
      };
    },
    acquireVideo() {
      for (const v of pool) {
        if (free.has(v)) {
          free.delete(v);
          return v;
        }
      }
      return null;
    },
    releaseVideo(v) {
      if (pool.includes(v)) free.add(v);
    },
  };
}
