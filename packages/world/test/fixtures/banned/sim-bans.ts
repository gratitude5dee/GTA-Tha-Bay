// Fixture for packages/world/test/lint.bans.spec.ts: three banned APIs, each of which the C02 determinism lint must report when this
// text sits under packages/world/src/sim/. Never imported by anything.
import { Vector3 } from 'three';

export const roll = (): number => Math.random();
export const stamp = (): number => new Date().getTime();
export const origin = (): Vector3 => new Vector3();
