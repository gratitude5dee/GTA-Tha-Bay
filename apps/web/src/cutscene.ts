/**
 * The page side of the cutscene protocol (M05b2; spec/domains/03-story-cutscenes.md section D7). The sim's `beat` op emits
 * `cut.request` and arms the in-engine DirectorScript; this module hands the request to the `CutscenePlayer`, which resolves the ref
 * through the shipped index, route 27 and the manifest, plays the clip on the flat DOM host or falls back, and answers the sim with
 * `UiCommand cutscene.state`. The sim's `cut.done` event ends a wait for the in-engine beat.
 *
 * QA builds (`VITE_DV_QA=1`) add `window.__dvBridge.cutscene` and two switches: `?beats=video` serves the fixture clip for every
 * request (no route 27), `?beats=fallback` answers every request with the fallback. Production builds have neither.
 */
import type { EngineHandle } from '@dv/engine/client/boot';
import { CUTSCENE_CONFIG, CutscenePlayerImpl, createWebAudioCutscene, type PlayerDeps } from '@dv/engine/client/cutscene';
import type { Platform } from '@dv/engine/platform';
import { DomCutsceneHost, MediaBudget, ScreenWakeLock, type HostElement } from '@dv/engine/platform/media';
import type { CutsceneStatus, UiCommand } from '@dv/shared';
import type { CutsceneIndex, CutsceneManifest, CutsceneRefId } from '@dv/shared/contracts/c09-cutscene';
import { t } from '@dv/ui';
import { mountCutsceneOverlay } from '@dv/ui/cutscene';
import platformFlags from '../../../config/platform-flags.json';

export interface CutsceneGlueOptions {
  qa: boolean;
  /** `?beats=`; only `video` and `fallback` change what the player does (`instant` is the sim's). */
  beats: 'instant' | 'fallback' | 'video' | null;
  /** The shipped index when the page already has it (QA bundle); otherwise it is read from the asset catalog. */
  index?: CutsceneIndex | null;
  /** Text of the lines the cues name (the QA mission bundle). */
  lines?: Readonly<Record<string, string>>;
  /**
   * The same-origin manifest every request resolves to under `?beats=video` (QA builds only: `qa/missions.ts` hands it over, so the
   * production bundle carries no `media-local` path; M01e, verify-dist).
   */
  fixtureManifest?: string;
}

export type SimEventLike = { t: string; tick: number; n?: number; s?: string };

export interface CutsceneGlue {
  player: CutscenePlayerImpl;
  host: DomCutsceneHost;
  /** Feeds sim events (`cut.request`, `cut.done`); other events are ignored. */
  handleEvents(events: readonly SimEventLike[]): void;
  /** What happened, oldest first (the last 60); the QA bridge reads it. */
  log: () => readonly CutsceneLogEntry[];
  dispose(): void;
}

export type CutsceneLogEntry = { at: number } & (
  | { k: 'request'; n: number; refs: (string | null)[] }
  | { k: 'cmd'; cmd: UiCommand }
  | { k: 'done'; n: number }
  | { k: 'play'; props: Record<string, unknown> }
);

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

async function loadShippedIndex(assets: NonNullable<Platform['assets']>): Promise<CutsceneIndex | null> {
  try {
    if ((await assets.loadCatalog()) !== 'ready') return null;
    const bytes = await assets.get('data/cutscene-index');
    return JSON.parse(new TextDecoder().decode(bytes)) as CutsceneIndex;
  } catch {
    return null;
  }
}

