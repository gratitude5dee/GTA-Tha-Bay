import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '@dv/shared';
import { VEHICLE_READ_STRIDE, type PhysicsBuild } from '../src/sim/physics/backend.ts';
import { PHYSICS_CONFIG } from '../src/sim/physics/config.ts';
import { GROUPS, GROUP_BIT as GROUPS_BIT, interactionGroups } from '../src/sim/physics/groups.ts';
import { loadRapierBuild, type RapierModule } from '../src/sim/physics/load-build.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { earClip, heightfieldLayout, prismPieces } from '../src/sim/physics/static-shapes.ts';
import { groundHeightfield, worldBoxesShapes } from './fixtures/world-boxes.ts';

const BUILDS: PhysicsBuild[] = ['simd-compat', 'deterministic-compat'];

/** A loader that records which builds it was asked for and delegates to the real one. */
function spyLoader(): { load: (b: PhysicsBuild) => Promise<RapierModule>; asked: PhysicsBuild[] } {
  const asked: PhysicsBuild[] = [];
  return {
    asked,
    load: (b) => {
      asked.push(b);
      return loadRapierBuild(b);
    },
  };
}

describe('PhysicsBackend over Rapier 0.21.0 (AC-1)', () => {
  for (const build of BUILDS) {
    it(`${build}: init resolves, a 1 m box dropped from 10 m rests at y = 0.5 within 180 ticks, and only ${build} was loaded`, async () => {
      const spy = spyLoader();
      const backend = new RapierBackend(build, { load: spy.load });
      await backend.init();
      expect(backend.build).toBe(build);
      expect(spy.asked).toEqual([build]);
      expect(backend.loadedBuilds).toEqual([build]);

      backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
      const id = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [3, 10, -4], groups: GROUPS.dynamic });
      const out = new Float64Array(13);
      for (let t = 0; t < 180; t++) backend.step(SIM_DT, 1);
      backend.readBody(id, out);
      expect(out[1]).toBeGreaterThan(0.49);
      expect(out[1]).toBeLessThan(0.51);
      expect(out[0]).toBeCloseTo(3, 3);
      expect(Math.abs((out[2] as number) + 4)).toBeLessThan(0.05);
      // At rest: speed near zero.
      expect(Math.abs(out[8] as number)).toBeLessThan(0.05);
      backend.dispose();
    });
  }

  it('the heightfield layout matches Rapier: columns run along X, rows along Z, at is the minimum corner', async () => {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    // A ramp rising 1 m per cell along X; a box dropped at x = 6 m past the corner must rest on a surface near y = 1.5 + 0.5.
    const nx = 9;
    const nz = 5;
    const heights = new Float32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = ix * 0.1;
    backend.addChunkStatics('ramp', { heightfield: { nx, nz, cell: 2, heights, at: [10, 0, 20] }, prisms: new Float32Array(0) });
    const a = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.25], at: [12, 5, 24], groups: GROUPS.dynamic }); // ix = 1
    const b = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.25], at: [24, 5, 24], groups: GROUPS.dynamic }); // ix = 7
    for (let t = 0; t < 240; t++) backend.step(SIM_DT, 1);
    const oa = new Float64Array(13);
    const ob = new Float64Array(13);
    backend.readBody(a, oa);
    backend.readBody(b, ob);
    expect(Math.abs((ob[1] as number) - (oa[1] as number))).toBeGreaterThan(0.5); // the high end is higher
    // Rolling down the slope moves a toward -X.
    expect(oa[0]).toBeLessThan(12.05);
    backend.dispose();
  });

  it('prisms: a box prism and a concave L-shaped prism hold a body up; the concave one is split by ear clipping', async () => {
    const L = [6, 0, 2, 0, 0, 4, 0, 4, 2, 2, 2, 2, 4, 0, 4]; // L-shape footprint, 6 vertices
    const pack = new Float32Array(L);
    const pieces = prismPieces(pack);
    expect(pieces.length).toBeGreaterThan(1);
    expect(earClip([0, 4, 4, 2, 2, 0], [0, 0, 2, 2, 4, 4])).toHaveLength(4);

    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    backend.addChunkStatics('prisms', { prisms: new Float32Array([...L, ...worldBoxesShapes().prisms.slice(0, 11)]) });
    const id = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.25], at: [3, 6, 1], groups: GROUPS.dynamic }); // above the foot of the L
    const out = new Float64Array(13);
    for (let t = 0; t < 120; t++) backend.step(SIM_DT, 1);
    backend.readBody(id, out);
    expect(out[1]).toBeCloseTo(2.25, 1); // top of the 2 m prism plus the radius
    // Above the notch of the L there is nothing: the body falls through to the bottom.
    const hole = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.25], at: [3, 6, 3.2], groups: GROUPS.dynamic });
    for (let t = 0; t < 120; t++) backend.step(SIM_DT, 1);
    backend.readBody(hole, out);
    expect(out[1]).toBeLessThan(-5);
    backend.dispose();
  });

  it('removeBody and removeChunkStatics remove them', async () => {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    const id = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [0, 3, 0], groups: GROUPS.dynamic });
    expect(backend.bodyCount).toBe(1);
    expect(backend.bodyKind(id)).toBe('dynamic');
    backend.removeChunkStatics('ground');
    for (let t = 0; t < 120; t++) backend.step(SIM_DT, 1);
    const out = new Float64Array(13);
    backend.readBody(id, out);
    expect(out[1]).toBeLessThan(-5); // no ground: it fell
    backend.removeBody(id);
    expect(backend.bodyCount).toBe(0);
    expect(backend.bodyKind(id)).toBeNull();
    expect(() => backend.readBody(id, out)).toThrow(RangeError);
    backend.dispose();
  });

  it('kinematic targets move a kinematic body, and impulses change a dynamic body velocity', async () => {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    const k = backend.createBody({ kind: 'kinematic', shape: 'box', dims: [1, 1, 1], at: [0, 0, 0], groups: GROUPS.kinematic });
    for (let t = 1; t <= 10; t++) {
      backend.setKinematicTarget(k, [t * 0.1, 0, 0], [0, 0, 0, 1]);
      backend.step(SIM_DT, 1);
    }
    const out = new Float64Array(13);
    backend.readBody(k, out);
    expect(out[0]).toBeCloseTo(1, 4);

    const d = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.5], at: [10, 50, 0], groups: GROUPS.dynamic });
    backend.applyImpulse(d, [2, 0, 0]);
    backend.step(SIM_DT, 1);
    backend.readBody(d, out);
    expect(out[7]).toBeGreaterThan(1.9); // mass of a unit-density 0.5 m ball is ~0.52 kg, so well above 1
    backend.dispose();
  });

  it('the vehicle seam reads a documented layout: 11 floats per wheel, NaN for the wheel-point velocity (M03a2)', async () => {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    const body = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.6, 0.2, 2], mass: 1200, at: [3, 0.9, -4], groups: GROUPS.vehicle });
    const wheels = [[-0.8, 0, -1.3, 'front'], [0.8, 0, -1.3, 'front'], [-0.8, 0, 1.3, 'rear'], [0.8, 0, 1.3, 'rear']] as const;
    const v = backend.vehicle.create(body, wheels.map((w) => ({ pos: [w[0], w[1], w[2]], radius: 0.33, restM: 0.6, axle: w[3] })));
    for (let i = 0; i < 5; i++) backend.step(SIM_DT, 1);
    const out = new Float32Array(4 * VEHICLE_READ_STRIDE);
    backend.vehicle.drive(v, { engineForce: 0, brake: 0, steerRad: 0, handbrake: false });
    backend.vehicle.read(v, out);
    expect(VEHICLE_READ_STRIDE).toBe(11);
    for (let k = 0; k < 4; k++) {
      const b = k * VEHICLE_READ_STRIDE;
      expect(out[b], `wheel ${k} inContact`).toBe(1);
      expect(out[b + 5], `wheel ${k} normal y`).toBeGreaterThan(0.9);
      expect(Number.isNaN(out[b + 8]) && Number.isNaN(out[b + 9]), `wheel ${k} vLong and vLat are NaN`).toBe(true);
      expect(out[b + 10], `wheel ${k} loadN`).toBeGreaterThan(0);
    }
    expect(() => backend.vehicle.read(999, out)).toThrow(RangeError);
    backend.dispose();
  });

  for (const build of BUILDS) {
    it(`${build}: castRay and castSphere hit the ground, report toi and normal, and respect the group mask (M01b1)`, async () => {
      const backend = new RapierBackend(build);
      await backend.init();
      backend.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
      backend.step(SIM_DT, 1); // the broad phase learns about new colliders at the next step
      const ray = backend.castRay([3, 5, -4], [0, -2, 0], 20, GROUPS_BIT.static);
      expect(ray).not.toBeNull();
      expect(ray?.toi).toBeCloseTo(5, 4);
      expect(ray?.normal[1]).toBeCloseTo(1, 4);
      expect(backend.castRay([3, 5, -4], [0, -1, 0], 4, GROUPS_BIT.static)).toBeNull(); // too short
      expect(backend.castRay([3, 5, -4], [0, -1, 0], 20, GROUPS_BIT.dynamic)).toBeNull(); // the ground is not in the mask
      expect(backend.castRay([3, 5, -4], [0, 0, 0], 20, 0xffff)).toBeNull(); // no direction
      const ball = backend.castSphere([3, 5, -4], [0, -1, 0], 0.25, 20, GROUPS_BIT.static);
      expect(ball?.toi).toBeCloseTo(4.75, 4);
      expect(backend.castSphere([3, 0.1, -4], [0, -1, 0], 0.25, 20, GROUPS_BIT.static)?.toi).toBe(0); // starts touching
      backend.dispose();
    });

    it(`${build}: character.move reports ground contact with its normal on the ground, and moves freely in the air`, async () => {
      const backend = new RapierBackend(build);
      await backend.init();
      backend.addChunkStatics('g', worldBoxesShapes());
      const body = backend.createBody({ kind: 'kinematic', shape: 'capsule', dims: [0.55, 0.35], at: [0, 0.91, 60], groups: GROUPS.character });
      backend.step(SIM_DT, 1);
      const opts = { autostepM: 0.4, snapToGroundM: 0.5, maxSlopeDeg: 45, slide: true };
      const r = backend.character.move(body, [0.1, -0.02, 0], opts);
      expect(r.grounded).toBe(true);
      expect(r.groundNormalY).toBeGreaterThan(0.99);
      expect(r.moved[0]).toBeCloseTo(0.1, 4);
      // Free fall: nothing under the capsule.
      backend.setKinematicTarget(body, [0, 20, 60], [0, 0, 0, 1]);
      backend.step(SIM_DT, 1);
      const f = backend.character.move(body, [0, -0.1, 0], opts);
      expect(f.grounded).toBe(false);
      expect(f.moved[1]).toBeCloseTo(-0.1, 5);
      expect(() => backend.character.move(9999, [0, 0, 0], opts)).toThrow(RangeError);
      backend.dispose();
    });
  }

  it('using the backend before init() fails loudly', () => {
    const backend = new RapierBackend('simd-compat');
    expect(() => backend.step(SIM_DT, 1)).toThrow(/init/);
  });
});

