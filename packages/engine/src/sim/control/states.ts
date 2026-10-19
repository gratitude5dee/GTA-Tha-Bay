import type { AnimStateId } from '@dv/shared';

/**
 * Control state ids, grouped by family (spec/domains/01-engine.md section 2.5). Predicates read whole families
 * (`state >= 100 && state < 200` is "on foot").
 */
export const CONTROL_STATE = {
  idle: 100,
  walk: 101,
  run: 102,
  sprint: 103,
  jump: 110,
  fall: 111,
  land: 112,
  vault: 120,
  ragdoll: 300,
  gettingUp: 301,
  knockedOut: 302,
  teleportPending: 700,
  teleportWaiting: 701,
  swim: 800,
} as const;

/** `Control.owner` values (the C01 field is a u8). 0 is "no owner yet". */
export const CONTROL_OWNER = {
  None: 0,
  OnFoot: 1,
  Vehicle: 2,
  Swim: 3,
  Cutscene: 4,
  Fighter: 5,
  Ragdoll: 6,
  Arrested: 7,
} as const;
export type ControlOwnerId = (typeof CONTROL_OWNER)[keyof typeof CONTROL_OWNER];

/** The ownership machine's phase (the diagram in section 2.5). */
export const CONTROL_PHASE = {
  Ready: 0,
  Waiting: 1,
  Entering: 2,
  Active: 3,
  Leaving: 4,
  Delegated: 5,
} as const;
export type ControlPhaseId = (typeof CONTROL_PHASE)[keyof typeof CONTROL_PHASE];

export const PHASE_NAMES: readonly string[] = ['Ready', 'Waiting', 'Entering', 'Active', 'Leaving', 'Delegated'];
export const OWNER_NAMES: readonly string[] = ['None', 'OnFoot', 'Vehicle', 'Swim', 'Cutscene', 'Fighter', 'Ragdoll', 'Arrested'];

/**
 * `Control.pending` (u8) packs the machine phase (bits 0 to 2) and the owner a request asked for (bits 3 to 5, 0 = no
 * request). The C01 schema has no room for more, and these two values are the whole machine state besides `owner`,
 * `state` and `sinceTick`.
 */
export const packPending = (phase: ControlPhaseId, requested: ControlOwnerId): number => (phase & 7) | ((requested & 7) << 3);
export const phaseOf = (pending: number): ControlPhaseId => (pending & 7) as ControlPhaseId;
export const requestedOf = (pending: number): ControlOwnerId => ((pending >> 3) & 7) as ControlOwnerId;

/** Localisation keys for the reasons a request is refused (English defaults live in packages/ui, M04b1). */
export const CONTROL_REASON = {
  groundNotLoaded: 'engine.control.groundNotLoaded',
  busy: 'engine.control.busy',
  wrongOwner: 'engine.control.wrongOwner',
} as const;
/** English defaults for the reason keys until the i18n catalog exists (spec 2.5). */
export const CONTROL_REASON_EN: Readonly<Record<string, string>> = {
  [CONTROL_REASON.groundNotLoaded]: 'Ground not loaded; player was not moved',
  [CONTROL_REASON.busy]: 'Not now',
  [CONTROL_REASON.wrongOwner]: 'Not available right now',
};

/** Network animation state (C04 `AnimStateId`) for a control state: 100 to 0, 101 to 1, and so on. */
export function animStateOf(controlState: number): AnimStateId {
  switch (controlState) {
    case CONTROL_STATE.walk: return 1;
    case CONTROL_STATE.run: return 2;
    case CONTROL_STATE.sprint: return 3;
    case CONTROL_STATE.jump: return 4;
    case CONTROL_STATE.fall: return 5;
    case CONTROL_STATE.land: return 6;
    case CONTROL_STATE.vault: return 7;
    case CONTROL_STATE.ragdoll: return 12;
    case CONTROL_STATE.gettingUp: return 13;
    case CONTROL_STATE.knockedOut: return 14;
    default: return 0;
  }
}
