/**
 * The gray-box look of vehicles, props and pickups (M03a1): procedural placeholders `vehicle/graybox.<archetype>` and
 * `prop/graybox.<name>` (no file ships; the M01b1 precedent). A vehicle is a body and a cabin, four wheels with a spoke so that
 * the spin shows, and head and tail lights, named after the C07 vehicle anchors so `anchors.ts` finds them. The sim publishes a
 * vehicle's forward speed and steer input in the snapshot record (`animP0`, `animP1`); the view spins the wheels and turns the
 * front pivots with them.
 *
 * Materials are TSL node materials (no GLSL). Geometry and materials are cached and shared by every vehicle of a view.
 */
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial, SphereGeometry, type BufferGeometry, type Object3D,
} from 'three/webgpu';
import { handlingById } from '../../sim/vehicle/presets.ts';
import { resolveAnchors, type VehicleAnchors } from './anchors.ts';

/** A drawn thing the pool keeps per entity and advances each frame. */
export interface DrawnThing {
  root: Object3D;
  /** `speed`: signed forward speed, m/s; `steer`: the steer input, -1 (left) .. 1 (right). */
  update(dtSec: number, speed: number, steer: number): void;
  anchors?: VehicleAnchors;
}

interface Archetype {
  /** Handling preset that gives the wheel size, the track, the wheelbase and the height of the centre of gravity. */
  hp: string;
  length: number;
  width: number;
  bodyH: number;
  cabinLength: number;
  cabinH: number;
  /** Cabin centre along the body, + toward the rear. */
  cabinZ: number;
  color: number;
  cabinColor?: number;
  stripe?: number;
  roof?: 'lightbar' | 'dome' | 'sign';
  cargo?: { length: number; height: number; z: number; color: number };
}

export const ARCHETYPES: Readonly<Record<string, Archetype>> = {
  compact: { hp: 'hp.compact', length: 3.7, width: 1.7, bodyH: 0.62, cabinLength: 2.0, cabinH: 0.55, cabinZ: 0.1, color: 0xf2c230 },
  sedan: { hp: 'hp.sedan', length: 4.7, width: 1.85, bodyH: 0.64, cabinLength: 2.5, cabinH: 0.56, cabinZ: 0.2, color: 0x3a7bd5 },
  rideshare: { hp: 'hp.rideshare', length: 4.6, width: 1.85, bodyH: 0.64, cabinLength: 2.6, cabinH: 0.58, cabinZ: 0.2, color: 0x1fb5a0, roof: 'sign' },
  van: { hp: 'hp.van', length: 5.4, width: 2.0, bodyH: 1.2, cabinLength: 3.6, cabinH: 0.6, cabinZ: 0.5, color: 0xf0f0ec },
  truck: { hp: 'hp.truck', length: 6.5, width: 2.3, bodyH: 0.95, cabinLength: 1.9, cabinH: 0.75, cabinZ: -1.9, color: 0xe07b24, cargo: { length: 3.9, height: 1.5, z: 1.0, color: 0xc9c9c4 } },
  pickup: { hp: 'hp.pickup', length: 5.3, width: 2.0, bodyH: 0.78, cabinLength: 2.1, cabinH: 0.62, cabinZ: -0.4, color: 0x4f9a54 },
  cruiser: { hp: 'hp.police-cruiser', length: 5.0, width: 1.9, bodyH: 0.64, cabinLength: 2.7, cabinH: 0.56, cabinZ: 0.2, color: 0x16181c, stripe: 0xf4f4f4, roof: 'lightbar' },
  suv: { hp: 'hp.police-suv', length: 4.9, width: 2.0, bodyH: 0.86, cabinLength: 3.2, cabinH: 0.66, cabinZ: 0.3, color: 0x1b1f24, stripe: 0xf4f4f4, roof: 'lightbar' },
  robotaxi: { hp: 'hp.robotaxi-ambient', length: 4.8, width: 1.95, bodyH: 0.66, cabinLength: 2.8, cabinH: 0.6, cabinZ: 0.15, color: 0xf4f6f8, roof: 'dome' },
};

const WHEEL_COLOR = 0x15171a;
const SPOKE_COLOR = 0xb9bec6;
const GLASS_COLOR = 0x23303c;
const CLEARANCE = 0.3;

/** Geometry and material caches. One per view; `dispose` frees both. */
export class GrayboxAssets {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<string, MeshStandardNodeMaterial>();

  box(w: number, h: number, d: number): BufferGeometry {
    return this.geo(`b${w}x${h}x${d}`, () => new BoxGeometry(w, h, d));
  }

