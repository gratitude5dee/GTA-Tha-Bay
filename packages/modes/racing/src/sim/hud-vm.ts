/**
 * `RaceHudVm` (06-racing-data.md 4.7), published every tick through `ModeContext.ui` under the view-model key `mode.racing.hud`
 * (the shell draws it; S10 owns the look). Whole-value replace, so one patch per tick: the object stays well under the 4 KiB
 * bridge budget.
 */
import type { DamageState, JsonValue } from '@dv/shared';

export interface RaceHudVm {
  speed: number;
  unit: 'kph' | 'mph';
  rpm01: number;
  gear: number;
  nitro01: number;
  place: number;
  of: number;
  lap: number;
  laps: number;
  gate: number;
  gates: number;
  timerMs: number;
  timeLeftMs: number | null;
  split: { gate: number; deltaMs: number } | null;
  heat: { level: number; phase: string; cooldown01: number; bounty: number } | null;
  damage: { body: number; engine: number; tires: number[] };
  hop: { charges: number; ready01: number } | null;
  govern: boolean;
  driftScore: number | null;
  wrongWay: boolean;
  prompt: string | null;
  /** Director phase, for the countdown and the results card. */
  phase: string;
  /** Ticks left in the countdown, 0 outside it. */
  countdown: number;
  /** M07a2: the results card, set from Results on (place, time, medal, what the run paid). */
  results: { outcome: 'finish' | 'dnf'; place: number; of: number; ms: number; medals: number; newBest: boolean; cashCents: number; rep: number; reason: string | null } | null;
  /** M07a2: a ghost is running beside the car. */
  ghost: boolean;
}

export const HUD_VM_KEY = 'mode.racing.hud' as const;

export interface HudInputs {
  speedMps: number;
  unit: 'kph' | 'mph';
  rpm: number;
  redlineRpm: number;
  gear: number;
  nitro01: number;
  place: number;
  of: number;
  lap: number;
  laps: number;
  gate: number;
  gates: number;
  timerMs: number;
  timeLeftMs: number | null;
  split: { gate: number; deltaMs: number } | null;
  damage: DamageState;
  driftScore: number | null;
  wrongWay: boolean;
  prompt: string | null;
  phase: string;
  countdown: number;
  govern?: boolean;
  heat?: RaceHudVm['heat'];
  results?: RaceHudVm['results'];
  ghost?: boolean;
}

const round = (x: number, d = 1000): number => Math.round(x * d) / d;

export function buildHud(i: HudInputs): RaceHudVm {
  const factor = i.unit === 'kph' ? 3.6 : 2.2369362920544;
  return {
    speed: Math.round(i.speedMps * factor),
    unit: i.unit,
    rpm01: i.redlineRpm > 0 ? round(Math.min(1, i.rpm / i.redlineRpm)) : 0,
    gear: i.gear,
    nitro01: round(i.nitro01),
    place: i.place,
    of: i.of,
    lap: i.lap,
    laps: i.laps,
    gate: i.gate,
    gates: i.gates,
    timerMs: i.timerMs,
    timeLeftMs: i.timeLeftMs === null ? null : Math.round(i.timeLeftMs),
    split: i.split,
    heat: i.heat ?? null,
    damage: { body: round(i.damage.body), engine: round(i.damage.engine), tires: i.damage.tires.map((t) => round(t)) },
    hop: null,
    govern: i.govern ?? false,
    driftScore: i.driftScore,
    wrongWay: i.wrongWay,
    prompt: i.prompt,
    phase: i.phase,
    countdown: i.countdown,
    results: i.results ?? null,
    ghost: i.ghost ?? false,
  };
}

export const hudToJson = (vm: RaceHudVm): JsonValue => vm as unknown as JsonValue;
