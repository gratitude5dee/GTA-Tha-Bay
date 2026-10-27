/**
 * Racing telemetry (06-racing-data.md 4.5, C16 closed registry; M07a1). Props are enumerations and small integers only: no
 * positions, no free text, and no `tier` (it comes from the envelope, DL-166). The schemas are the `racing.start` and
 * `racing.finish` entries of `packages/shared/schemas/telemetry/names.schema.json`.
 */
import type { HandlingProfile, RaceDef } from '@dv/shared';

export type Props = Record<string, string | number | boolean>;

export function startProps(def: Pick<RaceDef, 'kind'>, p: Pick<HandlingProfile, 'class'>, profile: 'local' | 'canonical'): Props {
  return { raceKind: def.kind, class: p.class, profile };
}

/** `<60`, `60-120`, `120-240`, `240-480`, `>480` seconds. */
export function durBucket(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? '<60' : s < 120 ? '60-120' : s < 240 ? '120-240' : s < 480 ? '240-480' : '>480';
}

export function finishProps(def: Pick<RaceDef, 'kind'>, outcome: 'finish' | 'dnf' | 'quit', ms: number, place: number, medals: number): Props {
  return { raceKind: def.kind, outcome, durBucket: durBucket(ms), place, medals };
}

/** Medals for a finish time: 0 none, 1 bronze, 2 silver, 3 gold. */
export function medalsFor(def: Pick<RaceDef, 'medals'>, ms: number): 0 | 1 | 2 | 3 {
  const s = ms / 1000;
  if (s <= def.medals[2]) return 3;
  if (s <= def.medals[1]) return 2;
  if (s <= def.medals[0]) return 1;
  return 0;
}

/** `racing.pursuit_end`: the highest heat, how the event ended and its length bucket. */
export function pursuitEndProps(heatMax: number, outcome: 'evade' | 'survive' | 'bust' | 'totaled' | 'quit', ms: number): Props {
  return { heatMax, outcome, durBucket: durBucket(ms) };
}

/** `racing.replay_view`. */
export const replayViewProps = (mode: 'exact' | 'track'): Props => ({ mode });

/** `racing.verify_fail` (a server-only name in C16; a client viewer emits it and the ingest drops it from a client batch). */
export const verifyFailProps = (reason: 'handlingRev' | 'buildId' | 'worldBake' | 'endHash' | 'finishTick' | 'gateTicks' | 'format'): Props => ({ reason });
