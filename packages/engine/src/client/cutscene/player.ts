/**
 * CutscenePlayer (C09, spec/domains/03-story-cutscenes.md section D7; M05b2): resolves a CutsceneRef through the shipped index, the
 * roster flags, the settings, route 27 and the manifest; picks the host and the rendition; plays single clips and mixed sequences on
 * the flat DOM host; and falls back to the in-engine DirectorScript on every one of the eleven triggers (R-CUT-03). It runs on the
 * main thread. The sim learns everything through `UiCommand cutscene.state`: one answer per item (`video` or `fallback`, within 2.5 s
 * of the request, 1.5 s when prefetched) and `done` at the end. Nothing here throws: a failure is a trigger and the mission never
 * waits on a network answer.
 *
 * Order of events for a clip: resolve, acquire a pooled element, pick the rendition under the media budget, pre-roll to the first
 * frame, answer `video` (the sim must hear it before the host pauses it), cover the screen and play. A refused `play()` on a mobile
 * tier gets a "Tap to play" prompt for 3 s; a stall of 1.5 s during play holds `last.webp` and the sim finishes the beat in-engine.
 */
import type { UiCommand } from '@dv/shared';
import type {
  CueSpec, CutsceneIndexEntry, CutscenePlayer, CutsceneOutcome, CutsceneRefId, FallbackTrigger, PreparedClip,
} from '@dv/shared/contracts/c09-cutscene';
import type { FirstGestureUnlock } from '../../platform/media/first-gesture.ts';
import { ambientAllowed, AudioSync, type CutsceneAudioPort } from './audio-sync.ts';
import { overBudget, renditionCandidates, type BudgetPort, type CutsceneHostPort, type OverlayPort } from './hosts.ts';
import { resolveRef, within, type Resolution, type Resolved, type ResolveDeps } from './resolve.ts';
import { canJoinWithMse, mseClass, playMseRun, type MseDeps, type MseItem } from './sequence.ts';
import { emitPlay, Watch, type Telemetry } from './triggers.ts';

export interface PlayerDeps extends ResolveDeps {
  unlock: Pick<FirstGestureUnlock, 'acquireVideo' | 'releaseVideo'>;
  /**
   * Resolves when the pooled elements are unlocked. A QA page has no Title tap, so its glue starts a stand-in unlock with the request
   * and passes it here; a clip waits for it before it takes a pooled element, inside the answer window of section D7 (BD-FIX-CI7-D02).
   * A player's page leaves it out: the Title tap unlocked the pool before any mission could ask for a beat.
   */
  unlocked?(): Promise<void>;
  host: CutsceneHostPort;
  budget: BudgetPort;
  overlay: OverlayPort;
  /** Sends a `UiCommand` to the sim (the engine handle's `sendUi`). */
  send(cmd: UiCommand): void;
  /** Quality tier id; the mobile tiers get the tap prompt. */
  tier(): string;
  /** `PlatformSettings.dataSaver`. */
  dataSaver(): boolean;
  screenHeightPx(): number;
  throughputMbps(): number | null;
  /** Subtitle text of a line id; the id itself when unknown. */
  lineText(id: string): string;
  /** Cues of a DirectorScript by id, for an item that has no index entry. */
  fallbackCues?(directorId: string): readonly CueSpec[];
  /**
   * Resolves when the sim has finished the in-engine beat of that play (and item). The page wires it to the sim's `cut.done` event.
   * The player also stops waiting when the beat is skipped.
   */
  fallbackDone(playId: string, item: number | undefined): Promise<void>;
  /** `ProfileSettings.cutscenes.audio`. */
  audioMode?(): 'generated' | 'engine';
  audio?: CutsceneAudioPort;
  telemetry?: Telemetry;
  tapLabel(): string;
  /** QA `?beats=fallback`: every single-ref request answers `fallback`. */
  force?(): 'video' | 'fallback' | null;
  /** MSE `sequence` joining (off unless given); ping-pong otherwise. */
  mse?: MseDeps;
  /** Warms the HTTP cache for these URLs (poster, ambient audio) after a prefetch. */
  warm?(urls: readonly string[]): void;
  /** How long a clip may hold the screen beyond its length before the player ends it (a lost `ended` event). Default 2000. */
  graceMs?: number;
}

