import { dsqrt, PI, Rng, SIM_DT, sampleHeight, toStaticShapeSet } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import {
  allowedCameraDistance, lookAngles, publishedCamera, tpOffsetWorld, TP_OFFSET, CAMERA_MARGIN, MIN_ALLOWED,
} from '../src/sim/camera/collision.ts';
import type { Vec3 } from '../src/sim/physics/backend.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { fixtureBoxes, worldBoxesShapes, type FixtureBox } from './fixtures/world-boxes.ts';
import { boxesOf, fixtureChunks, type PrismBox } from './graybox-helpers.ts';
import { createWalkSim, hold, player } from './walk-sim.ts';

const BOXES = fixtureBoxes();
const CHEST = 1.35;
const FULL = dsqrt(TP_OFFSET[0] ** 2 + TP_OFFSET[1] ** 2 + TP_OFFSET[2] ** 2);

const insideBox = (p: Vec3, b: FixtureBox, inflate: number): boolean =>
  p[0] > b.cx - b.hx - inflate && p[0] < b.cx + b.hx + inflate &&
  p[2] > b.cz - b.hz - inflate && p[2] < b.cz + b.hz + inflate &&
  p[1] > b.baseY - inflate && p[1] < b.baseY + b.heightM + inflate;

async function fixtureBackend(): Promise<RapierBackend> {
  const backend = new RapierBackend('deterministic-compat');
  await backend.init();
  backend.addChunkStatics('fixture', worldBoxesShapes());
  backend.step(SIM_DT, 1);
  return backend;
}

