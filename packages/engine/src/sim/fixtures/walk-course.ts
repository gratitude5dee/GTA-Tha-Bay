import type { StaticShapeSet } from '../physics/backend.ts';
import { boxPrisms, type FixtureBox } from './world-boxes.ts';

/**
 * The walking course (M01b1): four lanes of the fixture world, each along +X, for the controller tests and the
 * `walk-drop` scenario. Everything is built from + - x and constants, so every engine produces the same bytes.
 *
 *   z = -100  flat run, x from -100 to +100
 *   z =  -84  a 0.35 m step at x = -60 (prism)
 *   z =  -68  a 0.50 m step at x = -60 (prism)
 *   z =  -52  a 10 % grade from x = -60 to x = -20 (heightfield, 0.4 m of rise per 4 m cell)
 *   z =  -36  a 50 degree bank from x = -60 to x = -52 (heightfield, 4.767 m of rise per 4 m cell)
 *
 * Steps are prisms because a 4 m heightfield cell cannot hold a 0.35 m step; the grade and the bank are heightfields.
 */
export const WALK_COURSE = {
  flatLaneZ: -100,
  stepLowLaneZ: -84,
  stepHighLaneZ: -68,
  rampLaneZ: -52,
  bankLaneZ: -36,
  /** X of the near face of both steps, the foot of the grade and the foot of the bank. */
  featureX: -60,
  stepLowM: 0.35,
  stepHighM: 0.5,
  /** Depth of a step along X. */
  stepDepthM: 2,
  /** Half the width of every lane, metres. */
  laneHalfWidthM: 4,
  rampLengthM: 40,
  /** Rise per metre of the grade strip: 10 %. */
  rampGrade: 0.1,
  bankLengthM: 8,
  bankDeg: 50,
} as const;

const CELL_M = 4;

/** Rise of the bank per 4 m cell: 4 m x tan(50 degrees). A constant, not Math.tan, so the bytes are the same everywhere. */
const BANK_RISE_PER_CELL = 4.767; // tan(50 degrees) = 1.19175

export function stepBoxes(): FixtureBox[] {
  const c = WALK_COURSE;
  const cx = c.featureX + c.stepDepthM / 2;
  return [
    { cx, cz: c.stepLowLaneZ, hx: c.stepDepthM / 2, hz: c.laneHalfWidthM, baseY: 0, heightM: c.stepLowM },
    { cx, cz: c.stepHighLaneZ, hx: c.stepDepthM / 2, hz: c.laneHalfWidthM, baseY: 0, heightM: c.stepHighM },
  ];
}

/** The 10 % grade strip: 11 x 3 samples, 40 m long and 8 m wide, rising from 0 to 4 m. */
export function rampShapes(): StaticShapeSet {
  const c = WALK_COURSE;
  const nx = c.rampLengthM / CELL_M + 1;
  const nz = 3;
  const heights = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = ix * CELL_M * c.rampGrade;
  return {
    heightfield: { nx, nz, cell: CELL_M, heights, at: [c.featureX, 0, c.rampLaneZ - c.laneHalfWidthM] },
    prisms: new Float32Array(0),
  };
}

/** The 50 degree bank: 3 x 3 samples, 8 m long and 8 m wide, rising 9.5 m. */
export function bankShapes(): StaticShapeSet {
  const c = WALK_COURSE;
  const nx = c.bankLengthM / CELL_M + 1;
  const nz = 3;
  const heights = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) heights[iz * nx + ix] = ix * BANK_RISE_PER_CELL;
  return {
    heightfield: { nx, nz, cell: CELL_M, heights, at: [c.featureX, 0, c.bankLaneZ - c.laneHalfWidthM] },
    prisms: new Float32Array(0),
  };
}

export function stepShapes(): StaticShapeSet {
  return { prisms: boxPrisms(stepBoxes()) };
}

/** The course as chunk-statics sets, keyed by chunk name. */
export function walkCourseShapes(): Record<string, StaticShapeSet> {
  return { 'course.ramp': rampShapes(), 'course.bank': bankShapes(), 'course.steps': stepShapes() };
}
