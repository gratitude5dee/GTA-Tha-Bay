/**
 * Which wheel-force path the vehicle system runs (M03a2, U-RAC-1): `castray` is the own ray-cast vehicle on a dynamic
 * Rapier body; `controller` is an adapter over Rapier's `DynamicRayCastVehicleController`. Set by the spike result and
 * written down in docs/decisions/ADR-0031-vehicle-wheel-force-path.md; `wheel-spike.adr.spec.ts` keeps the three in step.
 */
export type WheelPathName = 'castray' | 'controller';

export const SELECTED_WHEEL_PATH: WheelPathName = 'castray';
