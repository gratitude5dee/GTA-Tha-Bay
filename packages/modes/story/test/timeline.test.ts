/**
 * M05a2 AC-7: the `.dvtl` file. A run of m.dev.sample seed 1 whose talk result arrives as an asynchronous input is recorded;
 * replaying the file's `external` rows at their ticks gives the same end hash, and `lastBefore` reads back the recorded pose.
 */
import path from 'node:path';
import { Rng, type JsonObject } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { registerBot } from '../../../engine/src/qa/bots.ts';
import { createCanonicalRunner, type StateHashTrace } from '../../../engine/src/qa/runner.ts';
import { readFixturePacks } from '../../../engine/src/qa/node.ts';
import { DVTL_MAGIC, DvtlError, decodeDvtl, encodeDvtl, lastBefore, poseAt, type Dvtl } from '../../../engine/src/sim/script/dvtl.ts';
import { readBundle } from '../../../../tools/ci/missions/bundle.ts';
import { createStoryAutoplayer, encodeBundle, missionSpec, registerStoryQa, type MissionsHandle } from '../src/qa.ts';
import type { MissionObs } from '../src/autoplay/observe.ts';

const root = path.resolve(new URL(import.meta.url).pathname, '../../../../..');

describe('.dvtl format', () => {
  const sample = {
    snapshotEvery: 2,
    endTick: 40,
    meta: { mission: 'm.x', seed: 3 } as JsonObject,
    events: [{ t: 'mis.stage', tick: 0, data: { id: 'a', index: 0 } }, { t: 'mis.say', tick: 12, data: { line: 'line.x.héllo ✓' } }],
    external: [{ src: 'talk' as const, tick: 30, data: { talkId: 't', outcome: 'agree' } as JsonObject }],
    tracks: [
      { name: 'player', samples: [[0, 1, 2, 3], [2, 1.5, 2, 3.25], [4, 2, 2, 3.5], [10, 9, 9, 9]] as [number, number, number, number][] },
      { name: 'cast.buddy', samples: [[2, -5, 0, 5]] as [number, number, number, number][] },
    ],
  };

  it('round-trips events, externals, tracks and meta, and starts with the magic', () => {
    const bytes = encodeDvtl(sample);
    expect(new DataView(bytes).getUint32(0, true)).toBe(DVTL_MAGIC);
    expect(String.fromCharCode(...new Uint8Array(bytes, 0, 4))).toBe('DVTL');
    const d = decodeDvtl(bytes);
    expect(d.version).toBe(1);
    expect(d.endTick).toBe(40);
    expect(d.snapshotEvery).toBe(2);
    expect(d.meta).toEqual({ mission: 'm.x', seed: 3 });
    expect(d.events).toEqual(sample.events);
    expect(d.external).toEqual(sample.external);
    expect(d.tracks.map((t) => t.name)).toEqual(['cast.buddy', 'player']);
    const p = d.tracks.find((t) => t.name === 'player');
    expect(Array.from(p?.ticks ?? [])).toEqual([0, 2, 4, 10]);
    expect(Array.from(p?.pos ?? [])).toEqual([1, 2, 3, 1.5, 2, 3.25, 2, 2, 3.5, 9, 9, 9]);
  });

  it('lastBefore is the binary search of the scrubber', () => {
    const t = [0, 2, 4, 10];
    expect([-1, 0, 1, 2, 3, 4, 9, 10, 99].map((x) => lastBefore(t, x))).toEqual([-1, 0, 0, 1, 1, 2, 2, 3, 3]);
    expect(lastBefore([], 5)).toBe(-1);
    const d = decodeDvtl(encodeDvtl(sample));
    const player = d.tracks.find((x) => x.name === 'player');
    expect(player && poseAt(player, 5)).toEqual([2, 2, 3.5]);
    expect(player && poseAt(player, -1)).toBeNull();
  });

  it('refuses a file that is not a .dvtl', () => {
    expect(() => decodeDvtl(new Uint8Array(40))).toThrow(DvtlError);
    expect(() => decodeDvtl(new Uint8Array(4))).toThrow(DvtlError);
    const bytes = new Uint8Array(encodeDvtl(sample));
    bytes[4] = 9;
    expect(() => decodeDvtl(bytes)).toThrow(/version/);
  });
});