describe('camera collision: the 100-pose sweep (AC-7)', () => {
  it('no camera point lies inside a box or under the ground (each inflated by 0.1 m), and clear poses get the full distance', async () => {
    const backend = await fixtureBackend();
    const rng = new Rng(0x5eed);
    let clear = 0;
    let pulledIn = 0;
    for (let n = 0; n < 100; n++) {
      // Half of the poses stand within 3.5 m of a box so that the camera has something to hit.
      let x: number;
      let z: number;
      do {
        if (n % 2 === 0) {
          const b = BOXES[rng.nextU32() % BOXES.length] as FixtureBox;
          x = b.cx + rng.range(-(b.hx + 3.5), b.hx + 3.5);
          z = b.cz + rng.range(-(b.hz + 3.5), b.hz + 3.5);
        } else {
          x = rng.range(-60, 60);
          z = rng.range(-60, 60);
        }
        // Walkable: the capsule (radius 0.35) must not overlap a box.
      } while (BOXES.some((b) => insideBox([x, 0.5, z], b, 0.4)));
      const yaw = rng.range(0, 2 * PI);
      const pitch = rng.range(-70, 70) * (PI / 180);
      const side = n % 4 < 2 ? 1 : -1;

      const anchor: Vec3 = [x, CHEST, z];
      const offset = tpOffsetWorld(yaw, pitch, side, [0, 0, 0]);
      const allowed = allowedCameraDistance(backend, anchor, offset);
      const unit: Vec3 = [offset[0] / FULL, offset[1] / FULL, offset[2] / FULL];
      const cam: Vec3 = [anchor[0] + unit[0] * allowed, anchor[1] + unit[1] * allowed, anchor[2] + unit[2] * allowed];

      const where = `pose ${n} (x ${x.toFixed(2)}, z ${z.toFixed(2)}, yaw ${yaw.toFixed(2)}, pitch ${pitch.toFixed(2)}, side ${side})`;
      for (const b of BOXES) expect(insideBox(cam, b, 0.1), `${where}: camera ${cam.map((v) => v.toFixed(2)).join(',')} inside a box`).toBe(false);
      expect(cam[1], `${where}: camera below the ground`).toBeGreaterThanOrEqual(0.1);
      expect(allowed).toBeGreaterThanOrEqual(MIN_ALLOWED);
      expect(allowed).toBeLessThanOrEqual(FULL + 1e-9);

      // Independent test of "unobstructed": the whole segment keeps 0.3 m from every box and from the ground.
      let free = true;
      for (let k = 0; k <= 60 && free; k++) {
        const t = (k / 60) * FULL;
        const p: Vec3 = [anchor[0] + unit[0] * t, anchor[1] + unit[1] * t, anchor[2] + unit[2] * t];
        if (p[1] < 0.3 || BOXES.some((b) => insideBox(p, b, 0.3))) free = false;
      }
      if (free) {
        clear++;
        expect(allowed, `${where}: clear pose was pulled in`).toBeCloseTo(FULL, 6);
      } else if (allowed < FULL - 1e-6) {
        pulledIn++;
      }
    }
    // The sweep means something only if it saw both kinds of pose.
    expect(clear).toBeGreaterThanOrEqual(30);
    expect(pulledIn).toBeGreaterThanOrEqual(10);
    backend.dispose();
  });

  it('a wall 1 m behind the player pulls the camera in to toi - 0.05 m, never closer than 0.2 m', async () => {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    // A wall across +Z at z = 1.0 (the player faces north, -Z, so the camera sits at +Z).
    backend.addChunkStatics('wall', { prisms: new Float32Array([4, 0, 5, -5, 1, 5, 1, 5, 1.5, -5, 1.5]) });
    backend.step(SIM_DT, 1);
    const anchor: Vec3 = [0, CHEST, 0];
    const offset = tpOffsetWorld(0, 0, 1, [0, 0, 0]);
    const d = allowedCameraDistance(backend, anchor, offset);
    // Along the offset direction the wall plane z = 1 is reached at 1 / (2.8 / FULL); the sphere stops 0.25 m short.
    const expected = (1 - 0.25 * (FULL / TP_OFFSET[2])) * (FULL / TP_OFFSET[2]) - CAMERA_MARGIN;
    expect(d).toBeLessThan(FULL);
    expect(d).toBeGreaterThanOrEqual(MIN_ALLOWED);
    expect(d).toBeCloseTo(Math.max(MIN_ALLOWED, expected), 1);
    // Against the wall: the floor of the answer.
    expect(allowedCameraDistance(backend, [0, CHEST, 0.9], offset)).toBe(MIN_ALLOWED);
    backend.dispose();
  });

  it('the Publish system leaves both shoulders in services.camera and the directive carries them', async () => {
    const sim = await createWalkSim({ spawn: [0, 0, -100], yaw: 0 });
    hold(sim, 3, {});
    const cam = sim.services.camera;
    expect(cam.target).not.toBe(0);
    expect(cam.allowedRight).toBeCloseTo(FULL, 6);
    expect(cam.allowedLeft).toBeCloseTo(FULL, 6);
    const d = publishedCamera(sim.services);
    expect(d?.mode).toBe('tp');
    expect(d?.follow?.offset).toEqual([0.6, 0.35, 2.8]);
    expect(d?.follow?.anchor).toBe('chest');
    expect(d?.allowedDistance).toBe(cam.allowedRight);
    expect(d?.allowedDistanceOpposite).toBe(cam.allowedLeft);
    expect(d?.lockPlayerToggle).toBe(false);
    // The direct call and the system agree for the first pose of the tick.
    const p = player(sim);
    const direct = allowedCameraDistance(sim.backend, [p.x, p.y + CHEST, p.z], tpOffsetWorld(0, 0, 1, [0, 0, 0]));
    expect(cam.allowedRight).toBeCloseTo(direct, 6);
    sim.dispose();
  });

  it('lookAngles maps the u16 yaw and the i16 pitch to radians', () => {
    expect(lookAngles(0, 0)).toEqual({ yaw: 0, pitch: 0 });
    expect(lookAngles(16384, 0).yaw).toBeCloseTo(PI / 2, 12);
    expect(lookAngles(0, 16384).pitch).toBeCloseTo(PI / 2, 12);
    expect(lookAngles(0, -8192).pitch).toBeCloseTo(-PI / 4, 12);
  });

  it('with the lock set the directive says so, with the debug reason', async () => {
    const sim = await createWalkSim({ spawn: [0, 0, -100] });
    hold(sim, 2, {});
    sim.services.camera.lockPlayerToggle = true;
    sim.services.camera.reason = 'debug';
    hold(sim, 1, {});
    expect(publishedCamera(sim.services)).toMatchObject({ lockPlayerToggle: true, reason: 'debug' });
    sim.dispose();
  });
});

