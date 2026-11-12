/**
 * The part ids of the vehicle and prop models of M10d1 (a tool-and-runtime constant, not a contract): every vertex of a model carries
 * one in the custom glTF attribute `_PART`, and the runtime material picks its shading from it (paint, glass, tyre, rim, lamps),
 * so one geometry draws with one material per look profile whatever its parts. Pure; the recipes in `tools/assets` write the ids and
 * `packages/engine/src/client/vehicle` and `packages/world/src/client/traffic` read them.
 */
export const PART = {
  /** Body paint: tinted by the instance colour in the instanced traffic, the vertex colour elsewhere. */
  paint: 0,
  /** Black plastic: bumpers, sills, mirrors, wipers. */
  trim: 1,
  /** Window glass: the only part drawn transparent (on the `full` profile). */
  glass: 2,
  tyre: 3,
  rim: 4,
  /** Head lamps: emissive after dark. */
  lampHead: 5,
  /** Tail and brake lamps: dim after dark, bright under braking. */
  lampBrake: 6,
  sirenRed: 7,
  sirenBlue: 8,
  /** The roof dome of the robotaxi. */
  dome: 9,
  /** A contrasting panel (police doors, a stripe): the paint colour unless the instance carries the livery bit. */
  livery: 10,
  /** Bright metal: bumper strips, the beam of the marker. */
  chrome: 11,
  /** Amber lamps: hazard and indicator corners. */
  amber: 12,
  /** The glow of the objective beam and the pickups. */
  glow: 13,
  /** Rubber, concrete and other matte props: the vertex colour, rough. */
  matte: 14,
} as const;

export type PartName = keyof typeof PART;
export const PART_NAMES = Object.keys(PART) as PartName[];

/** The custom glTF vertex attribute that holds the part id (a float). */
export const PART_ATTRIBUTE = '_PART';

/** Primitive material names of a model: `glass` is drawn as a second, transparent mesh on the `full` profile. */
export type ArtMaterialName = 'paint' | 'glass' | 'detail' | 'lamp' | 'all';

/** The fixed node names the vehicle runtime looks for (C07 1.1 vehicle node contract plus M10d1). */
export const ART_NODE = {
  body: 'body',
  wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const,
  steers: ['steer_fl', 'steer_fr'] as const,
  tyres: ['tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'] as const,
  rims: ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr'] as const,
  lights: ['light_head_l', 'light_head_r', 'light_brake_l', 'light_brake_r'] as const,
  sirens: 'sirens',
  glass: 'glass',
  collider: 'collider_hull',
} as const;

/** Parts that glow by themselves (the material adds their colour as emission). */
export const EMISSIVE_PARTS: readonly number[] = [PART.lampHead, PART.lampBrake, PART.sirenRed, PART.sirenBlue, PART.dome, PART.amber, PART.glow];