  material(color: number, emissive = 0, roughness = 0.7): MeshStandardNodeMaterial {
    const key = `${color}.${emissive}.${roughness}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshStandardNodeMaterial({ color, roughness, metalness: 0.08 });
      if (emissive) {
        m.emissive.setHex(emissive);
        m.emissiveIntensity = 1.4;
      }
      this.materials.set(key, m);
    }
    return m;
  }

  private geo(key: string, make: () => BufferGeometry): BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = make();
      this.geometries.set(key, g);
    }
    return g;
  }

  cylinder(r: number, len: number): BufferGeometry {
    return this.geo(`c${r}x${len}`, () => {
      const g = new CylinderGeometry(r, r, len, 18);
      g.rotateZ(Math.PI / 2);
      return g;
    });
  }

  cone(r: number, h: number): BufferGeometry {
    return this.geo(`k${r}x${h}`, () => new ConeGeometry(r, h, 14));
  }

  sphere(r: number): BufferGeometry {
    return this.geo(`s${r}`, () => new SphereGeometry(r, 16, 12));
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

function named<T extends Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

function mesh(a: GrayboxAssets, g: BufferGeometry, color: number, x: number, y: number, z: number, emissive = 0): Mesh {
  const m = new Mesh(g, a.material(color, emissive));
  m.position.set(x, y, z);
  return m;
}

/** A gray-box vehicle for `archetype`: forward is -Z, the origin is the centre of gravity (the sim's body position). */
export function buildGrayboxVehicle(a: GrayboxAssets, archetype: string): DrawnThing {
  const arch = ARCHETYPES[archetype] ?? (ARCHETYPES['sedan'] as Archetype);
  const p = handlingById(arch.hp);
  const cg = p.cgHeightM;
  const r = p.drive.wheelRadiusM;
  const root = new Group();
  root.name = `vehicle.${archetype}`;
  const body = named(new Group(), 'body');
  root.add(body);

  const bodyY = -cg + CLEARANCE + arch.bodyH / 2;
  body.add(mesh(a, a.box(arch.width, arch.bodyH, arch.length), arch.color, 0, bodyY, 0));
  if (arch.stripe) {
    // police livery: white door panels
    const door = mesh(a, a.box(arch.width + 0.02, arch.bodyH * 0.55, arch.length * 0.34), arch.stripe, 0, bodyY, arch.length * 0.04);
    body.add(door);
  }
  const cabY = -cg + CLEARANCE + arch.bodyH + arch.cabinH / 2;
  body.add(mesh(a, a.box(arch.width * 0.9, arch.cabinH, arch.cabinLength), GLASS_COLOR, 0, cabY, arch.cabinZ));
  body.add(mesh(a, a.box(arch.width * 0.94, 0.06, arch.cabinLength * 0.92), arch.cabinColor ?? arch.color, 0, cabY + arch.cabinH / 2, arch.cabinZ));
  if (arch.cargo) {
    const c = arch.cargo;
    body.add(mesh(a, a.box(arch.width * 0.98, c.height, c.length), c.color, 0, -cg + CLEARANCE + arch.bodyH + c.height / 2, c.z));
  }
  const roofY = cabY + arch.cabinH / 2 + 0.06;
  if (arch.roof === 'lightbar') {
    body.add(mesh(a, a.box(0.5, 0.12, 0.3), 0xe02c2c, -0.3, roofY + 0.06, arch.cabinZ, 0xe02c2c));
    body.add(mesh(a, a.box(0.5, 0.12, 0.3), 0x2c5be0, 0.3, roofY + 0.06, arch.cabinZ, 0x2c5be0));
  } else if (arch.roof === 'dome') {
    body.add(mesh(a, a.sphere(0.22), 0x111418, 0, roofY + 0.16, arch.cabinZ - 0.1));
  } else if (arch.roof === 'sign') {
    body.add(mesh(a, a.box(0.5, 0.14, 0.2), 0xffffff, 0, roofY + 0.07, arch.cabinZ, 0x6cf0d8));
  }
  // lights, named after the C07 contract
  const lx = arch.width / 2 - 0.25;
  const front = -arch.length / 2;
  const rear = arch.length / 2;
  const ly = bodyY + arch.bodyH * 0.15;
  body.add(named(mesh(a, a.box(0.34, 0.14, 0.06), 0xfff3c4, -lx, ly, front, 0xfff3c4), 'light_head_l'));
  body.add(named(mesh(a, a.box(0.34, 0.14, 0.06), 0xfff3c4, lx, ly, front, 0xfff3c4), 'light_head_r'));
  body.add(named(mesh(a, a.box(0.34, 0.12, 0.06), 0xb01818, -lx, ly, rear, 0x8a0f0f), 'light_brake_l'));
  body.add(named(mesh(a, a.box(0.34, 0.12, 0.06), 0xb01818, lx, ly, rear, 0x8a0f0f), 'light_brake_r'));

  // wheels at the hubs: the hub is r above the ground, i.e. (r - cg) below the centre of gravity at rest
  const frontZ = -p.wheelbaseM * (1 - p.frontWeightPct / 100);
  const rearZ = p.wheelbaseM * (p.frontWeightPct / 100);
  const half = p.trackM / 2;
  const hubY = r - cg;
  const wheelNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
  const spin: Group[] = [];
  const steer: Group[] = [];
  wheelNames.forEach((name, k) => {
    const left = k % 2 === 0;
    const isFront = k < 2;
    const wheel = named(new Group(), name);
    wheel.add(new Mesh(a.cylinder(r, 0.26), a.material(WHEEL_COLOR, 0, 0.9)));
    wheel.add(mesh(a, a.box(0.28, r * 1.5, 0.07), SPOKE_COLOR, 0, 0, 0));
    spin.push(wheel);
    if (isFront) {
      const pivot = named(new Group(), left ? 'steer_fl' : 'steer_fr');
      pivot.position.set(left ? -half : half, hubY, frontZ);
      pivot.add(wheel);
      root.add(pivot);
      steer.push(pivot);
    } else {
      wheel.position.set(left ? -half : half, hubY, rearZ);
      root.add(wheel);
    }
  });

  const anchors = resolveAnchors(root);
  let angle = 0;
  return {
    root,
    anchors,
    update(dt, speed, steerInput) {
      angle -= (speed / r) * dt;
      for (const w of spin) w.rotation.x = angle;
      const delta = -steerInput * Math.min(0.5, p.steer.lockDeg * 0.0174533);
      for (const s of steer) s.rotation.y = delta;
    },
  };
}

/** The police helicopter: a body, a tail and a rotor that turns. */
function buildHeli(a: GrayboxAssets): DrawnThing {
  const root = new Group();
  root.add(mesh(a, a.box(1.8, 1.7, 4.4), 0x1b1f24, 0, 0, 0));
  root.add(mesh(a, a.box(0.3, 0.3, 3.6), 0x1b1f24, 0, 0.3, 3.6));
  const rotor = new Group();
  rotor.position.y = 1.1;
  rotor.add(mesh(a, a.box(9, 0.05, 0.3), 0x888d94, 0, 0, 0));
  rotor.add(mesh(a, a.box(0.3, 0.05, 9), 0x888d94, 0, 0, 0));
  root.add(rotor);
  root.add(mesh(a, a.box(0.4, 0.2, 0.4), 0xe02c2c, 0, -0.9, -2.0, 0xe02c2c));
  return { root, update: (dt) => { rotor.rotation.y += dt * 18; } };
}

/** A prop or pickup placeholder, sized like its physics shape. */
function buildProp(a: GrayboxAssets, name: string): DrawnThing {
  const root = new Group();
  let spinY = 0;
  let bob = false;
  switch (name) {
    case 'cone':
      root.add(mesh(a, a.cone(0.18, 0.7), 0xf26a1b, 0, 0, 0));
      root.add(mesh(a, a.box(0.42, 0.04, 0.42), 0x333333, 0, -0.34, 0));
      break;
    case 'barrier':
      root.add(mesh(a, a.box(2.4, 1.0, 0.4), 0xf0f0ec, 0, 0, 0));
      root.add(mesh(a, a.box(2.42, 0.3, 0.42), 0xe8532b, 0, 0.18, 0));
      break;
    case 'spikestrip':
      root.add(mesh(a, a.box(4, 0.08, 0.5), 0x2b2f35, 0, 0, 0));
      for (let i = -7; i <= 7; i++) root.add(mesh(a, a.cone(0.04, 0.12), 0xb9bec6, i * 0.26, 0.09, 0));
      break;
    case 'crate':
      root.add(mesh(a, a.box(1, 1, 1), 0x9a6b3a, 0, 0, 0));
      root.add(mesh(a, a.box(1.02, 0.12, 1.02), 0x6e4a26, 0, 0.3, 0));
      root.add(mesh(a, a.box(1.02, 0.12, 1.02), 0x6e4a26, 0, -0.3, 0));
      break;
    case 'beam':
      // the objective marker of a mission (M05a1): a tall thin column standing on the zone centre
      root.add(mesh(a, a.box(0.5, 30, 0.5), 0xf2c230, 0, 15, 0, 0x7a5e08));
      break;
    case 'pickup-cash':
      root.add(mesh(a, a.box(0.5, 0.12, 0.3), 0x55c26b, 0, 0, 0, 0x1d6b2e));
      spinY = 2;
      bob = true;
      break;
    case 'pickup-item':
      root.add(mesh(a, a.sphere(0.28), 0xf2c230, 0, 0, 0, 0x7a5e08));
      spinY = 2;
      bob = true;
      break;
    default:
      root.add(mesh(a, a.box(1, 1, 1), 0x9aa0a6, 0, 0, 0));
  }
  let t = 0;
  return {
    root,
    update(dt) {
      t += dt;
      if (spinY) root.rotation.y += dt * spinY;
      if (bob) root.children.forEach((c) => { c.position.y = Math.sin(t * 2.4) * 0.12; });
    },
  };
}

/** True for the asset keys this module draws: `vehicle/graybox.*` and every `prop/graybox.*` except the player's capsule. */
export function isGrayboxThing(key: string): boolean {
  return /^vehicle\/graybox\.[a-z-]+$/.test(key) || (/^prop\/graybox\.[a-z-]+$/.test(key) && key !== 'prop/graybox.capsule');
}

export function buildGrayboxThing(a: GrayboxAssets, key: string): DrawnThing | null {
  const m = /^(vehicle|prop)\/graybox\.([a-z-]+)$/.exec(key);
  if (!m) return null;
  const name = m[2] as string;
  if (m[1] === 'vehicle') return name === 'heli' ? buildHeli(a) : buildGrayboxVehicle(a, name);
  return buildProp(a, name);
}