describe('camera collision: the 100-pose sweep on the gray-box (M01b2 AC-4)', () => {
  it('no camera point lies inside one of the 12 boxes or under the terrain, and clear poses get the full distance', async () => {
    const { sim: chunks } = fixtureChunks();
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    for (const c of chunks) backend.addChunkStatics(c.key, toStaticShapeSet(c));
    backend.step(SIM_DT, 1);
    const boxes: PrismBox[] = chunks.flatMap((c) => boxesOf(c.prisms));
    expect(boxes).toHaveLength(12);
    const terrain = (x: number, z: number): number => {
      const c = chunks.find((k) => k.height.originX <= x && x < k.height.originX + 256 && k.height.originZ <= z && z < k.height.originZ + 256);
      return c ? sampleHeight(c.height, x, z) : -Infinity;
    };
    const inside = (p: Vec3, b: PrismBox, inflate: number): boolean =>
      p[0] > b.minX - inflate && p[0] < b.maxX + inflate && p[2] > b.minZ - inflate && p[2] < b.maxZ + inflate &&
      p[1] > b.base - inflate && p[1] < b.top + inflate;

    const rng = new Rng(0x9ab0);
    let clear = 0;
    let pulledIn = 0;
    for (let n = 0; n < 100; n++) {
      let x: number;
      let z: number;
      do {
        if (n % 2 === 0) {
          const b = boxes[rng.nextU32() % boxes.length] as PrismBox;
          x = rng.range(b.minX - 3.5, b.maxX + 3.5);
          z = rng.range(b.minZ - 3.5, b.maxZ + 3.5);
        } else {
          x = rng.range(-110, 110);
          z = rng.range(-110, 110);
        }
      } while (boxes.some((b) => inside([x, (b.base + b.top) / 2, z], b, 0.4)) || terrain(x, z) === -Infinity);
      const ground = terrain(x, z);
      const yaw = rng.range(0, 2 * PI);
      const pitch = rng.range(-70, 70) * (PI / 180);
      const side = n % 4 < 2 ? 1 : -1;
      const anchor: Vec3 = [x, ground + CHEST, z];
      const offset = tpOffsetWorld(yaw, pitch, side, [0, 0, 0]);
      const allowed = allowedCameraDistance(backend, anchor, offset);
      const unit: Vec3 = [offset[0] / FULL, offset[1] / FULL, offset[2] / FULL];
      const cam: Vec3 = [anchor[0] + unit[0] * allowed, anchor[1] + unit[1] * allowed, anchor[2] + unit[2] * allowed];
      const where = `pose ${n} (x ${x.toFixed(2)}, z ${z.toFixed(2)})`;
      for (const b of boxes) expect(inside(cam, b, 0.1), `${where}: camera inside a box`).toBe(false);
      expect(cam[1] - terrain(cam[0], cam[2]), `${where}: camera under the terrain`).toBeGreaterThanOrEqual(-0.05);
      expect(allowed).toBeGreaterThanOrEqual(MIN_ALLOWED);
      expect(allowed).toBeLessThanOrEqual(FULL + 1e-9);

      let free = true;
      for (let k = 0; k <= 60 && free; k++) {
        const t = (k / 60) * FULL;
        const p: Vec3 = [anchor[0] + unit[0] * t, anchor[1] + unit[1] * t, anchor[2] + unit[2] * t];
        if (p[1] - terrain(p[0], p[2]) < 0.3 || boxes.some((b) => inside(p, b, 0.3))) free = false;
      }
      if (free) {
        clear++;
        expect(allowed, `${where}: clear pose was pulled in`).toBeCloseTo(FULL, 6);
      } else if (allowed < FULL - 1e-6) {
        pulledIn++;
      }
    }
    expect(clear).toBeGreaterThanOrEqual(30);
    expect(pulledIn).toBeGreaterThanOrEqual(10);
    backend.dispose();
  });
});
