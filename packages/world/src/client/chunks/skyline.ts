/**
 * The skyline set's distance rules (02-world-bake.md section 7 rule 4; M02d2), pure so the unit specs and the layer share them. The
 * skyline landmarks (the two bridges and the towers) stay up at the `lo` fidelity within the tier's building draw distance (the
 * streaming r2). Three rings of that distance, from `config/world/landmarks-runtime.json`:
 *
 *   load    a landmark is read (and its pack pinned) once it is inside this ring, nearest first
 *   mount   it joins the scene inside this ring, and stays up until it is outside `release` (hysteresis)
 *   release it is parked (hidden, kept) outside this ring, after its proxies are meshed back
 *
 * mount is wider than the draw distance itself, so a skyline landmark is already up when it crosses r2: never a pop-in at the edge.
 */
export interface SkylineRuntime {
  /** `lm.<slug>` ids of the skyline set. */
  ids: string[];
  loadFactor: number;
  mountFactor: number;
  releaseFactor: number;
}

export interface SkylineRings {
  /** The draw distance the rings are factors of, metres. */
  rangeM: number;
  loadM: number;
  mountM: number;
  releaseM: number;
}

export function skylineRings(rangeM: number, cfg: SkylineRuntime): SkylineRings {
  return { rangeM, loadM: rangeM * cfg.loadFactor, mountM: rangeM * cfg.mountFactor, releaseM: rangeM * cfg.releaseFactor };
}

/** Whether the model should be up at `distM`, given whether it was: comes in inside `mountM`, goes out beyond `releaseM`. */
export function inSkylineRange(was: boolean, distM: number, rings: SkylineRings): boolean {
  return was ? distM <= rings.releaseM : distM <= rings.mountM;
}

export interface SkylineCandidate {
  id: string;
  /** `idle` or `failed` can be read; anything else is busy or done. */
  phase: string;
  distM: number;
  /** A failed read is tried again at this time (ms). */
  retryAt: number;
}

/** The skyline landmark to read next: the nearest readable one inside the load ring, ties by id; null when there is none. */
export function nextSkylineLoad<T extends SkylineCandidate>(entries: readonly T[], rings: SkylineRings, nowMs: number): T | null {
  let best: T | null = null;
  for (const e of entries) {
    const readable = e.phase === 'idle' || (e.phase === 'failed' && nowMs >= e.retryAt);
    if (!readable || e.distM > rings.loadM) continue;
    if (!best || e.distM < best.distM || (e.distM === best.distM && e.id < best.id)) best = e;
  }
  return best;
}