type Cue = { startMs: number; endMs: number; text: string };

interface Internal {
  resolved: Resolved;
  picked: { url: string; bytes: number; key: string };
  prefetched: boolean;
  /** The time by which the first frame must be there. */
  answerBy: number;
}

interface Active {
  playId: string;
  video?: HTMLVideoElement | undefined;
  /** Ends the clip on screen as skipped. */
  skipVideo?: (() => void) | undefined;
  /** Ends the wait for the in-engine beat as skipped. */
  skipFallback?: (() => void) | undefined;
}

type Prep = { clip: PreparedClip } | { fallback: FallbackTrigger; entry?: CutsceneIndexEntry };
type Item = { ref: CutsceneRefId | null; fallback: string };

const isMobile = (tier: string): boolean => tier.startsWith('mobile');
const fallbackOutcome = (trigger: FallbackTrigger, skipped = false): CutsceneOutcome => ({ path: 'fallback', skipped, trigger });

function summarize(outs: readonly CutsceneOutcome[]): CutsceneOutcome {
  const trigger = outs.find((o) => o.trigger !== undefined)?.trigger;
  return { path: outs.some((o) => o.path === 'video') ? 'video' : 'fallback', skipped: outs.some((o) => o.skipped), ...(trigger !== undefined ? { trigger } : {}) };
}

export class CutscenePlayerImpl implements CutscenePlayer {
  private readonly internals = new WeakMap<PreparedClip, Internal>();
  private readonly prefetchCache = new Map<CutsceneRefId, Promise<Resolution>>();
  private readonly t0 = new Map<string, number>();
  private readonly activePlays = new Map<string, Active>();

  constructor(private readonly deps: PlayerDeps) {}

  /** Plays with a clip on screen or a fallback running (the QA bridge reads it). */
  get playing(): string[] {
    return [...this.activePlays.keys()];
  }

  // ---------------------------------------------------------------- C09 interface

  async prepare(playId: string, refs: CutsceneRefId[]): Promise<{ clips: PreparedClip[] } | { fallback: FallbackTrigger }> {
    if (!this.t0.has(playId)) this.t0.set(playId, this.deps.timers.now());
    const clips: PreparedClip[] = [];
    for (const ref of refs) {
      const p = await this.prepareItem(playId, ref);
      if ('fallback' in p) {
        this.releaseClips(clips);
        emitPlay(this.deps.telemetry, p.entry?.key ?? null, false, fallbackOutcome(p.fallback));
        return { fallback: p.fallback };
      }
      clips.push(p.clip);
    }
    return { clips };
  }

  play(playId: string, clips: PreparedClip[]): Promise<CutsceneOutcome> {
    const clip = clips[0];
    if (!clip) return Promise.resolve(fallbackOutcome('not_ready'));
    this.releaseClips(clips.slice(1));
    return this.playClip(playId, clip, { item: undefined, sendDone: true, keepHost: () => Promise.resolve(false) });
  }

  async playSequence(playId: string, items: Item[]): Promise<CutsceneOutcome[]> {
    if (!this.t0.has(playId)) this.t0.set(playId, this.deps.timers.now());
    let outcomes = await this.tryMse(playId, items);
    if (outcomes === null) {
      outcomes = [];
      // Ping-pong: the next clip is prepared and pre-rolled while this one plays (two pooled elements at most).
      let next: Promise<Prep> | null = items.length > 0 ? this.prepareItem(playId, items[0]?.ref ?? null) : null;
      for (let i = 0; i < items.length; i++) {
        const cur = (await next) as Prep;
        const upcoming: Promise<Prep> | null = i + 1 < items.length ? this.prepareItem(playId, items[i + 1]?.ref ?? null) : null;
        next = upcoming;
        const out = await this.runItem(playId, i, items[i] as Item, cur, async () => (upcoming !== null ? 'clip' in (await upcoming) : false));
        outcomes.push(out);
        if (out.skipped) {
          // A skip ends the whole sequence: the clip that was being pre-rolled goes back, the rest is not played.
          void upcoming?.then((p) => {
            if ('clip' in p) this.releaseClips([p.clip]);
          });
          for (let k = i + 1; k < items.length; k++) outcomes.push({ path: 'fallback', skipped: true });
          break;
        }
      }
    }
    this.deps.send({ t: 'cutscene.state', playId, state: 'done', outcome: summarize(outcomes) });
    this.finishPlay(playId);
    return outcomes;
  }