/** A bot that is the autoplayer plus a stand-in for the conversation UI: it answers the talk objective as an asynchronous input. */
function talkBot(id: string, handle: () => MissionsHandle | null, feed: (tick: number, obs: MissionObs, send: (talkId: string, outcome: string, path: 'llm' | 'ink' | 'scripted') => void) => void): void {
  registerBot(id, () => {
    const inner = createStoryAutoplayer();
    let ctx: { observe(): Readonly<Record<string, unknown>> } | null = null;
    return {
      ...inner,
      init(c, p) {
        ctx = c;
        inner.init(c, p);
      },
      frame(tick) {
        const obs = ctx?.observe() as unknown as MissionObs;
        const h = handle();
        if (h?.controller.rt && obs.phase === 'stage') {
          feed(tick, obs, (talkId, outcome, p) => h.controller.rt?.command({ name: 'talk.result', talkId, outcome, turns: 2, path: p }));
        }
        return inner.frame(tick);
      },
    };
  });
}

async function runWith(driver: string, setup: { onLoaded(h: MissionsHandle): void }): Promise<StateHashTrace> {
  const bundle = readBundle(root, 'm.dev.sample');
  const runner = createCanonicalRunner({
    packs: { ...readFixturePacks(root), mission: encodeBundle(bundle) },
    processEnv: {},
    onLoaded: (h) => setup.onLoaded(h as MissionsHandle),
  });
  const spec = missionSpec({ id: 'm.dev.sample', seed: 1, expectedSecMax: 900, flags: { beats: 'instant', hooks: 'bot' } });
  spec.bot.driver = driver;
  return runner.run(spec);
}

describe('record and replay (AC-7)', () => {
  it('replaying the recorded external inputs reproduces the run, and lastBefore returns the recorded pose', async () => {
    registerStoryQa();
    let rec: MissionsHandle | null = null;
    let sent = false;
    talkBot('story.talk-record', () => rec, (_tick, obs, send) => {
      const talk = obs.objectives.find((o) => o.def.k === 'talk');
      if (talk && talk.def.k === 'talk' && !sent) {
        sent = true;
        // the player picks the outcome that is not the default
        const other = Object.keys(talk.def.talk.outcomes).find((k) => k !== (talk.def as { talk: { default: string } }).talk.default) as string;
        send(talk.def.talk.id, other, 'llm');
      }
    });
    const recording = await runWith('story.talk-record', { onLoaded: (h) => (rec = h) });
    expect(recording.end.outcome).toBe('pass');
    const file = (rec as MissionsHandle | null)?.timeline.exportDvtl({ mission: 'm.dev.sample', seed: 1, endHash: recording.end.hash }) as ArrayBuffer;
    const dvtl: Dvtl = decodeDvtl(file);
    expect(dvtl.external).toHaveLength(1);
    expect(dvtl.external[0]).toMatchObject({ src: 'talk', data: { talkId: 'greet', outcome: 'decline', path: 'llm', turns: 2 } });
    expect(dvtl.events.some((e) => e.t === 'mis.talk' && (e.data as { outcome?: string }).outcome === 'decline')).toBe(true);
    expect(dvtl.events.filter((e) => e.t === 'mis.stage').length).toBeGreaterThan(10);
    expect(dvtl.meta).toMatchObject({ mission: 'm.dev.sample', seed: 1, endHash: recording.end.hash });

    // replay: no conversation; the file's externals are fed at their ticks
    let rep: MissionsHandle | null = null;
    talkBot('story.talk-replay', () => rep, (tick, _obs, send) => {
      for (const e of dvtl.external) {
        if (e.src === 'talk' && e.tick === tick) {
          const d = e.data as { talkId: string; outcome: string; path: 'llm' | 'ink' | 'scripted' };
          send(d.talkId, d.outcome, d.path);
        }
      }
    });
    const replay = await runWith('story.talk-replay', { onLoaded: (h) => (rep = h) });
    expect(replay.end).toEqual(recording.end);
    expect(replay.checkpoints).toEqual(recording.checkpoints);

    // lastBefore at 10 random ticks gives the pose that was recorded
    const mem = (rec as MissionsHandle | null)?.timeline.tracks().get('player');
    expect(mem && mem.length).toBeGreaterThan(100);
    const track = dvtl.tracks.find((t) => t.name === 'player');
    expect(track).toBeDefined();
    const rng = new Rng(77);
    for (let i = 0; i < 10; i++) {
      const tick = rng.nextU32() % (dvtl.endTick + 1);
      const at = lastBefore(track?.ticks ?? [], tick);
      const want = [...(mem ?? [])].reverse().find((s) => s[0] <= tick);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(track?.ticks[at]).toBe(want?.[0]);
      expect(poseAt(track as NonNullable<typeof track>, tick)).toEqual([Math.fround(want?.[1] as number), Math.fround(want?.[2] as number), Math.fround(want?.[3] as number)]);
    }
  }, 120_000);
});
