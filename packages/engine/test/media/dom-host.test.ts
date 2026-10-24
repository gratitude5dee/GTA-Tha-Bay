import { describe, expect, it } from 'vitest';
import { DomCutsceneHost, pickRendition, type HostElement } from '../../src/platform/media/dom-host.ts';
import { ScreenWakeLock } from '../../src/platform/media/wake-lock.ts';
import { FakeEl, FakeVideo } from './fakes.ts';

function setup(tier: string, nav: object = { wakeLock: undefined }) {
  const log: string[] = [];
  const locks: { released: boolean }[] = [];
  const navigator = 'wakeLock' in nav && nav.wakeLock === undefined ? {} : {
    wakeLock: {
      request: (type: 'screen') => {
        log.push(`wake:${type}`);
        const s = { released: false, release: () => { s.released = true; log.push('wake:release'); return Promise.resolve(); } };
        locks.push(s);
        return Promise.resolve(s);
      },
    },
  };
  const warnings: string[] = [];
  const doc = { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined };
  const wakeLock = new ScreenWakeLock(navigator, doc, (m) => warnings.push(m));
  const sim = { paused: false, setPaused(p: boolean) { this.paused = p; log.push(`sim.paused=${p}`); } };
  const holds = new Set<string>();
  let armed = (): boolean => true;
  const loop = {
    stopLoop: () => log.push('setAnimationLoop(null)'),
    startLoop: () => log.push('startLoop'),
    holdWorld: (kind: 'cover' | 'frame', a?: () => boolean): (() => void) => {
      if (a) armed = a;
      holds.add(kind);
      log.push(`hold:${kind}`);
      return () => {
        if (holds.delete(kind)) log.push(`release:${kind}`);
      };
    },
  };
  const parent = new FakeEl();
  const root = new Map<string, string>();
  const frameArmed = { value: false };
  const host = new DomCutsceneHost({
    parent: parent as HostElement,
    createElement: () => new FakeEl(),
    loop,
    sim,
    tier,
    wakeLock,
    root: { setAttribute: (n, v) => void root.set(n, v), removeAttribute: (n) => void root.delete(n) },
    frameArmed: () => frameArmed.value,
  });
  return { host, log, locks, warnings, sim, parent, root, wakeLock, holds, frameArmed, armed: () => armed() };
}

describe('DomCutsceneHost (AC-2)', () => {
  it('on mobile-low: show stops the loop, pauses the sim and holds a screen wake lock; hide undoes all of it and releases the src', async () => {
    const t = setup('mobile-low', {});
    const video = new FakeVideo();
    video.src = 'blob:clip';
    video.setAttribute('src', 'blob:clip');
    await t.host.show(video as unknown as HTMLVideoElement);
    expect(t.log).toEqual(['setAnimationLoop(null)', 'sim.paused=true', 'wake:screen']);
    expect(t.sim.paused).toBe(true);
    expect(t.wakeLock.held).toBe(true);
    expect(t.parent.children).toHaveLength(1);
    expect(video.style['objectFit']).toBe('contain');
    expect(t.root.get('data-dv-cutscene')).toBe('on');
    await t.host.hide();
    expect(t.log.slice(3)).toEqual(['sim.paused=false', 'startLoop', 'wake:release']);
    expect(t.wakeLock.held).toBe(false);
    expect(t.locks[0]?.released).toBe(true);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.src).toBe('');
    expect(video.loadCalls).toBe(1);
    expect(t.parent.children).toHaveLength(0);
    expect(t.root.has('data-dv-cutscene')).toBe(false);
  });

  it('desktop tiers hold no wake lock; a sim that was already paused stays paused', async () => {
    const t = setup('desktop', {});
    t.sim.paused = true;
    await t.host.show(new FakeVideo() as unknown as HTMLVideoElement);
    expect(t.log).toEqual(['setAnimationLoop(null)']);
    await t.host.hide();
    expect(t.sim.paused).toBe(true);
    expect(t.log).toEqual(['setAnimationLoop(null)', 'startLoop']);
  });

  it('without navigator.wakeLock the host warns once and does not throw', async () => {
    const t = setup('mobile-low');
    for (let i = 0; i < 2; i++) {
      await t.host.show(new FakeVideo() as unknown as HTMLVideoElement);
      await t.host.hide();
    }
    expect(t.warnings).toHaveLength(1);
    expect(t.log.filter((l) => l === 'startLoop')).toHaveLength(2);
  });

  it('re-acquires the wake lock when the page becomes visible again', async () => {
    const listeners: (() => void)[] = [];
    const doc = { visibilityState: 'hidden', addEventListener: (_: string, l: () => void) => void listeners.push(l), removeEventListener: () => undefined };
    let n = 0;
    const lock = new ScreenWakeLock({ wakeLock: { request: () => { n++; return Promise.resolve({ release: () => Promise.resolve() }); } } }, doc);
    await lock.acquire();
    expect(n).toBe(1);
    // the browser dropped the lock while hidden
    (lock as unknown as { sentinel: unknown }).sentinel = null;
    doc.visibilityState = 'visible';
    for (const l of listeners) l();
    await Promise.resolve();
    expect(n).toBe(2);
  });
});

