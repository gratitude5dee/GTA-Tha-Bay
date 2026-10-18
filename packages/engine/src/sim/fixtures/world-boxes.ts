import { dcos, dsin, PI } from '@dv/shared';
import type { StaticShapeSet } from '../physics/backend.ts';

/**
 * Fixture world for the physics tests and the `physics-drop` scenario: a flat 256 m heightfield and 12 static
 * boxes on a ring of radius 22 m. Everything is computed with + - x and detmath, so every engine builds the same bytes.
 */
export interface FixtureBox {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  baseY: number;
  heightM: number;
}

export const GROUND_NX = 65;
export const GROUND_CELL_M = 4;
/** Half the heightfield width in metres: 4 m x 64 cells / 2. */
export const GROUND_HALF_M = (GROUND_CELL_M * (GROUND_NX - 1)) / 2;
export const FIXTURE_BOX_COUNT = 12;
export const FIXTURE_RING_M = 22;

export function groundHeightfield(): NonNullable<StaticShapeSet['heightfield']> {
  return {
    nx: GROUND_NX,
    nz: GROUND_NX,
    cell: GROUND_CELL_M,
    heights: new Float32Array(GROUND_NX * GROUND_NX),
    at: [-GROUND_HALF_M, 0, -GROUND_HALF_M],
  };
}

export function fixtureBoxes(): FixtureBox[] {
  const boxes: FixtureBox[] = [];
  for (let i = 0; i < FIXTURE_BOX_COUNT; i++) {
    const a = (i * PI) / 6;
    boxes.push({
      cx: FIXTURE_RING_M * dcos(a),
      cz: FIXTURE_RING_M * dsin(a),
      hx: 1.5 + (i % 3) * 0.5,
      hz: 1.5 + ((i + 1) % 3) * 0.5,
      baseY: 0,
      heightM: 1.5 + (i % 4) * 0.75,
    });
  }
  return boxes;
}

/** C08 PrismPack for a list of axis-aligned boxes: repeat [4, baseY, heightM, x0, z0, ..., x3, z3]. */
export function boxPrisms(boxes: readonly FixtureBox[]): Float32Array {
  const out = new Float32Array(boxes.length * 11);
  boxes.forEach((b, i) => {
    out.set(
      [4, b.baseY, b.heightM, b.cx - b.hx, b.cz - b.hz, b.cx + b.hx, b.cz - b.hz, b.cx + b.hx, b.cz + b.hz, b.cx - b.hx, b.cz + b.hz],
      i * 11,
    );
  });
  return out;
}

/** The fixture as a C01 StaticShapeSet. */
export function worldBoxesShapes(): StaticShapeSet {
  return { heightfield: groundHeightfield(), prisms: boxPrisms(fixtureBoxes()) };
}
