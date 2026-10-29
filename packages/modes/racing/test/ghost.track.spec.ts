/**
 * AC-7: a saved ghost plays beside a live run within 5 cm of its recorded samples, owns no physics body, and the live run's
 * hash equals that of a run without the ghost (D-S06-05, U-RAC-3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BodyRef, Transform } from '@dv/engine/sim';
import { fromBase64, decodeTrack, encodeTrack, toBase64, type GhostEntry } from '@dv/shared';
import { PUPPET_PREFABS, ghostPrefabOf, rivalPrefabOf } from '../src/prefabs.ts';
import { runHeadless } from '../src/qa/headless.ts';
import { racingSpec, registerRacingQa } from '../src/qa/index.ts';
import { betterGhost, ghostFromRun, GhostPlayer } from '../src/sim/ghosts.ts';

registerRacingQa();
const ID = 'sf.downhill.twin-peaks-mission';
const corridor = new Uint8Array(readFileSync(new URL(`../../../../content/races/${ID}/corridor.bin`, import.meta.url)));
const spec = racingSpec({ raceId: ID, maxTicks: 12_000 });

interface Sample { tick: number; x: number; y: number; z: number }

describe('ghosts', () => {
  it('a ghost entry is a track and the inputs, and the better time wins a slot', async () => {
    const run = await runHeadless(spec, corridor);
    const a = run.attempt!;
    run.dispose();
    const g = ghostFromRun(a.run!, a.ms, 111);
    expect(g.ms).toBe(a.ms);
    expect(g.vehicleDef).toBe('vehicle.aurelian-sorrel');
    expect(g.inputsB64).not.toBeNull();
    expect(g.savedAt).toBe(111);
    const t = decodeTrack(fromBase64(g.trackB64));
    // 156 s at 20 Hz would be over the track cap, so the recorder thinned it to every 6th tick
    expect([3, 6, 12]).toContain(t.stride);
    expect(t.track.length / 5).toBeGreaterThan(1500);
    const slower: GhostEntry = { ...g, ms: g.ms + 10, savedAt: 222 };
    const faster: GhostEntry = { ...g, ms: g.ms - 10, savedAt: 333 };
    expect(betterGhost(undefined, g)).toBe(g);
    expect(betterGhost(g, slower)).toBe(g);
    expect(betterGhost(g, faster)).toBe(faster);
    expect(betterGhost(g, { ...g, savedAt: 9 })).toBe(g);
  }, 240_000);

  it('plays within 5 cm of its samples beside a live run, owns no body, and leaves the live run\'s hash alone', async () => {
    // run 1: the recording; the car's pose per tick is kept to compare with
    const poses = new Map<number, Sample>();
    const solo = await runHeadless(spec, corridor, {
      beforeTick: (s, tick) => {
        const c = s.state().car;
        if (c) poses.set(tick - 1, { tick: tick - 1, x: c.pos[0], y: c.pos[1], z: c.pos[2] });
      },
    });
    const a = solo.attempt!;
    solo.dispose();
    const entry = ghostFromRun(a.run!, a.ms, 5);
    const player = new GhostPlayer(entry);
    const startTick = a.run!.header.startTick;
    const go = startTick + player.lead;

    // run 2: the same race with the ghost beside it
    let checked = 0;
    let worst = 0;
    let bodies = -1;
    let ghostSeen = false;
    const withGhost = await runHeadless({ ...spec, bot: { ...spec.bot, params: { ...spec.bot.params, ghost: entry } } }, corridor, {
      beforeTick: (s, tick, sim) => {
        const st = s.state();
        if (st.ghostRunning) ghostSeen = true;
        const T = tick - 1;
        if (T < go || (T - startTick) % player.stride !== 0) return;
        const ecs = sim.ecs;
        const h = ecs.byKey('veh:race.g0' as never);
        const id = ecs.resolve(h);
        const want = poses.get(T);
        if (id === null || !want) return;
        const tr = ecs.store(Transform);
        const d = Math.hypot((tr.px[id] as number) - want.x, (tr.pz[id] as number) - want.z);
        // the pose is the body centre; the recorded sample is the same point
        const dy = Math.abs((tr.py[id] as number) - want.y);
        worst = Math.max(worst, d, dy);
        checked++;
        if (bodies < 0) bodies = ecs.has(h, BodyRef) ? 1 : 0;
      },
    });
    const b = withGhost.attempt!;
    expect(ghostSeen).toBe(true);
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(0.05);
    expect(bodies).toBe(0);
    // the live run: finish tick, gate ticks and the hash of the car, the rivals and the gates are what they were without the ghost
    expect(b.finishTick).toBe(a.finishTick);
    expect(b.gateTicks).toEqual(a.gateTicks);
    expect(b.endHash).toBe(a.endHash);
    // two rivals and the ghost are the session's extra entities
    expect(withGhost.session.state().puppets).toBe(3);
    withGhost.dispose();
  }, 240_000);

  it('a puppet prefab has a model and a transform and no body, one pair per race car', () => {
    expect(PUPPET_PREFABS.length).toBe(12);
    for (const d of PUPPET_PREFABS as unknown as { id: string; physics: unknown; render: { asset: string }; components: Record<string, unknown> }[]) {
      expect(d.physics).toBeNull();
      expect(d.render.asset).toMatch(/^vehicle\/graybox\./);
      expect(Object.keys(d.components)).not.toContain('BodyRef');
      expect(Object.keys(d.components)).toContain('Transform');
    }
    expect(rivalPrefabOf('vehicle.kestrel-quill')).toBe('racing.rival.kestrel-quill');
    expect(ghostPrefabOf('vehicle.aurelian-sorrel')).toBe('racing.ghost.aurelian-sorrel');
  });

  it('the player reads positions and speeds exactly at the samples and blends between them, the yaw the short way', () => {
    // x, z (2 cm), y (4 cm), yaw (u16 turns), speed (2 kph); three samples, 3 ticks apart, GO at the second one (lead 3)
    const t = new Int32Array([0, 0, 0, 0, 0, 100, -50, 25, 65000, 50, 200, -100, 50, 500, 100]);
    const entry: GhostEntry = {
      vehicleDef: 'vehicle.kestrel-quill', ms: 1, profile: 'canonical', buildId: 'b', worldBake: 'w', inputsB64: null, savedAt: 0,
      trackB64: toBase64(encodeTrack(t, 3, 3)),
    };
    const p = new GhostPlayer(entry);
    expect(p.samples).toBe(3);
    expect(p.lead).toBe(3);
    expect(p.durationTicks).toBe(6);
    // before GO and at GO
    expect(p.poseAt(-10)).toMatchObject({ x: 0, z: 0, y: 0 });
    expect(p.poseAt(-3)).toMatchObject({ x: 0, z: 0 });
    const g0 = p.poseAt(0)!;
    expect(g0.x).toBeCloseTo(2, 9);
    expect(g0.z).toBeCloseTo(-1, 9);
    expect(g0.y).toBeCloseTo(1, 9);
    expect(g0.speedMps).toBeCloseTo((50 * 2) / 3.6, 9);
    // one third of the way from the second sample to the third
    const g1 = p.poseAt(1)!;
    expect(g1.x).toBeCloseTo(2 + (4 - 2) / 3, 9);
    expect(g1.z).toBeCloseTo(-1 + (-2 + 1) / 3, 9);
    // the yaw crosses zero (65000 is just below a turn, 500 just above), not the long way round the circle
    expect(Math.abs(g1.yaw)).toBeLessThan(0.06);
    // past the end it holds the last sample
    expect(p.poseAt(500)).toMatchObject({ x: 4, z: -2 });
  });
});
