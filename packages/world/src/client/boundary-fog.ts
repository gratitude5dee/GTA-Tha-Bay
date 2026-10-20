/**
 * The county-line fog ramp (M02c1; 02-world-maps.md section 4.1 b): near the county line the sim publishes a factor from 1 (150 m
 * away) down to 0.4 (at the line) in the snapshot side block (`wf`). This scales the fog far plane of M02b2's sky by it, so the
 * city fades into the haze toward the edge. The near distance follows so it never passes half the far one.
 */
import type { SkyNodes } from './sky/nodes.ts';

/** Applies the factor to the fog uniforms the sky wrote this frame. 1 (or no factor) changes nothing. */
export function applyBoundaryFog(n: Pick<SkyNodes, 'uFogNear' | 'uFogFar'>, factor: number | undefined): void {
  if (factor === undefined || !(factor < 1)) return;
  const f = factor > 0.05 ? factor : 0.05;
  n.uFogFar.value *= f;
  if (n.uFogNear.value > n.uFogFar.value * 0.5) n.uFogNear.value = n.uFogFar.value * 0.5;
}