describe('pickRendition', () => {
  const manifest = {
    renditions: {
      v768: { file: 'v768.mp4', bytes: 1, sha256: 'a', codecs: 'avc1.640028', kbps: 1 },
      v540: { file: 'v768.webm', bytes: 1, sha256: 'b', codecs: 'vp09.00.40.08', kbps: 1 },
    },
  };
  const only = (needle: string) => (t: string): string => (t.includes(needle) ? 'maybe' : '');
  it('takes the first rendition whose type passes canPlayType, v768 first', () => {
    expect(pickRendition(manifest, () => 'maybe', { dataSaver: false, baseUrl: '/x/' })?.url).toBe('/x/v768.mp4');
    expect(pickRendition(manifest, only('webm'), { dataSaver: false, baseUrl: '/x/' })?.key).toBe('v540');
    expect(pickRendition(manifest, () => '', { dataSaver: false, baseUrl: '/x/' })).toBeNull();
  });
  it('prefers v540 on data saver', () => {
    expect(pickRendition(manifest, () => 'maybe', { dataSaver: true, baseUrl: '/x/' })?.key).toBe('v540');
    expect(pickRendition({ renditions: { v768: manifest.renditions.v768 } }, () => 'maybe', { dataSaver: true, baseUrl: '' })?.key).toBe('v768');
  });
});

describe('DomCutsceneHost: cue-only layer, still image, tap prompt (M05b2)', () => {
  it('showCues puts the overlay above the live world without stopping the loop or pausing the sim; hideCues undoes it', () => {
    const t = setup('desktop');
    t.host.showCues();
    expect(t.log).toEqual([]);
    expect(t.parent.children).toHaveLength(1);
    expect(t.host.cues).toBe(true);
    expect((t.parent.children[0] as FakeEl).style['background']).toBe('transparent');
    expect(t.root.get('data-dv-cutscene')).toBe('on');
    t.host.hideCues();
    expect(t.parent.children).toHaveLength(0);
    expect(t.root.has('data-dv-cutscene')).toBe(false);
    expect(t.host.cues).toBe(false);
  });

  it('show after showCues covers the screen again (black), and hide restores everything', async () => {
    const t = setup('desktop');
    t.host.showCues();
    const video = new FakeVideo();
    await t.host.show(video as unknown as HTMLVideoElement);
    expect(t.host.cues).toBe(false);
    expect((t.parent.children[0] as FakeEl).style['background']).toBe('#000');
    expect(t.sim.paused).toBe(true);
    await t.host.hide();
    expect(t.sim.paused).toBe(false);
  });

  it('holdStill swaps the video for an image and lets the loop and the sim run behind it; hide removes the layer', async () => {
    const t = setup('desktop');
    const video = new FakeVideo();
    await t.host.show(video as unknown as HTMLVideoElement);
    t.log.length = 0;
    t.host.holdStill('/last.webp');
    // the loop runs for the sim; the opaque still keeps the world from being drawn (BD-FIX-CI10-R01)
    expect(t.log).toEqual(['sim.paused=false', 'hold:cover', 'startLoop']);
    expect(t.host.visible).toBe(true);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.loadCalls).toBe(1);
    const layer = t.parent.children[0] as FakeEl;
    expect(layer.children.map((c) => (c as FakeEl).attrs.get('src') ?? 'overlay')).toEqual(['/last.webp', 'overlay']);
    await t.host.hide();
    expect(t.parent.children).toHaveLength(0);
    expect(t.host.visible).toBe(false);
    expect(t.root.has('data-dv-cutscene')).toBe(false);
  });

  it('waitForTap resolves false after the time and true on a click', async () => {
    const clicks: ((e: unknown) => void)[] = [];
    const sim = { paused: false, setPaused: () => undefined };
    const loop = { stopLoop: () => undefined, startLoop: () => undefined };
    const parent = new FakeEl();
    const host = new DomCutsceneHost({
      parent: parent as HostElement,
      createElement: () => {
        const el = new FakeEl() as FakeEl & { addEventListener(t: string, l: (e: unknown) => void): void; textContent: string };
        el.addEventListener = (_t, l) => void clicks.push(l);
        return el;
      },
      loop,
      sim,
      tier: 'mobile',
    });
    const timedOut = host.waitForTap('Tap to play', 10);
    expect(await timedOut).toBe(false);
    const tapped = host.waitForTap('Tap to play', 1000);
    clicks.at(-1)?.({});
    expect(await tapped).toBe(true);
  });
});