  skip(playId: string): void {
    const a = this.activePlays.get(playId);
    a?.skipVideo?.();
    a?.skipFallback?.();
  }

  prefetch(refs: CutsceneRefId[]): void {
    const ahead = isMobile(this.deps.tier()) ? this.deps.cfg.prefetchAheadMobile : this.deps.cfg.prefetchAheadDesktop;
    for (const ref of refs.slice(0, ahead)) {
      if (this.prefetchCache.has(ref)) continue;
      const p = resolveRef(this.deps, ref, true);
      this.prefetchCache.set(ref, p);
      void p.then((r) => {
        if (r.ok) this.deps.warm?.([`${r.base}${r.manifest.poster}`, ...(r.manifest.audio ? [`${r.base}${r.manifest.audio.file}`] : [])]);
        else this.prefetchCache.delete(ref);
      });
    }
  }

  // ---------------------------------------------------------------- the sim's request

  /**
   * The answer to a sim `cut.request`: one ref plays as a single clip; several refs (or a null item) as a sequence. It always
   * answers the sim within the deadline of section D7: when preparing is not done by then the answer is `fallback`.
   */
  async request(playId: string, refs: (CutsceneRefId | null)[], fallbacks: readonly string[] = []): Promise<CutsceneOutcome[]> {
    this.t0.set(playId, this.deps.timers.now());
    const items: Item[] = refs.map((ref, i) => ({ ref, fallback: fallbacks[i] ?? '' }));
    const single = refs.length === 1 ? (refs[0] ?? null) : null;
    if (single === null) return this.playSequence(playId, items);
    const entry = this.entryOf(single);
    const cues = (): Cue[] => this.cuesFor(entry, items[0]?.fallback ?? '');
    if (this.deps.force?.() === 'fallback') {
      emitPlay(this.deps.telemetry, entry?.key ?? null, false, fallbackOutcome('not_ready'));
      return [await this.fallbackItem(playId, undefined, 'not_ready', cues(), true)];
    }
    const cfg = this.deps.cfg;
    const window = this.prefetchCache.has(single) ? cfg.answerDeadlinePrefetchedMs : cfg.answerDeadlineMs;
    const prepared = this.prepare(playId, [single]);
    const raced = await within<{ clips: PreparedClip[] } | { fallback: FallbackTrigger } | 'late'>(prepared, window, this.deps.timers, 'late');
    if (raced === 'late') {
      // Preparing outlived the deadline: answer `fallback` now and let the late result go.
      void prepared.then((p) => {
        if ('clips' in p) this.releaseClips(p.clips);
      });
      emitPlay(this.deps.telemetry, entry?.key ?? null, false, fallbackOutcome('not_ready'));
      return [await this.fallbackItem(playId, undefined, 'not_ready', cues(), true)];
    }
    if ('fallback' in raced) return [await this.fallbackItem(playId, undefined, raced.fallback, cues(), true)];
    return [await this.play(playId, raced.clips)];
  }

