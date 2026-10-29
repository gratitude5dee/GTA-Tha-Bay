/**
 * The road vehicles of M10d1 (`vehicle/traffic.*`, `vehicle/robotaxi.default`, `vehicle/police.*`, `vehicle/transit.*`): the data of
 * each (proportions, paint, make) and the builders of the ones that are not a plain car (box truck, bus, cable car). All fictional:
 * the makes are invented and the shapes are lofted from the numbers below, not from any real model (V-SIL).
 */
import { ART_NODE, PART } from '../../../../packages/shared/src/assets/art-parts.ts';
import { bodyAt } from '../lod.ts';
import { addBoxy, solid, type BoxyCell } from './boxy.ts';
import { addBox, lin, Mesh, MeshSet, style, type V3 } from './mesh.ts';
import type { Fidelity, ModelDoc, ModelNode } from './model.ts';
import { buildCar, carBody, colliderHull, splitGlass, type CarSpec } from './vehicle.ts';
import { buildRim, buildTyre } from './wheel.ts';

/** Body triangle targets per fidelity (the budget row minus the wheels, lamps and details, with room to spare). */
export const BODY_TARGET: Readonly<Record<'traffic' | 'police', Readonly<Record<'mid' | 'lo', number>>>> = {
  traffic: { mid: 1450, lo: 280 },
  police: { mid: 1750, lo: 450 },
};

const reduce = (set: MeshSet, f: Fidelity, cls: 'traffic' | 'police'): MeshSet => bodyAt(set, f, BODY_TARGET[cls]);

