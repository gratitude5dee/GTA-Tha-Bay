import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeL0, decodeP0, type RenderChunk, type SimChunk } from '@dv/shared';
import { civicGrayboxConfig, civicGrayboxScenario } from '../src/sim/scenarios/civic-graybox.ts';
import { createPhysicsSim, type PhysicsSim } from '../src/sim/sim-factory.ts';

const dir = fileURLToPath(new URL('../../../tests/fixtures/world/civic-graybox/', import.meta.url));

/** The two fixture packs of M01f as bytes. */
export function fixturePacks(): { p0: Uint8Array; l0: Uint8Array } {
  return {
    p0: new Uint8Array(readFileSync(`${dir}p0-64-64.pack`)),
    l0: new Uint8Array(readFileSync(`${dir}l0-64-64.pack`)),
  };
}

export function fixtureChunks(): { sim: SimChunk[]; render: RenderChunk[] } {
  const { p0, l0 } = fixturePacks();
  const sim = decodeP0(p0);
  return { sim, render: decodeL0(l0, sim) };
}

/** The headless gray-box sim: the scenario with the real p0 pack, canonical profile. */
export async function createGrayboxSim(extra?: (s: Parameters<typeof civicGrayboxScenario.setup>[0]) => void): Promise<PhysicsSim> {
  const { p0 } = fixturePacks();
  return createPhysicsSim(
    civicGrayboxConfig('canonical'),
    extra ? { id: civicGrayboxScenario.id, setup: (s) => { civicGrayboxScenario.setup(s); extra(s); } } : civicGrayboxScenario,
    { boot: { packs: { p0 } } },
  );
}

/** An axis-aligned box from a four-vertex prism of the packed lists. */
export interface PrismBox { minX: number; maxX: number; minZ: number; maxZ: number; base: number; top: number }

/** The boxes in a prism pack (repeat [n, baseY, heightM, x0, z0 ...]); every fixture ring has four corners. */
export function boxesOf(pack: Float32Array): PrismBox[] {
  const out: PrismBox[] = [];
  for (let i = 0; i < pack.length;) {
    const n = pack[i] as number;
    const base = pack[i + 1] as number;
    const h = pack[i + 2] as number;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pack[i + 3 + 2 * k] as number;
      const z = pack[i + 4 + 2 * k] as number;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    out.push({ minX, maxX, minZ, maxZ, base, top: base + h });
    i += 3 + 2 * n;
  }
  return out;
}