export function installCutscenes(engine: EngineHandle, platform: Platform, o: CutsceneGlueOptions): CutsceneGlue {
  const log: CutsceneLogEntry[] = [];
  const note = (e: DistributiveOmit<CutsceneLogEntry, 'at'>): void => {
    log.push({ ...e, at: performance.now() } as CutsceneLogEntry);
    if (log.length > 60) log.shift();
  };
  let index: CutsceneIndex | null = o.index ?? null;
  if (index === null && platform.assets) {
    void loadShippedIndex(platform.assets).then((i) => {
      index ??= i;
    });
  }

  const tier = platform.quality.tier.id;
  const wakeLock = new ScreenWakeLock(navigator as never, document);
  const host = new DomCutsceneHost({
    parent: document.body as unknown as HostElement,
    createElement: (tag) => document.createElement(tag) as unknown as HostElement,
    loop: platform.host,
    sim: engine,
    tier,
    wakeLock,
    root: document.documentElement,
  });
  const budget = new MediaBudget({ maxMediaMB: tier.startsWith('mobile') ? CUTSCENE_CONFIG.mobileMediaBudgetMB : null });
  const holder: { player?: CutscenePlayerImpl } = {};
  const overlay = mountCutsceneOverlay(host.overlayRoot as unknown as Element, {
    sendUi: (cmd) => {
      if (cmd.t !== 'cutscene.skip') return;
      for (const id of holder.player?.playing ?? []) holder.player?.skip(id);
    },
  });

  // `cut.done` ends a wait for the in-engine beat; a done that came before the wait started is remembered.
  const doneWaiters = new Map<string, (() => void)[]>();
  const doneSeen: string[] = [];
  const doneKey = (n: number | string, item?: number | string): string => `${n}:${item ?? ''}`;

  const sys = (): { cutscenes?: { generated?: boolean; audio?: 'generated' | 'engine' } } | undefined => engine.vm.get('sys.settings') as ReturnType<typeof sys>;

  const deps: PlayerDeps = {
    index: () => index,
    suppressed: () => false, // RosterFlags arrive with the roster refresh (M06/M10); a kill reaches the player as route 27 `blocked`
    settings: () => ({ generated: sys()?.cutscenes?.generated !== false }),
    bootEnabled: () => (platformFlags as Record<string, unknown>)['cutscene.generated'] !== false,
    online: () => navigator.onLine,
    status: async (key): Promise<CutsceneStatus | null> => {
      if (o.qa && o.beats === 'video' && o.fixtureManifest) return { key, state: 'ready', manifestUrl: new URL(o.fixtureManifest, location.origin).href };
      try {
        const res = await fetch(`/api/v1/cutscenes/${key}`, { credentials: 'same-origin' });
        return res.ok ? ((await res.json()) as CutsceneStatus) : null;
      } catch {
        return null;
      }
    },
    fetchManifest: async (url): Promise<CutsceneManifest | null> => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        return res.ok ? ((await res.json()) as CutsceneManifest) : null;
      } catch {
        return null;
      }
    },
    timers: { now: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    cfg: CUTSCENE_CONFIG,
    strictKey: !o.qa,
    unlock: engine.media,
    // QA pages only: a clip takes a pooled element once the stand-in unlock (started with the request) has finished.
    ...(o.qa ? { unlocked: () => engine.media.trigger().catch(() => undefined) } : {}),
    host,
    budget,
    overlay,
    send: (cmd) => {
      note({ k: 'cmd', cmd });
      engine.sendUi(cmd);
    },
    tier: () => tier,
    dataSaver: () => platform.settings.dataSaver,
    screenHeightPx: () => Math.round(window.screen.height * window.devicePixelRatio),
    throughputMbps: () => {
      const c = (navigator as { connection?: { downlink?: number } }).connection;
      return typeof c?.downlink === 'number' ? c.downlink : null;
    },
    lineText: (id) => o.lines?.[id] ?? t(id as never),
    fallbackDone: (playId, item) =>
      new Promise<void>((resolve) => {
        const key = doneKey(playId, item);
        if (doneSeen.includes(key)) return resolve();
        doneWaiters.set(key, [...(doneWaiters.get(key) ?? []), resolve]);
      }),
    audioMode: () => sys()?.cutscenes?.audio ?? 'engine',
    ...(engine.audioService ? { audio: createWebAudioCutscene(engine.audioService, async (url) => (await fetch(url)).arrayBuffer()) } : {}),
    telemetry: (name, props) => {
      note({ k: 'play', props });
      platform.telemetry.emit(name as never, props as never);
    },
    tapLabel: () => t('cutscene.tapToPlay'),
    force: () => (o.qa && (o.beats === 'fallback' || o.beats === 'video') ? o.beats : null),
    warm: (urls) => {
      for (const u of urls) void fetch(u, { priority: 'low' } as RequestInit).catch(() => undefined);
    },
  };
  const player = new CutscenePlayerImpl(deps);
  holder.player = player;

  const handleEvents = (events: readonly SimEventLike[]): void => {
    for (const e of events) {
      if (e.t === 'cut.request' && e.n !== undefined) {
        const refs = (e.s ?? '').split(',').map((r) => (r === '' ? null : r));
        note({ k: 'request', n: e.n, refs });
        const fallbacks = refs.map((r) => index?.entries.find((x) => x.ref === r)?.fallback ?? '');
        const play = async (): Promise<void> => {
          // QA pages skip the Title, so nothing has unlocked the pooled elements; a player's page has (FirstGestureUnlock). A QA
          // `?mission=` page starts the stand-in unlock at boot (boot-engine.ts); any other QA page starts it here. It is not awaited
          // before the request: section D7 counts the 2.5 s answer window from the sim's request, and on a software-GL runner the blank
          // plays took 2 to 3 s. Only a clip waits for it, inside that window (`unlocked` below, BD-FIX-CI7-D02).
          if (o.qa && !engine.media.state().unlocked) void engine.media.trigger().catch(() => undefined);
          await player.request(String(e.n), refs as (CutsceneRefId | null)[], fallbacks);
        };
        void play().catch((err: unknown) => console.warn('cutscene request failed', err));
      } else if (e.t === 'cut.done' && e.n !== undefined) {
        note({ k: 'done', n: e.n });
        const key = doneKey(e.n, e.s);
        doneSeen.push(key);
        if (doneSeen.length > 20) doneSeen.shift();
        for (const w of doneWaiters.get(key) ?? []) w();
        doneWaiters.delete(key);
      }
    }
  };

  return {
    player,
    host,
    handleEvents,
    log: () => log,
    dispose: () => overlay.hide(),
  };
}
