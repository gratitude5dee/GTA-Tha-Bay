/**
 * Rain (M02b2; TSL only; no thunder, snow or lightning). Two pieces, by tier (tiers.ts):
 *
 *  - streaks: one mesh of N camera-facing quads, positioned entirely in the vertex shader. Each streak has a fixed seed; its place
 *    in a world-anchored lattice is wrapped around the camera, so the rain does not swim when the camera moves, and it falls with
 *    the shared clock. `uRain` (0..1) scales the visible count through the draw range. `volume` fills a box around the camera,
 *    `head` a small one around the head (XR); streak width grows with distance so far streaks stay a pixel wide;
 *  - overlay: a screen-space layer of slanted streaks in front of the camera (the mobile tiers), with no geometry cost.
 *
 * The wet look of the ground and roofs is in the world materials (`uWet`), not here.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, type PerspectiveCamera } from 'three/webgpu';
import type { SkyNodes } from './nodes.ts';
import type { RainStyle } from './tiers.ts';
import { asNode, attribute, cameraProjectionMatrix, cameraViewMatrix, cross, dot, float, floor, fract, length, max, mod, normalize, select, sin, smoothstep, uv, varying, vec2, vec3, vec4 } from './tsl.ts';

/** Half-width of the streak box around the camera and its height, metres, by style. */
export const RAIN_BOX = {
  volume: { radius: 26, height: 30, fall: 14, length: 0.9 },
  head: { radius: 5, height: 7, fall: 12, length: 0.5 },
} as const;

/** A small deterministic generator for the streak seeds (the rain is a look, not a sim input; fixed so every run draws the same rain). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    s = (Math.imul(s ^ (s >>> 12), 0x297a2d39) + 0x2c1b3c6d) >>> 0;
    return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
  };
}

export interface RainStreaks {
  mesh: Mesh;
  /** Streaks in the geometry. */
  capacity: number;
  /** Shows `rain` (0..1) of the streaks. */
  setAmount(rain: number): void;
  dispose(): void;
}

export function createRainStreaks(n: SkyNodes, count: number, style: Exclude<RainStyle, 'none'>): RainStreaks {
  const box = RAIN_BOX[style];
  const rnd = seeded(0x5eed + count);
  const corner = new Float32Array(count * 4 * 3);
  const seed = new Float32Array(count * 4 * 3);
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const sx = rnd(), sy = rnd(), sz = rnd();
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      corner[v * 3] = c % 2 === 0 ? -1 : 1;
      corner[v * 3 + 1] = c < 2 ? 0 : 1;
      seed[v * 3] = sx;
      seed[v * 3 + 1] = sy;
      seed[v * 3 + 2] = sz;
    }
    const b = i * 4;
    index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(corner, 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.setDrawRange(0, 0);

  const R = box.radius, H = box.height;
  const cam = n.uCamPos;
  const s = attribute('aSeed', 'vec3');
  const c = attribute('position', 'vec3');
  const speed = float(box.fall).mul(float(0.85).add(s.x.mul(0.3)));
  const wx = mod(s.x.mul(2 * R).sub(cam.x).add(R), 2 * R).sub(R);
  const wz = mod(s.z.mul(2 * R).sub(cam.z).add(R), 2 * R).sub(R);
  const wy = mod(s.y.mul(H).sub(cam.y).sub(n.uTime.mul(speed)).add(H / 2), H).sub(H / 2);
  const centre = vec3(cam.x.add(wx), cam.y.add(wy), cam.z.add(wz));
  const toCam = centre.sub(cam);
  const dist = length(toCam);
  const down = normalize(vec3(0.12, -1, 0.06));
  const right = normalize(cross(down, toCam));
  const width = max(float(0.012), dist.mul(0.0016));
  const world = centre.add(down.mul(c.y.mul(box.length))).add(right.mul(c.x.mul(width)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));

  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: DoubleSide });
  const m2 = m as unknown as { vertexNode: unknown; colorNode: unknown; opacityNode: unknown };
  m2.vertexNode = asNode(clip);
  const vd = varying(dist);
  // Streaks fade out at the far edge of the box and just in front of the lens (a near streak would be a long white line).
  const fade = float(1).sub(smoothstep(R * 0.55, R, vd)).mul(smoothstep(0.8, 3.5, vd));
  const taper = float(1).sub(c.y.mul(0.75));
  m2.colorNode = asNode(vec3(0.78, 0.85, 0.96));
  m2.opacityNode = asNode(fade.mul(taper).mul(n.uRain.mul(0.5).clamp(0, 0.5)));
  const mesh = new Mesh(g, m);
  mesh.name = 'world.sky.rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return {
    mesh,
    capacity: count,
    setAmount(rain: number) {
      const k = Math.max(0, Math.min(1, rain));
      g.setDrawRange(0, Math.floor(count * k) * 6);
      mesh.visible = k > 0.003;
    },
    dispose() {
      g.dispose();
      m.dispose();
    },
  };
}

export interface RainOverlay {
  mesh: Mesh;
  /** Places the quad in front of the camera so it fills the view; call every frame while it is visible. */
  follow(cam: PerspectiveCamera): void;
  dispose(): void;
}

/** Distance of the overlay quad from the camera, metres (inside the near plane's usable range). */
export const OVERLAY_DISTANCE_M = 0.4;

export function createRainOverlay(n: SkyNodes): RainOverlay {
  const p = uv().mul(vec2(46, 9));
  // Slant the columns with height, then give each column its own speed, phase and presence.
  const sheared = vec2(p.x.add(p.y.mul(0.9)), p.y);
  const col = floor(sheared.x);
  const rnd = fract(sin(dot(vec2(col, 3.7), vec2(12.9898, 78.233))).mul(43758.5453));
  const rnd2 = fract(rnd.mul(91.7));
  const yy = fract(sheared.y.add(n.uTime.mul(float(0.9).add(rnd.mul(1.4)))).add(rnd2.mul(7)));
  const streak = smoothstep(0.0, 0.04, yy).mul(float(1).sub(smoothstep(0.08, 0.3, yy)));
  const xx = fract(sheared.x).sub(0.5).abs();
  const line = float(1).sub(smoothstep(0.02, 0.06, xx));
  const present = select(rnd2.greaterThan(0.45), float(1), float(0));
  const alpha = streak.mul(line).mul(present).mul(n.uRain).mul(0.42);

  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false, side: DoubleSide, blending: AdditiveBlending });
  const m2 = m as unknown as { colorNode: unknown; opacityNode: unknown };
  m2.colorNode = asNode(vec3(0.8, 0.86, 0.96));
  m2.opacityNode = asNode(alpha);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 1, 3, 2]), 1));
  const mesh = new Mesh(geometry, m);
  mesh.name = 'world.sky.rain-overlay';
  mesh.frustumCulled = false;
  mesh.renderOrder = 998;
  mesh.visible = false;
  return {
    mesh,
    follow(cam) {
      const h = 2 * OVERLAY_DISTANCE_M * Math.tan((cam.fov * Math.PI) / 360);
      mesh.position.copy(cam.position);
      mesh.quaternion.copy(cam.quaternion);
      mesh.translateZ(-OVERLAY_DISTANCE_M);
      mesh.scale.set(h * cam.aspect, h, 1);
    },
    dispose() {
      geometry.dispose();
      m.dispose();
    },
  };
}