export const SPECS = {
  compact: {
    ref: 'vehicle/traffic.compact', fictionalMake: 'Marlowe Pip', length: 3.7, width: 1.7, wheelbase: 2.5, track: 1.46, wheelR: 0.29, tyreW: 0.19,
    frontTip: 1.25 + 0.75, sill: 0.2, beltY: 0.88, hoodY: 0.76, deckY: 0.86, roofY: 1.47, wsBase: 0.62, roofFront: 0.0, roofRear: -1.2, rwBase: -1.6,
    roofShare: 0.78, paint: 0xf2c230, endLen: 0.5,
  },
  sedan: {
    ref: 'vehicle/traffic.sedan', fictionalMake: 'Tessaly Vane', length: 4.7, width: 1.85, wheelbase: 2.75, track: 1.55, wheelR: 0.32, tyreW: 0.22,
    frontTip: 1.375 + 0.92, sill: 0.2, beltY: 0.95, hoodY: 0.8, deckY: 0.9, roofY: 1.5, wsBase: 0.78, roofFront: 0.05, roofRear: -0.95, rwBase: -1.55,
    roofShare: 0.76, paint: 0x3a7bd5, liveryDoors: true, livery: 0xf4f4f4,
  },
  rideshare: {
    ref: 'vehicle/traffic.rideshare', fictionalMake: 'Ferrin Wren', length: 4.6, width: 1.85, wheelbase: 2.7, track: 1.56, wheelR: 0.32, tyreW: 0.22,
    frontTip: 1.35 + 0.9, sill: 0.2, beltY: 0.95, hoodY: 0.8, deckY: 0.9, roofY: 1.52, wsBase: 0.78, roofFront: 0.05, roofRear: -0.95, rwBase: -1.5,
    roofShare: 0.76, paint: 0x1fb5a0, liveryDoors: true, livery: 0xf4f4f4, roof: 'sign',
  },
  robotaxi: {
    ref: 'vehicle/robotaxi.default', fictionalMake: 'Halcyon Mobility', length: 4.8, width: 1.95, wheelbase: 2.9, track: 1.62, wheelR: 0.36, tyreW: 0.23,
    frontTip: 1.45 + 0.95, sill: 0.24, beltY: 0.98, hoodY: 0.78, deckY: 0.95, roofY: 1.56, wsBase: 0.85, roofFront: 0.2, roofRear: -0.95, rwBase: -1.5,
    roofShare: 0.74, paint: 0xf4f6f8, liveryDoors: true, livery: 0x1f2a36, roof: 'dome', rim: 0x30343a,
  },
  cruiser: {
    ref: 'vehicle/police.cruiser', fictionalMake: 'Northgate Patrol', length: 5.0, width: 1.9, wheelbase: 2.9, track: 1.62, wheelR: 0.34, tyreW: 0.23,
    frontTip: 1.45 + 1.0, sill: 0.2, beltY: 0.97, hoodY: 0.82, deckY: 0.93, roofY: 1.5, wsBase: 0.8, roofFront: 0.05, roofRear: -0.95, rwBase: -1.55,
    roofShare: 0.76, paint: 0x16181c, liveryDoors: true, livery: 0xf4f4f4, roof: 'lightbar',
  },
  suv: {
    ref: 'vehicle/police.suv', fictionalMake: 'Northgate Warden', length: 4.9, width: 2.0, wheelbase: 3.0, track: 1.7, wheelR: 0.36, tyreW: 0.25,
    frontTip: 1.5 + 0.95, sill: 0.28, beltY: 1.08, hoodY: 0.95, deckY: 1.08, roofY: 1.82, wsBase: 0.85, roofFront: 0.3, roofRear: -1.75, rwBase: -2.15,
    roofShare: 0.8, paint: 0x1b1f24, liveryDoors: true, livery: 0xf4f4f4, roof: 'lightbar',
  },
  van: {
    ref: 'vehicle/traffic.van', fictionalMake: 'Boreal Freight', length: 5.4, width: 2.0, wheelbase: 3.3, track: 1.8, wheelR: 0.34, tyreW: 0.24,
    frontTip: 1.65 + 0.85, sill: 0.25, beltY: 1.06, hoodY: 0.98, deckY: 1.04, roofY: 2.1, wsBase: 1.5, roofFront: 1.0, roofRear: -2.5, rwBase: -2.6,
    roofShare: 0.9, paint: 0xf0f0ec, solidRear: true, sideGlass: [[0.7, 1.4]], endLen: 0.6,
  },
  pickup: {
    ref: 'vehicle/traffic.pickup', fictionalMake: 'Harlow Dray', length: 5.3, width: 2.0, wheelbase: 3.2, track: 1.78, wheelR: 0.35, tyreW: 0.25,
    frontTip: 1.6 + 1.0, sill: 0.26, beltY: 1.06, hoodY: 0.92, deckY: 1.0, roofY: 1.72, wsBase: 0.95, roofFront: 0.4, roofRear: -0.3, rwBase: -0.5,
    roofShare: 0.8, paint: 0x4f9a54, bed: { railY: 0.9, cabEnd: -0.55 }, solidRear: false,
  },
} as const satisfies Record<string, CarSpec>;

export type CarKey = keyof typeof SPECS;

const car = (key: CarKey, f: Fidelity, cls: 'traffic' | 'police'): ModelDoc => {
  const spec: CarSpec = SPECS[key];
  return buildCar(spec, f, reduce(carBody(spec, 'hi'), f, cls), { class: cls });
};

export const buildCompact = (f: Fidelity): ModelDoc => car('compact', f, 'traffic');
export const buildSedan = (f: Fidelity): ModelDoc => car('sedan', f, 'traffic');
export const buildRideshare = (f: Fidelity): ModelDoc => car('rideshare', f, 'traffic');
export const buildRobotaxi = (f: Fidelity): ModelDoc => car('robotaxi', f, 'traffic');
export const buildPickup = (f: Fidelity): ModelDoc => car('pickup', f, 'traffic');
export const buildVan = (f: Fidelity): ModelDoc => car('van', f, 'traffic');
export const buildCruiser = (f: Fidelity): ModelDoc => car('cruiser', f, 'police');
export const buildSuv = (f: Fidelity): ModelDoc => car('suv', f, 'police');

// ---- box truck: a cab and a cargo box ---------------------------------------------------------------------------------------

