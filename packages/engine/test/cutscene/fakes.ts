// Test doubles for the CutscenePlayer (the unit environment is node: no DOM).
import type { UiCommand } from '@dv/shared';
import type { CutsceneIndex, CutsceneIndexEntry, CutsceneManifest, CutsceneRefId } from '@dv/shared/contracts/c09-cutscene';
import type { CutsceneStatus } from '@dv/shared';
import { MediaBudget } from '../../src/platform/media/media-budget.ts';
import { CUTSCENE_CONFIG, type Timers } from '../../src/client/cutscene/triggers.ts';
import type { CutsceneHostPort, OverlayPort } from '../../src/client/cutscene/hosts.ts';
import type { PlayerDeps } from '../../src/client/cutscene/player.ts';

export const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A manual clock: timers fire only when the test advances time. */
export class FakeClock implements Timers {
  t = 0;
  private seq = 0;
  private q: { id: number; at: number; fn: () => void }[] = [];
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.q.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.q = this.q.filter((x) => x.id !== h);
  }
  get pending(): number {
    return this.q.length;
  }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const n = this.q[0];
      if (!n || n.at > end) break;
      this.q.shift();
      this.t = n.at;
      n.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

export class FakeVideo extends EventTarget {
  src = '';
  poster = '';
  muted = false;
  currentTime = 0;
  readyState = 0;
  error: { code: number } | null = null;
  disableRemotePlayback = false;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  /** `NotAllowedError` makes `play()` reject; a list rejects once per entry. */
  rejectPlay: string[] = [];
  /** `load()` delivers the first frame unless this is set. */
  noFrame = false;
  /** `load()` fails with this MediaError code. */
  loadError: number | null = null;
  constructor(public canPlay: (type: string) => string = () => 'probably') {
    super();
  }
  canPlayType(t: string): string {
    return this.canPlay(t);
  }
  load(): void {
    this.loadCalls++;
    if (this.src === '') return;
    if (this.loadError !== null) {
      queueMicrotask(() => {
        this.error = { code: this.loadError as number };
        this.dispatchEvent(new Event('error'));
      });
    } else if (!this.noFrame) {
      queueMicrotask(() => {
        this.readyState = 2;
        this.dispatchEvent(new Event('loadeddata'));
      });
    }
  }
  play(): Promise<void> {
    this.playCalls++;
    const name = this.rejectPlay.shift();
    if (name) return Promise.reject(Object.assign(new Error(name), { name }));
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
  }
  removeAttribute(n: string): void {
    if (n === 'src') {
      this.src = '';
      this.readyState = 0;
    }
  }
  setAttribute(): void {
    // not used by the player
  }
  end(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeHost implements CutsceneHostPort {
  readonly kind = 'dom-overlay' as const;
  log: string[] = [];
  shown: unknown = null;
  stillUrl: string | null = null;
  cuesOn = false;
  tap: boolean | (() => boolean) = false;
  get visible(): boolean {
    return this.shown !== null || this.stillUrl !== null;
  }
  show(video: HTMLVideoElement): Promise<void> {
    this.log.push('show');
    this.shown = video;
    this.stillUrl = null;
    this.cuesOn = false;
    return Promise.resolve();
  }
  hide(): Promise<void> {
    if (this.visible) this.log.push('hide');
    this.shown = null;
    this.stillUrl = null;
    return Promise.resolve();
  }
  showCues(): void {
    if (this.cuesOn || this.visible) return;
    this.log.push('showCues');
    this.cuesOn = true;
  }
  hideCues(): void {
    if (!this.cuesOn) return;
    this.log.push('hideCues');
    this.cuesOn = false;
  }
  holdStill(url: string): void {
    this.log.push('holdStill');
    this.shown = null;
    this.stillUrl = url;
  }
  waitForTap(): Promise<boolean> {
    this.log.push('tapPrompt');
    return Promise.resolve(typeof this.tap === 'function' ? this.tap() : this.tap);
  }
}

export class FakeOverlay implements OverlayPort {
  log: string[] = [];
  last: { aiGenerated: boolean; credit?: string; cues: readonly { text: string }[] } | null = null;
  visible = false;
  show(s: { aiGenerated: boolean; credit?: string; cues: readonly { startMs: number; endMs: number; text: string }[] }): void {
    this.log.push(s.aiGenerated ? 'show:ai' : 'show:cues');
    this.last = s;
    this.visible = true;
  }
  setTime(): void {
    // not asserted
  }
  hide(): void {
    if (this.visible) this.log.push('hide');
    this.visible = false;
  }
}

export const KEY_A = 'a'.repeat(64);
export const KEY_B = 'b'.repeat(64);
export const KEY_C = 'c'.repeat(64);

export function entry(ref: string, key: string, over: Partial<CutsceneIndexEntry> = {}): CutsceneIndexEntry {
  return {
    ref: ref as CutsceneRefId,
    key,
    keyInput: { template: 'story.beat@1', characters: [], move: null, stage: null, style: 'bay-cel@1', endpoint: 'x@unpinned', seed: 1, inputHashes: [] },
    provider: 'h3.partner',
    characters: [{ id: 'npc_test', soulVersion: 1, tier: 'original' }],
    durationMs: 7000,
    fallback: `dir.${ref}`,
    cues: [{ line: 'line.a.1', startMs: 0, endMs: 1000, kind: 'dialogue' }],
    audio: 'engine',
    ...over,
  };
}

export function manifest(key: string, over: Partial<CutsceneManifest> = {}): CutsceneManifest {
  const r = (file: string, bytes: number) => ({ file, bytes, sha256: 'd'.repeat(64), codecs: 'avc1.640028', kbps: 800 });
  return {
    schema: 'cutscene-asset/1', key, recipe: 'cut@1', fps: 24, frames: 168, width: 1366, height: 768,
    renditions: { v768: r('v768.mp4', 5_000_000), v540: r('v540.mp4', 2_000_000) },
    poster: 'poster.webp', last: 'last.webp', subs: { en: 'subs.en.vtt' },
    shots: [{ shotId: 's1', startFrame: 0, frames: 168 }],
    characters: [{ id: 'npc_test', soulVersion: 1, tier: 'original' }],
    licence: { gate: 'ADR-GENAI-01', provider: 'h3.partner', status: 'pending', termsSnapshotSha256: [] },
    provenance: { endpoint: 'x', pinnedUpdatedAt: 'unpinned', requestIds: [], origSha256: 'e'.repeat(64), c2pa: 'valid-untrusted', resigned: true, aiGenerated: true },
    ...over,
  };
}

export interface Rig {
  clock: FakeClock;
  sent: UiCommand[];
  telemetry: { name: string; props: Record<string, unknown> }[];
  pool: FakeVideo[];
  free: Set<FakeVideo>;
  host: FakeHost;
  overlay: FakeOverlay;
  budget: MediaBudget;
  deps: PlayerDeps;
  /** Status by key (route 27); a missing key answers `absent`. */
  status: Map<string, CutsceneStatus | null>;
  manifests: Map<string, CutsceneManifest | null>;
  entries: CutsceneIndexEntry[];
  /** The sim finishing the in-engine beat of a play. */
  simDone(playId: string, item?: number): void;
  /** Wait for the DirectorScript to be finished by `simDone` instead of at once. */
  manualFallback: boolean;
  state: { generated: boolean; bootEnabled: boolean; online: boolean; suppressed: boolean; tier: string; dataSaver: boolean; throughput: number | null; screenH: number; force: 'video' | 'fallback' | null };
  /** `cutscene.state` commands without the `done`. */
  answers(): { item?: number; state: string; trigger?: string }[];
  done(): UiCommand[];
}

export function rig(entries: CutsceneIndexEntry[] = [entry('cut.a', KEY_A)], maxMediaMB: number | null = null): Rig {
  const clock = new FakeClock();
  const sent: UiCommand[] = [];
  const telemetry: Rig['telemetry'] = [];
  const pool = [new FakeVideo(), new FakeVideo(), new FakeVideo()];
  const free = new Set(pool);
  const host = new FakeHost();
  const overlay = new FakeOverlay();
  const budget = new MediaBudget({ maxMediaMB });
  const status = new Map<string, CutsceneStatus | null>();
  const manifests = new Map<string, CutsceneManifest | null>();
  for (const e of entries) {
    status.set(e.key, { key: e.key, state: 'ready', manifestUrl: `https://media.test/cutscenes/${e.key}/manifest.json` });
    manifests.set(`https://media.test/cutscenes/${e.key}/manifest.json`, manifest(e.key));
  }
  const waiters = new Map<string, () => void>();
  const state: Rig['state'] = { generated: true, bootEnabled: true, online: true, suppressed: false, tier: 'desktop', dataSaver: false, throughput: null, screenH: 1080, force: null };
  const r: Rig = {
    clock, sent, telemetry, pool, free, host, overlay, budget, status, manifests, entries, state, manualFallback: false,
    simDone: (playId, item) => waiters.get(`${playId}:${item ?? ''}`)?.(),
    answers: () => sent.flatMap((c) => (c.t === 'cutscene.state' && c.state !== 'done' ? [{ ...(c.item !== undefined ? { item: c.item } : {}), state: c.state, ...(c.trigger ? { trigger: c.trigger } : {}) }] : [])),
    done: () => sent.filter((c) => c.t === 'cutscene.state' && c.state === 'done'),
    deps: undefined as unknown as PlayerDeps,
  };
  const index: CutsceneIndex = { schema: 'cutscene-index/1', release: 'r', builtAt: 1, entries };
  r.deps = {
    index: () => index,
    suppressed: () => state.suppressed,
    settings: () => ({ generated: state.generated }),
    bootEnabled: () => state.bootEnabled,
    online: () => state.online,
    status: (key) => Promise.resolve(status.has(key) ? (status.get(key) ?? null) : { key, state: 'absent' }),
    fetchManifest: (url) => Promise.resolve(manifests.get(url) ?? null),
    timers: clock,
    cfg: CUTSCENE_CONFIG,
    unlock: {
      acquireVideo: () => {
        for (const v of pool) if (free.has(v)) {
          free.delete(v);
          return v as unknown as HTMLVideoElement;
        }
        return null;
      },
      releaseVideo: (v) => void free.add(v as unknown as FakeVideo),
    },
    host,
    budget,
    overlay,
    send: (c) => void sent.push(c),
    tier: () => state.tier,
    dataSaver: () => state.dataSaver,
    screenHeightPx: () => state.screenH,
    throughputMbps: () => state.throughput,
    lineText: (id) => `text of ${id}`,
    fallbackDone: (playId, item) => (r.manualFallback ? new Promise<void>((res) => waiters.set(`${playId}:${item ?? ''}`, res)) : Promise.resolve()),
    telemetry: (name, props) => void telemetry.push({ name, props }),
    tapLabel: () => 'Tap to play',
    force: () => state.force,
  };
  return r;
}
