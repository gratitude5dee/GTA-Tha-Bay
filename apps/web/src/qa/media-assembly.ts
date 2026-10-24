/**
 * QA wiring of the flat cutscene path (M04c): the DOM host, the media budget, the wake lock, the overlay and the spike player around a
 * `FirstGestureUnlock` pool. The QA page (`media-bridge.ts`) and the game page (`media-game.ts`) both use it. QA builds only.
 */
import { DomCutsceneHost, MediaBudget, ScreenWakeLock, type FirstGestureUnlock, type HostElement, type LoopControl, type SimPause } from '@dv/engine/platform/media';
import { SpikePlayer, type SpikeFixture } from '@dv/engine/platform/media/spike-player';
import type { CutsceneManifest } from '@dv/shared/contracts/c09-cutscene';
import { mountCutsceneOverlay } from '@dv/ui/cutscene';
import { parseVtt } from '@dv/ui/cutscene/subtitles';

export interface MediaQaOptions {
  unlock: FirstGestureUnlock;
  loop: LoopControl;
  sim: SimPause;
  tier: string;
  dataSaver: () => boolean;
}

export interface MediaQa {
  player: SpikePlayer;
  host: DomCutsceneHost;
  budget: MediaBudget;
  wakeLock: ScreenWakeLock;
}

export async function loadFixture(id: string): Promise<SpikeFixture> {
  const baseUrl = `/media-local/cutscenes/${id}/`;
  const res = await fetch(`${baseUrl}manifest.json`);
  if (!res.ok) throw new Error(`fixture ${id}: ${res.status}`);
  const manifest = (await res.json()) as CutsceneManifest;
  const subs = manifest.subs['en'];
  const vtt = subs ? await (await fetch(`${baseUrl}${subs}`)).text() : '';
  return { id, baseUrl, manifest, cues: parseVtt(vtt) };
}

export function createMediaQa(o: MediaQaOptions): MediaQa {
  const wakeLock = new ScreenWakeLock(navigator as never, document);
  const host = new DomCutsceneHost({
    parent: document.body as unknown as HostElement,
    createElement: (tag) => document.createElement(tag) as unknown as HostElement,
    loop: o.loop,
    sim: o.sim,
    tier: o.tier,
    wakeLock,
    root: document.documentElement,
  });
  const budget = new MediaBudget({ maxMediaMB: o.tier.startsWith('mobile') ? 64 : null });
  const ref: { player?: SpikePlayer } = {};
  const overlay = mountCutsceneOverlay(host.overlayRoot as unknown as Element, {
    sendUi: (cmd) => {
      if (cmd.t === 'cutscene.skip') void ref.player?.skip();
    },
  });
  const player = new SpikePlayer({ unlock: o.unlock, host, budget, overlay, loadFixture, dataSaver: o.dataSaver });
  ref.player = player;
  return { player, host, budget, wakeLock };
}