export const TRUCK_SPEC: CarSpec = {
  ref: 'vehicle/traffic.truck', fictionalMake: 'Dunmore Ox', length: 6.5, width: 2.3, wheelbase: 3.8, track: 1.9, wheelR: 0.38, tyreW: 0.27,
  frontTip: 1.9 + 0.95, sill: 0.3, beltY: 1.1, hoodY: 1.0, deckY: 1.1, roofY: 2.05, wsBase: 2.05, roofFront: 1.55, roofRear: 0.75, rwBase: 0.62,
  roofShare: 0.88, paint: 0xe07b24, solidRear: true, sideGlass: [[0.8, 1.6]], endLen: 0.6,
};

export function buildTruck(f: Fidelity): ModelDoc {
  const spec = TRUCK_SPEC;
  const set = carBody(spec, 'hi');
  // the cargo box: a pale rounded box over the chassis, with a roll-up door line and dark corner posts
  const cargo = new MeshSet();
  addBoxy(cargo, { zRear: -3.62, zFront: 0.45, halfWidth: 1.17, y0: 1.18, y1: 3.0, radius: 0.12, window: null, endLen: 0.12, endPull: 0.04, crown: 0.02 },
    (c: BoxyCell) => (c.zone === 'under' ? solid('detail', PART.trim, 0x16181b) : c.zone === 'side' && c.y < 1.5 ? solid('paint', PART.livery, 0x3d4650) : solid('paint', PART.paint, 0xc9c9c4)),
    { front: solid('paint', PART.paint, 0xc9c9c4), rear: solid('paint', PART.paint, 0xc9c9c4) });
  set.append(cargo);
  const body = reduce(set, f, 'traffic');
  const doc = buildCar(spec, f, body, { class: 'traffic' });
  return doc;
}

// ---- transit: bus and cable car ----------------------------------------------------------------------------------------------

interface TransitSpec {
  ref: string;
  fictionalMake: string;
  zFront: number;
  zRear: number;
  halfWidth: number;
  y0: number;
  y1: number;
  window: readonly [number, number];
  paint: number;
  stripe: number;
  wheelR: number;
  tyreW: number;
  track: number;
  axleFront: number;
  axleRear: number;
  radius: number;
}

export const BUS_SPEC: TransitSpec = {
  ref: 'vehicle/transit.bus', fictionalMake: 'Cityline Transit', zFront: 5.8, zRear: -5.8, halfWidth: 1.3, y0: 0.4, y1: 3.1, window: [1.15, 2.65],
  paint: 0x1f7a8c, stripe: 0xe8e1c8, wheelR: 0.5, tyreW: 0.3, track: 2.34, axleFront: 3.9, axleRear: -3.5, radius: 0.35,
};
export const CABLECAR_SPEC: TransitSpec = {
  ref: 'vehicle/transit.cablecar', fictionalMake: 'Hillside Cable Works', zFront: 3.6, zRear: -3.6, halfWidth: 1.2, y0: 0.55, y1: 2.8, window: [1.15, 2.3],
  paint: 0x7a2530, stripe: 0xd9b45a, wheelR: 0.34, tyreW: 0.2, track: 1.95, axleFront: 2.3, axleRear: -2.3, radius: 0.18,
};