  /** QA: freezes the clip that plays, so that the `waiting` watch fires (the e2e of a mid-play stall). */
  qaStall(playId?: string): boolean {
    for (const a of this.activePlays.values()) {
      if (playId !== undefined && a.playId !== playId) continue;
      if (a.video) {
        a.video.pause();
        a.video.dispatchEvent(new Event('waiting'));
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- resolution and preparation

  private entryOf(ref: CutsceneRefId): CutsceneIndexEntry | undefined {
    return this.deps.index()?.entries.find((e) => e.ref === ref);
  }

  private async resolve(ref: CutsceneRefId): Promise<Resolution> {
    const cached = this.prefetchCache.get(ref);
    if (cached) {
      this.prefetchCache.delete(ref);
      const r = await cached;
      if (r.ok) return r;
    }
    return resolveRef(this.deps, ref, false);
  }

  private async prepareItem(playId: string, ref: CutsceneRefId | null): Promise<Prep> {
    if (ref === null) return { fallback: 'not_ready' };
    const r = await this.resolve(ref);
    if (!r.ok) return { fallback: r.trigger, ...(r.entry ? { entry: r.entry } : {}) };
    return this.prepareClip(playId, r);
  }

  private async prepareClip(playId: string, r: Resolved): Promise<Prep> {
    const { deps } = this;
    const { entry, manifest } = r;
    if (deps.unlocked) await deps.unlocked();
    const video = deps.unlock.acquireVideo();
    if (video === null) return { fallback: 'not_permitted', entry };
    const candidates = renditionCandidates(manifest, {
      dataSaver: deps.dataSaver(),
      throughputMbps: deps.throughputMbps(),
      screenHeightPx: deps.screenHeightPx(),
      baseUrl: r.base,
      cfg: deps.cfg,
      canPlayType: (t) => video.canPlayType(t),
    });
    const give = (trigger: FallbackTrigger): Prep => {
      deps.unlock.releaseVideo(video);
      return { fallback: trigger, entry };
    };
    if (candidates.length === 0) return give('codec');
    // Above 85 % of the mobile media line the next smaller rendition is tried (v540); when none fits the play falls back.
    const picked = candidates.find((c) => !overBudget(deps.budget, c.rendition.bytes, deps.cfg.budgetFraction));
    if (picked === undefined) return give('budget');
    if (!deps.budget.prepare(entry.key, picked.rendition.bytes).ok) return give('budget');

    video.muted = true;
    video.poster = `${r.base}${manifest.poster}`;
    video.src = picked.url;
    video.load();
    const clip: PreparedClip = {
      key: entry.key,
      source: { kind: 'element', video },
      width: manifest.width,
      height: manifest.height,
      durationMs: Math.round((manifest.frames / manifest.fps) * 1000),
      cues: this.cueTexts(entry.cues),
      degraded: manifest.degraded === true,
      aiGenerated: true,
      ...(manifest.licence.uiCredit ? { uiCredit: manifest.licence.uiCredit } : {}),
      posterUrl: `${r.base}${manifest.poster}`,
      lastUrl: `${r.base}${manifest.last}`,
    };
    const started = this.t0.get(playId) ?? deps.timers.now();
    this.internals.set(clip, {
      resolved: r,
      picked: { url: picked.url, bytes: picked.rendition.bytes, key: picked.key },
      prefetched: r.prefetched,
      answerBy: started + (r.prefetched ? deps.cfg.startStallPrefetchedMs : deps.cfg.startStallMs),
    });
    return { clip };
  }

  private releaseClips(clips: readonly PreparedClip[]): void {
    for (const c of clips) {
      if (c.source.kind !== 'element') continue;
      const video = c.source.video;
      this.deps.budget.release(c.key);
      video.removeAttribute('src');
      video.load();
      this.deps.unlock.releaseVideo(video);
    }
  }

  private cueTexts(cues: readonly CueSpec[]): Cue[] {
    return cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: this.deps.lineText(c.line) }));
  }

  private cuesFor(entry: CutsceneIndexEntry | undefined, directorId: string): Cue[] {
    return this.cueTexts(entry?.cues ?? this.deps.fallbackCues?.(directorId) ?? []);
  }

  // ---------------------------------------------------------------- one item of a play

  private answer(playId: string, item: number | undefined, state: 'video' | 'fallback', trigger?: FallbackTrigger): void {
    this.deps.send({ t: 'cutscene.state', playId, ...(item !== undefined ? { item } : {}), state, ...(trigger !== undefined ? { trigger } : {}) });
  }

  private begin(playId: string): Active {
    let a = this.activePlays.get(playId);
    if (!a) {
      a = { playId };
      this.activePlays.set(playId, a);
    }
    return a;
  }

  private finishPlay(playId: string): void {
    this.activePlays.delete(playId);
    this.t0.delete(playId);
  }

  private async runItem(playId: string, item: number, it: Item, p: Prep, keepHost: () => Promise<boolean>): Promise<CutsceneOutcome> {
    if ('fallback' in p) {
      emitPlay(this.deps.telemetry, p.entry?.key ?? null, false, fallbackOutcome(p.fallback));
      return this.fallbackItem(playId, item, p.fallback, this.cuesFor(p.entry, it.fallback), false);
    }
    return this.playClip(playId, p.clip, { item, sendDone: false, keepHost, inSequence: true });
  }

