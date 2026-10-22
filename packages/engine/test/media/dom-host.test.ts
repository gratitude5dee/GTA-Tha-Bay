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
  const loop = { stopLoop: () => log.push('setAnimationLoop(null)'), startLoop: () => log.push('startLoop') };
  const parent = new FakeEl();
  const root = new Map<string, string>();
  const host = new DomCutsceneHost({
    parent: parent as HostElement,
    createElement: () => new FakeEl(),
    loop,
    sim,
    tier,
    wakeLock,
    root: { setAttribute: (n, v) => void root.set(n, v), removeAttribute: (n) => void root.delete(n) },
  });
  return { host, log, locks, warnings, sim, parent, root, wakeLock };
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
    expect(t.log).toEqual(['sim.paused=false', 'startLoop']);
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
