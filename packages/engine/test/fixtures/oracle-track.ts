/**
 * The oracle track (M03a1): the statics the vehicle oracle lines run on, built in code (no file ships). Everything is built
 * from + - x and constants, so every engine produces the same bytes. All lanes run along +X.
 *
 *   ground    one flat plane, 3 km by 3 km (the 1.2 km straight, the 100 m skidpad and the run-outs)
 *   straight  z = 0, x from 0 to 1,200: the 0-100 and braking lines
 *   skidpad   a 100 m radius circle centred at (400, 0, 300)
 *   filbert   z = -100: 30 m run-up, then a 31.5 % ramp of 120 m (37.8 m of rise), then 60 m of flat top
 *   crest     z = -200: flat, a 5 % rise from x = 40 to x = 60 (1 m), then a 1 m drop in one metre, then flat
 */
import type { StaticShapeSet } from '../../src/sim/physics/backend.ts';

export const ORACLE = {
  straight: { z: 0, lengthM: 1200 },
  skidpad: { cx: 400, cz: 300, radiusM: 100 },
  filbert: { z: -100, runUpM: 30, rampM: 120, grade: 0.315, topM: 60 },
  crest: { z: -200, riseFromM: 40, riseToM: 60, riseM: 1, dropAtM: 61 },
  groundHalfM: 1500,
} as const;

const GROUND_CELL = 3000;

export function groundShapes(): StaticShapeSet {
  return {
    heightfield: { nx: 2, nz: 2, cell: GROUND_CELL, heights: new Float32Array(4), at: [-600, 0, -1500] },
    prisms: new Float32Array(0),
  };
}

/** The Filbert strip: 2 m cells, 16 m wide, starting at x = 0. */
export function filbertShapes(): StaticShapeSet {
  const f = ORACLE.filbert;
  const cell = 2;
  const nx = (f.runUpM + f.rampM + f.topM) / cell + 1;
  const nz = 9;
  const heights = new Float32Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    const x = ix * cell;
    const run = x - f.runUpM;
    const h = run <= 0 ? 0 : run >= f.rampM ? f.rampM * f.grade : run * f.grade;
    for (let iz = 0; iz < nz; iz++) heights[iz * nx + ix] = h;
  }
  return { heightfield: { nx, nz, cell, heights, at: [0, 0, f.z - (cell * (nz - 1)) / 2] }, prisms: new Float32Array(0) };
}

/** The crest strip: 1 m cells, 16 m wide, from x = 0 to x = 160. */
export function crestShapes(): StaticShapeSet {
  const c = ORACLE.crest;
  const cell = 1;
  const nx = 161;
  const nz = 17;
  const heights = new Float32Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    let h = 0;
    if (ix >= c.riseFromM && ix <= c.riseToM) h = ((ix - c.riseFromM) / (c.riseToM - c.riseFromM)) * c.riseM;
    else if (ix > c.riseToM && ix < c.dropAtM) h = c.riseM;
    for (let iz = 0; iz < nz; iz++) heights[iz * nx + ix] = h;
  }
  return { heightfield: { nx, nz, cell, heights, at: [0, 0, c.z - (cell * (nz - 1)) / 2] }, prisms: new Float32Array(0) };
}

export function oracleShapes(): Record<string, StaticShapeSet> {
  return { 'oracle.ground': groundShapes(), 'oracle.filbert': filbertShapes(), 'oracle.crest': crestShapes() };
}

/** Start poses (feet, ENU metres) of the lines: heading +X (yaw -pi/2 faces +X). */
export const ORACLE_START = {
  straight: { pos: [0, 0, ORACLE.straight.z] as [number, number, number], yaw: -Math.PI / 2 },
  skidpad: { pos: [ORACLE.skidpad.cx, 0, ORACLE.skidpad.cz + ORACLE.skidpad.radiusM] as [number, number, number], yaw: -Math.PI / 2 },
  filbert: { pos: [0, 0, ORACLE.filbert.z] as [number, number, number], yaw: -Math.PI / 2 },
  crest: { pos: [0, 0, ORACLE.crest.z] as [number, number, number], yaw: -Math.PI / 2 },
} as const;
