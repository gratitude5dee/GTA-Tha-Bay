import { SIM_DT } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { GROUP_BIT } from '../src/sim/physics/groups.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { groundHeightfield } from './fixtures/world-boxes.ts';

const DOWN: [number, number, number] = [0, -1, 0];

describe('scene queries and the first step (spec/03: Rapier queries see colliders only after a step)', () => {
  it('a ray hits nothing before the first step and hits the ground after it', async () => {
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)).toBeNull();
    b.step(SIM_DT, 1);
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)?.toi).toBeCloseTo(5, 5);
    b.dispose();
  });

  it('a restored snapshot answers queries at once, without a step', async () => {
    const a = new RapierBackend('deterministic-compat');
    await a.init();
    a.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    a.step(SIM_DT, 1);
    const snap = a.snapshot();
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    b.restore(snap);
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)?.toi).toBeCloseTo(5, 5);
    expect(b.castSphere([0, 5, 0], DOWN, 0.25, 20, GROUP_BIT.static)?.toi).toBeCloseTo(4.75, 5);
    a.dispose();
    b.dispose();
  });
});
