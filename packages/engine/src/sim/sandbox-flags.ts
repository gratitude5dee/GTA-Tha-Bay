/**
 * The sandbox's body flags (M04e4): three session-only switches the combat, on-foot and vehicle systems read. They live in an
 * engine-internal object on `EngineServices`, never in `SandboxSlice` or `CoreSlice`, and start off at every sandbox enter.
 * A hashed resource named `sandbox-flags` carries them while any is set; a session that never sets one has no extra resource.
 * Pure sim code in the C02 lint scope.
 */
import type { StableKey } from '@dv/shared';
import type { SimResource } from './services.ts';

export interface SandboxFlags {
  /** The local player takes no damage and is never knocked out. */
  godMode: boolean;
  /** A standing jump peaks at `SUPER_JUMP_APEX_M`. */
  superJump: boolean;
  /** Session cars (`veh:sbx<n>`) take no impact damage. */
  carNoDamage: boolean;
}

/** The apex of a jump with `superJump` on, metres (a design value the owner may tune). */
export const SUPER_JUMP_APEX_M = 4;

export const SANDBOX_FLAGS_RESOURCE = 'sandbox-flags';

export function noFlags(): SandboxFlags {
  return { godMode: false, superJump: false, carNoDamage: false };
}

export function anyFlag(f: SandboxFlags): boolean {
  return f.godMode || f.superJump || f.carNoDamage;
}

const SESSION_CAR = /^veh:sbx\d+$/;

/** True only for a car the sandbox spawner placed (`veh:sbx<n>`). */
export function isSessionCar(key: StableKey | null): boolean {
  return key !== null && SESSION_CAR.test(key);
}

/** The flags as a hashed, checkpointed resource (three bytes). */
export function sandboxFlagsResource(flags: () => SandboxFlags): SimResource {
  return {
    name: SANDBOX_FLAGS_RESOURCE,
    hash(h) {
      const f = flags();
      h.u8(f.godMode ? 1 : 0).u8(f.superJump ? 1 : 0).u8(f.carNoDamage ? 1 : 0);
    },
    save(w) {
      const f = flags();
      w.u8(f.godMode ? 1 : 0);
      w.u8(f.superJump ? 1 : 0);
      w.u8(f.carNoDamage ? 1 : 0);
    },
    load(r) {
      const f = flags();
      f.godMode = r.u8() !== 0;
      f.superJump = r.u8() !== 0;
      f.carNoDamage = r.u8() !== 0;
    },
  };
}