  /**
   * Shows the cues over the live world and waits until the sim has finished the in-engine beat (or the beat is skipped).
   * Returns whether it was skipped. The host stays as it is: a still image (mid-play stall) stays up under the cues.
   */
  private async waitInEngine(playId: string, item: number | undefined, cues: Cue[]): Promise<boolean> {
    const { deps } = this;
    const act = this.begin(playId);
    deps.host.showCues();
    deps.overlay.show({ aiGenerated: false, cues });
    const started = deps.timers.now();
    const tick = new Watch(deps.timers);
    const loop = (): void => {
      deps.overlay.setTime(deps.timers.now() - started);
      tick.arm(50, loop);
    };
    loop();
    let skipped = false;
    const skipWait = new Promise<void>((res) => {
      act.skipFallback = () => {
        skipped = true;
        res();
      };
    });
    try {
      await Promise.race([deps.fallbackDone(playId, item).catch(() => undefined), skipWait]);
    } finally {
      tick.clear();
      act.skipFallback = undefined;
      deps.overlay.hide();
    }
    return skipped;
  }

  /** The in-engine path: answer `fallback`, then wait for the sim to finish the beat behind the cues. */
  private async fallbackItem(playId: string, item: number | undefined, trigger: FallbackTrigger, cues: Cue[], sendDone: boolean, answered = false): Promise<CutsceneOutcome> {
    const { deps } = this;
    if (!answered) this.answer(playId, item, 'fallback', trigger);
    const skipped = await this.waitInEngine(playId, item, cues);
    deps.host.hideCues();
    await deps.host.hide();
    const outcome = fallbackOutcome(trigger, skipped);
    if (sendDone) {
      deps.send({ t: 'cutscene.state', playId, state: 'done', outcome });
      this.finishPlay(playId);
    }
    return outcome;
  }