describe('static shape conversion', () => {
  it('heightfieldLayout transposes row-major rows (Z) into Rapier column-major order and centres the field', () => {
    const heights = new Float32Array([0, 1, 2, 3, 4, 5]); // nx = 3, nz = 2: row 0 = [0,1,2], row 1 = [3,4,5]
    const l = heightfieldLayout({ nx: 3, nz: 2, cell: 2, heights, at: [10, 5, 20] });
    expect(l.ncols).toBe(2);
    expect(l.nrows).toBe(1);
    expect([...l.heights]).toEqual([0, 3, 1, 4, 2, 5]); // column ix, then row iz
    expect(l.scale).toEqual({ x: 4, y: 1, z: 2 });
    expect(l.centre).toEqual([12, 5, 21]);
    expect(() => heightfieldLayout({ nx: 3, nz: 2, cell: 2, heights: new Float32Array(5), at: [0, 0, 0] })).toThrow(RangeError);
  });

  it('prismPieces: a convex ring is one piece of 2n points; a clockwise ring is accepted; bad packs throw', () => {
    const square = new Float32Array([4, 0, 2, 0, 0, 1, 0, 1, 1, 0, 1]);
    const cw = new Float32Array([4, 0, 2, 0, 0, 0, 1, 1, 1, 1, 0]);
    expect(prismPieces(square)).toHaveLength(1);
    expect((prismPieces(square)[0] as number[]).length).toBe(8 * 3);
    expect(prismPieces(cw)).toHaveLength(1);
    expect(prismPieces(new Float32Array([2, 0, 1, 0, 0, 1, 1]))).toHaveLength(0); // two vertices
    expect(() => prismPieces(new Float32Array([4, 0, 1, 0, 0]))).toThrow(RangeError);
  });
});

describe('collision groups and config/physics.json', () => {
  it('interaction groups put membership in the high half and the filter in the low half', () => {
    expect(interactionGroups(1, 0xffff)).toBe(0x0001ffff);
    expect(interactionGroups(0x8000, 0x0002)).toBe(0x80000002);
    expect(GROUPS.sensor & 0xffff).toBe(0); // sensors collide with nothing
    expect(GROUPS.static >>> 16).toBe(PHYSICS_CONFIG.groups.static);
  });

  it('validates against config/schemas/physics.schema.json, and the schema rejects a bad file', () => {
    const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validate = ajv.compile(read('config/schemas/physics.schema.json') as object);
    expect(validate(read('config/physics.json')), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...(read('config/physics.json') as object), gravity: [0, -9.81] })).toBe(false);
    expect(validate({ ...(read('config/physics.json') as object), solverIterations: 0 })).toBe(false);
    const groups = { ...PHYSICS_CONFIG.groups };
    for (const bit of Object.values(groups)) expect(bit & (bit - 1)).toBe(0); // single bits
  });
});
