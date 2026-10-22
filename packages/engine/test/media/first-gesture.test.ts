import { describe, expect, it } from 'vitest';
import { createFirstGestureUnlock, MP4_TYPE } from '../../src/platform/media/first-gesture.ts';
import { FakeTarget, FakeVideo } from './fakes.ts';

/** A mocked AudioService whose context becomes `running` when `unlock` is called. */
function fakeAudio() {
  const ctx = { state: 'suspended' };
  return {
    calls: 0,
    context: ctx,
    unlock(): Promise<void> {
      this.calls++;
      ctx.state = 'running';
      return Promise.resolve();
    },
  };
}

function make(canPlay: (t: string) => string, setup?: (v: FakeVideo, i: number) => void) {
  const videos: FakeVideo[] = [];
  const audio = fakeAudio();
  const unlock = createFirstGestureUnlock({
    audio,
    createVideo: () => {
      const v = new FakeVideo(canPlay);
      setup?.(v, videos.length);
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    },
  });
  return { unlock, videos, audio };
}

describe('FirstGestureUnlock (AC-1)', () => {
  it('acquireVideo is null before the gesture; one pointerup unlocks audio and a pool of three', async () => {
    const { unlock, videos, audio } = make(() => 'probably');
    const target = new FakeTarget();
    unlock.attach(target);
    expect(unlock.acquireVideo()).toBeNull();
    expect(unlock.state()).toMatchObject({ unlocked: false, pool: 0, audio: 'suspended' });
    target.fire('pointerup');
    await unlock.ready;
    const s = unlock.state();
    expect(s).toMatchObject({ audio: 'running', unlocked: true, pool: 3, blank: 'mp4', errors: [] });
    expect(videos).toHaveLength(3);
    for (const v of videos) {
      expect(v.muted).toBe(true);
      expect(v.getAttribute('playsinline')).toBe('');
      expect(v.getAttribute('disableremoteplayback')).toBe('');
      expect(v.getAttribute('crossorigin')).toBe('anonymous');
      expect(v.getAttribute('preload')).toBe('auto');
      expect(v.src).toBe('/media/blank.mp4');
      expect(v.playCalls).toBe(1);
      expect(v.pauseCalls).toBe(1);
    }
    expect(target.count()).toBe(0);
    expect(audio.calls).toBe(1);
  });

  it('hands out three elements, refuses a fourth, takes one back, and a second gesture changes nothing', async () => {
    const { unlock, videos, audio } = make(() => 'probably');
    await unlock.trigger();
    const a = unlock.acquireVideo();
    const b = unlock.acquireVideo();
    const c = unlock.acquireVideo();
    expect([a, b, c].every((v) => v !== null)).toBe(true);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(unlock.acquireVideo()).toBeNull();
    unlock.releaseVideo(b as HTMLVideoElement);
    expect(unlock.acquireVideo()).toBe(b);
    const before = JSON.stringify(unlock.state());
    await unlock.trigger();
    expect(JSON.stringify(unlock.state())).toBe(before);
    expect(videos).toHaveLength(3);
    expect(audio.calls).toBe(1);
  });

  it('picks blank.mp4 when canPlayType accepts avc1.640028, otherwise blank.webm', async () => {
    const seen: string[] = [];
    const mp4 = make((t) => (seen.push(t), t === MP4_TYPE ? 'maybe' : ''));
    await mp4.unlock.trigger();
    expect(seen).toContain('video/mp4; codecs="avc1.640028"');
    expect(mp4.unlock.state().blank).toBe('mp4');
    expect(mp4.videos.every((v) => v.src === '/media/blank.mp4')).toBe(true);
    const webm = make(() => '');
    await webm.unlock.trigger();
    expect(webm.unlock.state().blank).toBe('webm');
    expect(webm.videos.every((v) => v.src === '/media/blank.webm')).toBe(true);
  });

  it('a rejected blank play() still unlocks: three acquires succeed and errors holds one entry with that index', async () => {
    const { unlock } = make(() => 'probably', (v, i) => {
      if (i === 1) v.rejectPlay = 'NotAllowedError';
    });
    await unlock.trigger();
    const s = unlock.state();
    expect(s.unlocked).toBe(true);
    expect(s.errors).toEqual([{ stage: 'blank', index: 1, name: 'NotAllowedError' }]);
    expect([unlock.acquireVideo(), unlock.acquireVideo(), unlock.acquireVideo()].every((v) => v !== null)).toBe(true);
  });

  it('a blank play() that never settles times out as TimeoutError and the pool is still acquirable', async () => {
    const videos: FakeVideo[] = [];
    const unlock = createFirstGestureUnlock({
      audio: fakeAudio(),
      blankTimeoutMs: 20,
      createVideo: () => {
        const v = new FakeVideo();
        v.play = () => new Promise<void>(() => undefined);
        videos.push(v);
        return v as unknown as HTMLVideoElement;
      },
    });
    await unlock.trigger();
    expect(unlock.state().errors.map((e) => e.name)).toEqual(['TimeoutError', 'TimeoutError', 'TimeoutError']);
    expect(unlock.state().unlocked).toBe(true);
    expect(unlock.acquireVideo()).not.toBeNull();
  });
});
