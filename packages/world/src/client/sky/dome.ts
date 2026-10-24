/**
 * The sky dome (M02b2; TSL only): a back-faced sphere centred on the camera in the backdrop pass. One fragment function draws the
 * horizon-to-zenith gradient from the keyed colours, the sun disc and its glow, the moon opposite the sun, stars (`max(0, night -
 * 0.3)`) and, where the tier has them, a painted cloud layer. The dome reads the shared `SkyNodes` only.
 */
import { BackSide, Mesh, MeshBasicNodeMaterial, SphereGeometry, type Vector3 } from 'three/webgpu';
import type { SkyNodes } from './nodes.ts';
import type { CloudKind } from './tiers.ts';
import { asNode, clamp, dot, exp, float, floor, fract, length, max, mix, normalize, positionLocal, pow, sin, smoothstep, step, vec2, vec3, type L } from './tsl.ts';

/** Dome radius, metres: inside the backdrop camera's 140 km far plane. */
export const DOME_RADIUS_M = 100_000;

const hash21 = (p: L): L => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

const vnoise = (p: L): L => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

const fbm = (p: L, octaves: number): L => {
  let sum: L = float(0);
  let amp = 0.5;
  let q = p;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(vnoise(q).mul(amp));
    q = q.mul(2.03).add(vec2(17.3, 9.1));
    amp *= 0.5;
  }
  return sum;
};

export function createDomeMaterial(n: SkyNodes, clouds: CloudKind, blend?: L): MeshBasicNodeMaterial {
  const dir = normalize(positionLocal);
  const y = dir.y;

  // Horizon to zenith. Below the horizon the bottom colour darkens a little so the dome never shows a seam against the ring.
  const t = pow(clamp(y, 0, 1), 0.5);
  let col = mix(n.uSkyBottom, n.uSkyTop, t);
  col = mix(col, n.uSkyBottom.mul(0.8), clamp(y.negate().mul(6), 0, 1));

  // Clouds: a painted layer on a flat plane above the viewer (the gradient tiers have none).
  if (clouds !== 'gradient') {
    const plane = vec2(dir.x, dir.z).div(max(y.add(0.12), 0.06)).mul(0.85).add(vec2(n.uTime.mul(0.006), n.uTime.mul(0.002)));
    const density = fbm(plane, 4);
    const edge = float(1).sub(n.uCloud.mul(0.85));
    const mask = smoothstep(edge.sub(0.05), edge.add(0.25), density).mul(smoothstep(0.0, 0.2, y));
    const lit = n.uAmbient.mul(1.35).add(n.uSunColor.mul(0.28));
    col = mix(col, lit, mask.mul(0.82));
  }

  // The sun: a disc, a tight glow and a wide halo, only while it is above the horizon.
  const sunUp = smoothstep(-0.04, 0.06, n.uSunDir.y);
  const angSun = dot(dir, n.uSunDir).clamp(-1, 1).acos();
  const disc = float(1).sub(smoothstep(n.uSunSize.mul(0.85), n.uSunSize, angSun));
  const glow = exp(angSun.mul(angSun).negate().div(n.uSunSize.mul(n.uSunSize).mul(60)));
  const halo = exp(angSun.negate().mul(3.2)).mul(0.12);
  col = col.add(n.uSunColor.mul(disc.mul(5.0).add(glow.mul(0.55)).add(halo)).mul(sunUp));

  // The moon sits opposite the sun at 0.4 of its strength.
  const moonDir = n.uSunDir.negate();
  const moonUp = smoothstep(-0.04, 0.06, moonDir.y).mul(n.uNight);
  const angMoon = dot(dir, moonDir).clamp(-1, 1).acos();
  const moonDisc = float(1).sub(smoothstep(0.02, 0.026, angMoon));
  const moonGlow = exp(angMoon.mul(angMoon).negate().div(0.004));
  col = col.add(vec3(0.82, 0.88, 1.0).mul(moonDisc.mul(0.64).add(moonGlow.mul(0.03))).mul(moonUp));

  // Stars: sparse points on a direction grid, fading in above the horizon, strength `max(0, night - 0.3)` of the keys.
  const sd = dir.mul(150);
  const cell = floor(sd);
  const h = hash21(vec2(cell.x.add(cell.y.mul(57.0)), cell.z));
  const h2 = hash21(vec2(cell.x.mul(1.7).add(cell.y.mul(13.0)), cell.z.mul(1.3)));
  const d = length(fract(sd).sub(0.5));
  const starMask = step(0.9965, h).mul(float(1).sub(smoothstep(0.0, 0.22, d)));
  const twinkle = float(0.65).add(sin(n.uTime.mul(2.0).add(h2.mul(60))).mul(0.35));
  col = col.add(vec3(1, 1, 1).mul(starMask.mul(h2.mul(0.7).add(0.3)).mul(twinkle).mul(n.uStars).mul(smoothstep(0.0, 0.18, y)).mul(1.2)));

  const m = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false, fog: false });
  m.colorNode = asNode(col);
  // M02e (`full` profile): the dome is blended over the physical sky with this weight (1 = the dome alone, as before).
  if (blend) {
    m.transparent = true;
    (m as unknown as { opacityNode: unknown }).opacityNode = blend;
  }
  return m;
}

/** The dome mesh. The caller keeps it centred on the camera. */
export function createDome(n: SkyNodes, clouds: CloudKind, blend?: L): Mesh {
  const mesh = new Mesh(new SphereGeometry(DOME_RADIUS_M, 40, 20), createDomeMaterial(n, clouds, blend));
  mesh.name = 'world.sky.dome';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

/** Centres the dome on a camera position. */
export function centreDome(dome: Mesh, camPos: Vector3): void {
  dome.position.copy(camPos);
}
