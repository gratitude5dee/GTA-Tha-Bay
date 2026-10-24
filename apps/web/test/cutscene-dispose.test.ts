// BD-FU-B04: the cutscene glue's dispose releases whatever the flat host holds over the world, not only the overlay.
import { describe, expect, it } from 'vitest';
import { DomCutsceneHost, type HostElement } from '@dv/engine/platform/media';
import { releaseCutsceneView } from '../src/cutscene.ts';

class El {
  children: unknown[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  appendChild(c: unknown): unknown {
    this.children = this.children.filter((x) => x !== c);
    this.children.push(c);
    return c;
  }
  removeChild(c: unknown): unknown {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
}

class Video extends El {
  srcObject: unknown = null;
  pause(): void {
    // nothing playing
  }
  load(): void {
    // no media in node
  }
}

function setup() {
  const log: string[] = [];
  const parent = new El();
  const root = new El();
  const sim = {
    paused: false,
    setPaused(p: boolean) {
      this.paused = p;
    },
  };
  const loop = {
    running: true,
    stopLoop() {
      this.running = false;
    },
    startLoop() {
      this.running = true;
    },
    holdWorld(kind: 'cover' | 'frame') {
      log.push(`hold:${kind}`);
      return () => log.push(`release:${kind}`);
    },
  };
  const host = new DomCutsceneHost({
    parent: parent as unknown as HostElement,
    createElement: () => new El() as unknown as HostElement,
    loop,
    sim,
    tier: 'desktop',
    root: root as unknown as HostElement,
  });
  const overlay = {
    visible: true,
    hide() {
      this.visible = false;
    },
  };
  return { log, parent, root, sim, loop, host, overlay };
}

describe('releaseCutsceneView (the cutscene glue dispose)', () => {
  it('lets a held in-engine frame go', async () => {
    const t = setup();
    t.host.holdFrame();
    expect(t.host.held).toBe('frame');
    await releaseCutsceneView(t.overlay, t.host);
    expect(t.host.held).toBeNull();
    expect(t.log).toEqual(['hold:frame', 'release:frame']);
    expect(t.overlay.visible).toBe(false);
  });

  it('takes the poster cover down', async () => {
    const t = setup();
    t.host.holdPoster('/poster.webp');
    expect(t.host.held).toBe('cover');
    await releaseCutsceneView(t.overlay, t.host);
    expect(t.host.held).toBeNull();
    expect(t.host.visible).toBe(false);
    expect(t.parent.children).toEqual([]);
    expect(t.root.attrs.has('data-dv-cutscene')).toBe(false);
  });

  it('takes a clip down: the loop runs and the sim resumes again', async () => {
    const t = setup();
    await t.host.show(new Video() as unknown as HTMLVideoElement);
    expect(t.loop.running).toBe(false);
    expect(t.sim.paused).toBe(true);
    await releaseCutsceneView(t.overlay, t.host);
    expect(t.loop.running).toBe(true);
    expect(t.sim.paused).toBe(false);
    expect(t.host.visible).toBe(false);
    expect(t.parent.children).toEqual([]);
  });

  it('takes the last.webp cover of a stalled clip down', async () => {
    const t = setup();
    await t.host.show(new Video() as unknown as HTMLVideoElement);
    t.host.holdStill('/last.webp');
    expect(t.host.held).toBe('cover');
    await releaseCutsceneView(t.overlay, t.host);
    expect(t.host.held).toBeNull();
    expect(t.log.at(-1)).toBe('release:cover');
    expect(t.parent.children).toEqual([]);
  });

  it('removes the cue-only layer of an in-engine fallback', async () => {
    const t = setup();
    t.host.showCues();
    expect(t.host.cues).toBe(true);
    await releaseCutsceneView(t.overlay, t.host);
    expect(t.host.cues).toBe(false);
    expect(t.parent.children).toEqual([]);
    expect(t.root.attrs.has('data-dv-cutscene')).toBe(false);
  });
});