  private async playClip(
    playId: string,
    clip: PreparedClip,
    o: { item: number | undefined; sendDone: boolean; keepHost: () => Promise<boolean>; inSequence?: boolean },
  ): Promise<CutsceneOutcome> {
    const { deps } = this;
    const info = this.internals.get(clip);
    const video = clip.source.kind === 'element' ? clip.source.video : null;
    if (!info || video === null) return fallbackOutcome('not_ready');
    const act = this.begin(playId);
    const { timers, host, overlay } = deps;
    const cfg = deps.cfg;
    const key = clip.key;
    const watch = new Watch(timers); // the lost-`ended` cap
    const midWatch = new Watch(timers); // `waiting` for longer than midStallMs
    const frame = new Watch(timers); // the subtitle clock
    let sync: AudioSync | null = null;
    let over = false;
    let shown = false;
    let finish: (out: CutsceneOutcome) => void = () => undefined;
    const done = new Promise<CutsceneOutcome>((res) => {
      finish = res;
    });

    const stopWatches = (): void => {
      watch.clear();
      midWatch.clear();
      frame.clear();
      sync?.stop();
      deps.audio?.stop();
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      act.video = undefined;
      act.skipVideo = undefined;
    };
    const giveBack = (): void => {
      deps.budget.release(key);
      video.removeAttribute('src');
      video.load();
      deps.unlock.releaseVideo(video);
    };
    const send = (out: CutsceneOutcome): void => {
      if (!o.sendDone) return;
      deps.send({ t: 'cutscene.state', playId, state: 'done', outcome: out });
      this.finishPlay(playId);
    };
    /** The clip ended or was skipped. */
    const conclude = async (out: CutsceneOutcome): Promise<void> => {
      if (over) return;
      over = true;
      const final: CutsceneOutcome = o.inSequence && clip.degraded && out.path === 'video' && out.trigger === undefined ? { ...out, trigger: 'degraded_sequence' } : out;
      emitPlay(deps.telemetry, key, info.prefetched, final);
      stopWatches();
      overlay.hide();
      // Back to back in a sequence the host keeps covering the screen for the next clip.
      const keep = !final.skipped && final.path === 'video' ? await o.keepHost() : false;
      if (shown && !keep) await host.hide();
      giveBack();
      send(final);
      finish(final);
    };
    /** The clip failed before or at its first frame or its first `play()`: back to the world and the in-engine beat. */
    const failEarly = async (trigger: FallbackTrigger): Promise<void> => {
      if (over) return;
      over = true;
      emitPlay(deps.telemetry, key, info.prefetched, fallbackOutcome(trigger));
      stopWatches();
      overlay.hide();
      if (shown) await host.hide();
      giveBack();
      this.answer(playId, o.item, 'fallback', trigger);
      finish(await this.fallbackItem(playId, o.item, trigger, clip.cues, o.sendDone, true));
    };
    /** The clip failed while it showed: hold `last.webp`, let the sim run the DirectorScript behind it, then uncover. */
    const failMid = async (trigger: FallbackTrigger): Promise<void> => {
      if (over) return;
      over = true;
      emitPlay(deps.telemetry, key, info.prefetched, fallbackOutcome(trigger));
      stopWatches();
      overlay.hide();
      host.holdStill(clip.lastUrl);
      giveBack();
      this.answer(playId, o.item, 'fallback', trigger);
      const skipped = await this.waitInEngine(playId, o.item, clip.cues);
      await host.hide();
      const out = fallbackOutcome(trigger, skipped);
      send(out);
      finish(out);
    };

    const onEnded = (): void => void conclude({ path: 'video', skipped: false });
    const onPlaying = (): void => midWatch.clear();
    const onWaiting = (): void => {
      if (!over) midWatch.arm(cfg.midStallMs, () => void failMid('mid_stall'));
    };
    const onError = (): void => void failMid('media_error');

    // 1. pre-roll to the first frame, inside the answer window
    // The window runs from the request for a single clip; a later item of a sequence gets a fresh one when its turn comes.
    const window = info.prefetched ? cfg.startStallPrefetchedMs : cfg.startStallMs;
    const until = o.inSequence && (o.item ?? 0) > 0 ? timers.now() + window : info.answerBy;
    const first = await this.firstFrame(video, Math.max(0, until - timers.now()));
    if (first !== 'ok') {
      await failEarly(first);
      return done;
    }

    // 2. the sim hears `video` before the host pauses it
    this.answer(playId, o.item, 'video');
    video.addEventListener('ended', onEnded);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    act.video = video;
    act.skipVideo = () => void conclude({ path: 'video', skipped: true });
    await host.show(video);
    shown = true;
    overlay.show({ aiGenerated: clip.aiGenerated, ...(clip.uiCredit ? { credit: clip.uiCredit } : {}), cues: clip.cues });

    // 3. play; a refusal on a mobile tier gets the tap prompt
    let started = await this.startPlayback(video);
    if (started === 'not_permitted' && isMobile(deps.tier()) && !over) {
      if (await host.waitForTap(deps.tapLabel(), cfg.tapToPlayMs)) started = await this.startPlayback(video);
    }
    if (started !== true) {
      await failEarly(started);
      return done;
    }
    if (over) return done;

    // 4. audio and the subtitle clock
    const manifest = info.resolved.manifest;
    if (deps.audio) {
      const generated = (deps.audioMode?.() ?? 'generated') === 'generated';
      if (info.resolved.entry.audio === 'generated-ambient' && manifest.audio !== undefined && ambientAllowed(manifest.audio) && generated) {
        void deps.audio.startAmbient(`${info.resolved.base}${manifest.audio.file}`).catch(() => undefined);
        sync = new AudioSync(video, deps.audio, timers, cfg);
        sync.start();
      } else if (info.resolved.entry.audio === 'engine') deps.audio.startLines(info.resolved.entry.cues);
    }
    const clock = (): void => {
      overlay.setTime(video.currentTime * 1000);
      frame.arm(50, clock);
    };
    clock();
    watch.arm(clip.durationMs + (deps.graceMs ?? 2000), () => void conclude({ path: 'video', skipped: false }));
    return done;
  }

