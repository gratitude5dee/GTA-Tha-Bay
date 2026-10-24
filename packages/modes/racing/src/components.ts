/**
 * Racing components 1024 to 1031 (C01 range 1024 to 1279, owner S06; 06-racing-data.md 4.5). Registered by the racing sim module
 * (`sim/module.ts`) through `SimModule.components`, so a session that never loads the module registers, allocates and hashes
 * exactly what it did before. Of the eight, M07a1 writes `RaceParticipant`, `Nitro`, `Drift` and `Surface`; the rest are
 * registered now so their ids are fixed (AI drivers, quirks and ghosts arrive in M07a2 and M07b1).
 */
import { defineComponent } from '@dv/engine/sim';
import type { ComponentDef } from '@dv/shared';

export const RaceParticipant = defineComponent({
  id: 1024, name: 'RaceParticipant', owner: 'S06', hashed: true, snapshot: 'net',
  schema: { instance: 'u16', gate: 'u16', lap: 'u8', place: 'u8', sM: 'f32', finishTick: 'u32', flags: 'u8' },
});
export const AiDriver = defineComponent({
  id: 1025, name: 'AiDriver', owner: 'S06', hashed: true, snapshot: 'none',
  schema: { driver: 'u32', skill: 'u8', lineOffsetCm: 'i16', rbMult: 'f32', mode: 'u8', stuckTicks: 'u16' },
});
export const Drift = defineComponent({
  id: 1026, name: 'Drift', owner: 'S06', hashed: true, snapshot: 'render',
  schema: { angleDeg: 'f32', ticks: 'u16', chain: 'f32', score: 'f32' },
});
export const Nitro = defineComponent({
  id: 1027, name: 'Nitro', owner: 'S06', hashed: true, snapshot: 'render+net',
  schema: { charge: 'f32', on: 'u8', lockTicks: 'u16' },
});
export const VehicleQuirk = defineComponent({
  id: 1028, name: 'VehicleQuirk', owner: 'S06', hashed: true, snapshot: 'net',
  schema: { hopCharges: 'u8', hopRechargeTicks: 'u16', stallTicks: 'u16', governed: 'u8', autoYieldActive: 'u8' },
});
export const GhostPlayback = defineComponent({
  id: 1029, name: 'GhostPlayback', owner: 'S06', hashed: true, snapshot: 'render',
  schema: { replay: 'u32', cursor: 'u32', track: 'u8' },
});
export const RaceMarker = defineComponent({
  id: 1030, name: 'RaceMarker', owner: 'S06', hashed: false, snapshot: 'render',
  schema: { gate: 'u16', kind: 'u8', state: 'u8' },
});
export const Surface = defineComponent({
  id: 1031, name: 'Surface', owner: 'S06', hashed: false, snapshot: 'render',
  schema: { kind: 'u8', wetness: 'u8' },
});

export const RACING_COMPONENTS: readonly ComponentDef[] = [RaceParticipant, AiDriver, Drift, Nitro, VehicleQuirk, GhostPlayback, RaceMarker, Surface];

/** `RaceParticipant.flags` bits. */
export const PARTICIPANT_FLAG = { human: 1, ai: 2, dnf: 4, ghost: 8 } as const;