describe('DomCutsceneHost: what keeps the hidden world from being drawn (BD-FIX-CI10-R01)', () => {
  it('holdFrame holds the armed frame through the loop; the cue-only fallback layer draws the world again', () => {
    const t = setup('desktop');
    t.host.holdFrame();
    expect(t.log).toEqual(['hold:frame']);
    expect(t.host.held).toBe('frame');
    expect(t.host.visible).toBe(false);
    // the host hands the page's "armed" test to the loop
    expect(t.armed()).toBe(false);
    t.frameArmed.value = true;
    expect(t.armed()).toBe(true);
    t.host.showCues();
    expect(t.log).toEqual(['hold:frame', 'release:frame']);
    expect(t.host.held).toBeNull();
    expect(t.host.cues).toBe(true);
  });

  it('holdPoster covers the screen on black with the poster, without pausing the sim or stopping the loop; hide undoes it', async () => {
    const t = setup('mobile-low', {});
    t.host.holdFrame();
    t.host.holdPoster('/poster.webp');
    expect(t.log).toEqual(['hold:frame', 'release:frame', 'hold:cover']);
    expect(t.sim.paused).toBe(false);
    expect(t.host.visible).toBe(true);
    expect(t.host.held).toBe('cover');
    const layer = t.parent.children[0] as FakeEl;
    expect(layer.style['background']).toBe('#000');
    expect(layer.children.map((c) => (c as FakeEl).attrs.get('src') ?? 'overlay')).toEqual(['/poster.webp', 'overlay']);
    expect(t.root.get('data-dv-cutscene')).toBe('on');
    await t.host.hide();
    expect(t.log.slice(3)).toEqual(['release:cover']);
    expect(t.parent.children).toHaveLength(0);
    expect(t.host.visible).toBe(false);
    expect(t.host.held).toBeNull();
    expect(t.root.has('data-dv-cutscene')).toBe(false);
    expect(t.wakeLock.held).toBe(false);
  });

  it('show replaces the poster with the clip: the loop stops and the sim pauses as before, and hide restarts both', async () => {
    const t = setup('desktop');
    t.host.holdPoster('/poster.webp');
    const video = new FakeVideo();
    await t.host.show(video as unknown as HTMLVideoElement);
    expect(t.log).toEqual(['hold:cover', 'release:cover', 'setAnimationLoop(null)', 'sim.paused=true']);
    expect(t.host.held).toBe('stopped');
    const layer = t.parent.children[0] as FakeEl;
    expect(t.parent.children).toHaveLength(1);
    expect(layer.children).toEqual([video, t.host.overlayRoot]);
    // a second poster under a clip that is up changes nothing
    t.host.holdPoster('/other.webp');
    t.host.holdFrame();
    expect(t.log).toHaveLength(4);
    await t.host.hide();
    expect(t.log.slice(4)).toEqual(['sim.paused=false', 'startLoop']);
    expect(t.holds.size).toBe(0);
  });

  it('holdStill runs the loop and the sim for the in-engine beat without drawing the world behind the opaque still', async () => {
    const t = setup('desktop');
    await t.host.show(new FakeVideo() as unknown as HTMLVideoElement);
    t.log.length = 0;
    t.host.holdStill('/last.webp');
    expect(t.log).toEqual(['sim.paused=false', 'hold:cover', 'startLoop']);
    expect(t.host.held).toBe('cover');
    // the fallback's cues go over the still: the cover stays
    t.host.showCues();
    expect(t.host.held).toBe('cover');
    await t.host.hide();
    expect(t.log.slice(3)).toEqual(['release:cover']);
    expect(t.host.held).toBeNull();
  });

  it('a loop without holdWorld (the QA media page) keeps drawing and nothing throws', async () => {
    const parent = new FakeEl();
    const host = new DomCutsceneHost({
      parent: parent as HostElement,
      createElement: () => new FakeEl(),
      loop: { stopLoop: () => undefined, startLoop: () => undefined },
      sim: { paused: false, setPaused: () => undefined },
      tier: 'desktop',
    });
    host.holdFrame();
    expect(host.held).toBeNull();
    host.holdPoster('/poster.webp');
    expect(host.visible).toBe(true);
    await host.hide();
    expect(parent.children).toHaveLength(0);
  });
});