function transit(s: TransitSpec, f: Fidelity, target: Readonly<Record<'mid' | 'lo', number>>): ModelDoc {
  const set = new MeshSet();
  const paint = lin(s.paint);
  const stripe = lin(s.stripe);
  addBoxy(set, { zRear: s.zRear, zFront: s.zFront, halfWidth: s.halfWidth, y0: s.y0, y1: s.y1, radius: s.radius, window: s.window, endLen: 0.6, endPull: 0.18, crown: 0.05 },
    (c: BoxyCell) => {
      if (c.zone === 'under') return solid('detail', PART.trim, 0x16181b);
      if (c.inWindow && c.d < 0.5) return solid('glass', PART.glass, 0x1c2630);
      if (c.front && c.d > 0.4 && c.y > s.window[0] && c.y < s.window[1] + 0.2 && c.zone !== 'roof') return solid('glass', PART.glass, 0x1c2630);
      if (c.zone === 'corner-low' || (c.zone === 'side' && c.y < s.window[0])) return { material: 'paint', part: PART.livery, color: stripe };
      if (c.zone === 'roof') return { material: 'paint', part: PART.paint, color: paint };
      return { material: 'paint', part: PART.paint, color: paint };
    },
    { front: { material: 'paint', part: PART.paint, color: paint }, rear: { material: 'paint', part: PART.paint, color: paint } });
  // lamps and roof gear
  const detail = set.get('detail');
  addBox(detail, [0, s.y1 + 0.1, 0.2], [s.halfWidth * 0.8, 0.14, 1.4], lin(0x2b3138), PART.trim);
  const body = bodyAt(set, f, target);
  const { rest, glass } = splitGlass(body.list());
  const bodyNode: ModelNode = { name: ART_NODE.body, meshes: rest, children: [{ name: ART_NODE.glass, meshes: glass }] };
  const lamp = (name: string, c: V3, size: V3, color: number, part: number): ModelNode => {
    const m = new Mesh('lamp');
    addBox(m, [0, 0, 0], size, lin(color), part);
    return { name, translation: c, meshes: [m] };
  };
  const hx = s.halfWidth * 0.7;
  bodyNode.children = [
    ...(bodyNode.children ?? []),
    lamp('light_head_l', [hx, s.y0 + 0.55, s.zFront - 0.05], [0.4, 0.14, 0.1], 0xfff3c4, PART.lampHead),
    lamp('light_head_r', [-hx, s.y0 + 0.55, s.zFront - 0.05], [0.4, 0.14, 0.1], 0xfff3c4, PART.lampHead),
    lamp('light_brake_l', [hx, s.y0 + 0.6, s.zRear + 0.05], [0.36, 0.14, 0.1], 0xc0161a, PART.lampBrake),
    lamp('light_brake_r', [-hx, s.y0 + 0.6, s.zRear + 0.05], [0.36, 0.14, 0.1], 0xc0161a, PART.lampBrake),
  ];
  const roots: ModelNode[] = [bodyNode];
  ART_NODE.wheels.forEach((wn, k) => {
    const left = k % 2 === 0;
    const front = k < 2;
    const side: 1 | -1 = left ? 1 : -1;
    const wheel: ModelNode = {
      name: wn,
      children: [
        { name: ART_NODE.tyres[k] as string, meshes: [buildTyre({ radius: s.wheelR, width: s.tyreW, side }, f)] },
        { name: ART_NODE.rims[k] as string, meshes: [buildRim({ radius: s.wheelR, width: s.tyreW, side }, f)] },
      ],
    };
    const pos: V3 = [side * (s.track / 2), s.wheelR, front ? s.axleFront : s.axleRear];
    if (front) roots.push({ name: ART_NODE.steers[left ? 0 : 1] as string, translation: pos, children: [wheel] });
    else {
      wheel.translation = pos;
      roots.push(wheel);
    }
  });
  const hull = new Mesh('collider');
  const n: V3 = [0, 1, 0];
  const hw = s.halfWidth;
  const rings = [[s.y0, hw * 0.9], [s.y1, hw * 0.9]] as const;
  const ids = rings.map(([y, w]) => [
    hull.vertex([w, y, s.zFront - 0.1], n, [0.5, 0.5, 0.5], 0), hull.vertex([-w, y, s.zFront - 0.1], n, [0.5, 0.5, 0.5], 0),
    hull.vertex([-w, y, s.zRear + 0.1], n, [0.5, 0.5, 0.5], 0), hull.vertex([w, y, s.zRear + 0.1], n, [0.5, 0.5, 0.5], 0),
  ]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    hull.quad((ids[0] as number[])[i] as number, (ids[0] as number[])[j] as number, (ids[1] as number[])[j] as number, (ids[1] as number[])[i] as number);
  }
  roots.push({ name: ART_NODE.collider, meshes: [hull] });
  return {
    ref: s.ref,
    fidelity: f,
    extras: { fictionalMake: s.fictionalMake, wheelRadiusM: s.wheelR, class: 'traffic' },
    roots,
  };
}

export const buildBus = (f: Fidelity): ModelDoc => transit(BUS_SPEC, f, { mid: 1500, lo: 340 });
export const buildCablecar = (f: Fidelity): ModelDoc => transit(CABLECAR_SPEC, f, { mid: 1300, lo: 300 });

void style;
void colliderHull;