  /** Resolves `ok` when the element has its first frame, else the trigger: `start_stall`, `codec` or `media_error`. */
  private firstFrame(video: HTMLVideoElement, ms: number): Promise<'ok' | FallbackTrigger> {
    // The element may have settled between `prepare` and `play`, before these listeners existed.
    if (video.error) return Promise.resolve(video.error.code === 4 ? 'codec' : 'media_error');
    if (video.readyState >= 2) return Promise.resolve('ok');
    const { timers } = this.deps;
    return new Promise((resolve) => {
      const watch = new Watch(timers);
      const settle = (r: 'ok' | FallbackTrigger): void => {
        watch.clear();
        video.removeEventListener('loadeddata', onData);
        video.removeEventListener('error', onErr);
        resolve(r);
      };
      const onData = (): void => settle('ok');
      const onErr = (): void => settle(video.error?.code === 4 ? 'codec' : 'media_error');
      video.addEventListener('loadeddata', onData);
      video.addEventListener('error', onErr);
      watch.arm(ms, () => settle('start_stall'));
    });
  }

  private async startPlayback(video: HTMLVideoElement): Promise<true | 'not_permitted' | 'media_error'> {
    try {
      await video.play();
      return true;
    } catch (e) {
      return (e as { name?: string } | null)?.name === 'NotAllowedError' ? 'not_permitted' : 'media_error';
    }
  }

  // ---------------------------------------------------------------- MSE `sequence` joining

  /**
   * One element carries the whole run when every item is ready, none is degraded, every rendition is an fMP4 file and the browser
   * accepts the type. Returns null when any of that fails (the caller then ping-pongs); no sim command was sent by then.
   */
  private async tryMse(playId: string, items: Item[]): Promise<CutsceneOutcome[] | null> {
    const { deps } = this;
    const mse = deps.mse;
    if (!mse || items.length < 2 || items.some((i) => i.ref === null) || mseClass(mse.globals) === null) return null;
    const rs = await Promise.all(items.map((i) => this.resolve(i.ref as CutsceneRefId)));
    const ok = rs.filter((r): r is Resolved => r.ok);
    if (ok.length !== rs.length || ok.some((r) => r.manifest.degraded === true)) return null;
    if (deps.unlocked) await deps.unlocked();
    const video = deps.unlock.acquireVideo();
    if (video === null) return null;
    const mseItems: MseItem[] = [];
    for (const r of ok) {
      const cand = renditionCandidates(r.manifest, {
        dataSaver: deps.dataSaver(), throughputMbps: deps.throughputMbps(), screenHeightPx: deps.screenHeightPx(), baseUrl: r.base, cfg: deps.cfg, canPlayType: (t) => video.canPlayType(t),
      }).find((c) => c.rendition.file.endsWith('.mp4'));
      if (!cand) break;
      mseItems.push({ picked: cand, durationMs: Math.round((r.manifest.frames / r.manifest.fps) * 1000), degraded: false });
    }
    const bytes = mseItems.reduce((n, m) => n + m.picked.rendition.bytes, 0);
    const slotKey = `seq:${playId}`;
    if (mseItems.length !== ok.length || !canJoinWithMse(mseItems, mse.globals) || !deps.budget.prepare(slotKey, bytes).ok) {
      deps.unlock.releaseVideo(video);
      return null;
    }
    const act = this.begin(playId);
    const cues = ok.flatMap((r) => this.cueTexts(r.entry.cues));
    this.answer(playId, 0, 'video');
    await deps.host.show(video);
    deps.overlay.show({ aiGenerated: true, cues });
    let skipped = false;
    let stop: () => void = () => undefined;
    const aborted = new Promise<'skip'>((res) => {
      stop = () => res('skip');
    });
    act.skipVideo = () => {
      skipped = true;
      stop();
    };
    const run = playMseRun(video, mseItems, mse, deps.timers, (i) => {
      if (i > 0) this.answer(playId, i, 'video');
    });
    const res = await Promise.race([run, aborted]);
    act.skipVideo = undefined;
    deps.overlay.hide();
    await deps.host.hide();
    deps.budget.release(slotKey);
    video.removeAttribute('src');
    video.load();
    deps.unlock.releaseVideo(video);
    const good = res === 'skip' || res.ok;
    const outs = items.map((): CutsceneOutcome => (good ? { path: 'video', skipped } : fallbackOutcome('media_error')));
    outs.forEach((out, i) => emitPlay(deps.telemetry, ok[i]?.entry.key ?? null, false, out));
    return outs;
  }
}
