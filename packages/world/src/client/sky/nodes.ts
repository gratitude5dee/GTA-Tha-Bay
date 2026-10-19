/**
 * The sky's shared TSL uniform nodes (M02b2): one set for the whole page, written once per frame by the sky view and read by the dome,
 * the fog, the rain, the night lights and the world materials. Materials built before the sky exists get the same nodes with the day
 * values, so a world without a sky (a test) draws as it did in M02b1.
 */
import { uniform as uniformNode } from 'three/tsl';
import { Vector3 } from 'three/webgpu';
import type { U } from './tsl.ts';
import type { SkyUniforms } from './types.ts';

const uniform = <V>(v: V): U<V> => uniformNode(v as never) as unknown as U<V>;

const v3 = (x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z);

export function createSkyNodes() {
  return {
    uTime: uniform(0),
    uNight: uniform(0),
    uDark: uniform(0),
    uSunDir: uniform(v3(0, 1, 0)),
    uSunColor: uniform(v3(1, 1, 1)),
    uSkyTop: uniform(v3(0.14, 0.34, 0.74)),
    uSkyBottom: uniform(v3(0.62, 0.76, 0.92)),
    uAmbient: uniform(v3(0.5, 0.55, 0.7)),
    uFogColor: uniform(v3(0.64, 0.76, 0.92)),
    uFogNear: uniform(800),
    uFogFar: uniform(20000),
    uBank: uniform(0),
    uBankTop: uniform(0),
    uStars: uniform(0),
    uSunSize: uniform(0.03),
    uCloud: uniform(0.35),
    uRain: uniform(0),
    uBlackout: uniform(0),
    uWindowLit: uniform(1),
    /** Wetness of the ground, 0..1, already scaled by the tier (0 where the tier has none). */
    uWet: uniform(0),
    /** 1 where wetness also lowers roughness (desktop tiers). */
    uWetRough: uniform(0),
    /** Street lamps and window glow strength after the blackout: 1 on, 0 off. */
    uLampOn: uniform(0),
    /** Camera-follow anchors for the rain box and the lamp sprites (world units). */
    uCamPos: uniform(v3()),
    uViewportH: uniform(720),
  };
}

export type SkyNodes = ReturnType<typeof createSkyNodes>;

/** Writes one frame of `SkyUniforms` into the nodes. `wetScale` is the tier's wetness (0 none, 1 full). */
export function writeSkyNodes(n: SkyNodes, u: Readonly<SkyUniforms>, o: { wetScale: number; wetRough: boolean; bankTopM: number }): void {
  n.uNight.value = u.uNight;
  n.uDark.value = u.uDark;
  n.uSunDir.value.set(u.uSunDir[0], u.uSunDir[1], u.uSunDir[2]);
  n.uSunColor.value.set(u.uSunColor[0], u.uSunColor[1], u.uSunColor[2]);
  n.uSkyTop.value.set(u.uSkyTop[0], u.uSkyTop[1], u.uSkyTop[2]);
  n.uSkyBottom.value.set(u.uSkyBottom[0], u.uSkyBottom[1], u.uSkyBottom[2]);
  n.uAmbient.value.set(u.uAmbient[0], u.uAmbient[1], u.uAmbient[2]);
  n.uFogColor.value.set(u.uFogColor[0], u.uFogColor[1], u.uFogColor[2]);
  n.uFogNear.value = u.uFogNear;
  n.uFogFar.value = u.uFogFar;
  n.uBank.value = u.uBank;
  n.uBankTop.value = o.bankTopM;
  n.uStars.value = u.uStars;
  n.uSunSize.value = u.uSunSize;
  n.uCloud.value = u.uCloud;
  n.uRain.value = u.uRain;
  n.uBlackout.value = u.uBlackout;
  n.uWindowLit.value = u.uWindowLit;
  n.uWet.value = u.uWet * o.wetScale;
  n.uWetRough.value = o.wetRough ? 1 : 0;
  n.uLampOn.value = (1 - u.uBlackout) * smooth01((u.uDark - 0.2) / 0.4);
}

const smooth01 = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
