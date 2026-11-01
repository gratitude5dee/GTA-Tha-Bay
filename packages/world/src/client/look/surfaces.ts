/**
 * The surface table (M02e): the id every mesh vertex carries in `surf.x`, so one material per object kind can tell asphalt from
 * paving, a Commercial wall from a roof, and so on. Pure data, no `three` import (the mesher runs in asset.worker).
 *
 * `surf` is a `Uint8x4` attribute per vertex: surface id, palette index, kind/roof code, flags (the fourth byte is a bit set:
 * bit 0 parapet band on a wall). `facade` is an `Int16x4` per building vertex: metres x 10 along the wall from its start (stretched
 * to a whole number of bays), height above the base, wall height, `seed & 0x7fff`. Both are uploaded normalised (unorm8 / snorm16),
 * so a shader reads them as `value x 255` and `value x 32767`.
 */

/** `GroundClass` (C08) names in id order 0..11. */
export const GROUND_NAMES = ['Grass', 'Park', 'Sand', 'Paved', 'Dirt', 'Rock', 'Asphalt', 'Sidewalk', 'Pier', 'WaterShallow', 'Water', 'Rail'] as const;
/** `RoadClass` (C08) names in id order 0..5. */
export const ROAD_NAMES = ['freeway', 'ramp', 'arterial', 'collector', 'local', 'service'] as const;
/** `BuildingKind` (C08) names in id order 0..5. */
export const KIND_NAMES = ['ResLow', 'ResMid', 'Commercial', 'Tower', 'Industrial', 'Civic'] as const;

export const enum Surf {
  /** 0..11: the terrain's ground class. */
  GroundBase = 0,
  /** 12..17: a road ribbon of road class 0..5. */
  RoadBase = 12,
  Sidewalk = 18,
  /** 19..24: a wall of building kind 0..5. */
  WallBase = 19,
  RoofFlat = 25,
  RoofGable = 26,
  RoofHip = 27,
  Parapet = 28,
  Equipment = 29,
  Trunk = 30,
  Leaves = 31,
  MassingL1 = 32,
  MassingL2 = 33,
  Sea = 34,
  /** M02h1: the plain patch where the ribbons of a junction of three or more roads end. */
  Junction = 35,
  /** M02h1: a crosswalk quad (ladder or two transverse lines, painted in the shader). */
  Crosswalk = 36,
  /** M02h1: a stop bar quad. */
  StopBar = 37,
  /** M02h2: the curb face and its top band (concrete). */
  Curb = 38,
  /** M02h2: the gutter strip at the outer edge of a curbed road ribbon. */
  Gutter = 39,
  /** M02h2: a `Paved` terrain post away from a plaza: a lot (worn concrete). */
  Lot = 40,
  /** M02h2: a `Paved` terrain post within `lotPlaza.plazaM` of a plaza ped edge or node: pavers. */
  Plaza = 41,
  /** M02h3: 42..48, a terrain post with ground cover: `CoverYard - 1 + CoverClass` (yard, dirt, mixed, driveway, vacant, scrub, park). */
  CoverYard = 42,
  CoverDirt = 43,
  CoverMixed = 44,
  CoverDriveway = 45,
  CoverVacant = 46,
  CoverScrub = 47,
  CoverPark = 48,
}

/** M02h3: the `CoverClass` (C08 1.1) names 1..7 in id order. */
export const COVER_SURFACE_NAMES = ['yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park'] as const;

/** One past the largest id. */
export const SURFACE_COUNT = 49;

export const SURFACE_NAMES: readonly string[] = [
  ...GROUND_NAMES.map((n) => `ground.${n}`),
  ...ROAD_NAMES.map((n) => `road.${n}`),
  'sidewalk',
  ...KIND_NAMES.map((n) => `wall.${n}`),
  'roof.flat', 'roof.gable', 'roof.hip', 'parapet', 'equipment', 'trunk', 'leaves', 'massing.l1', 'massing.l2', 'sea',
  'junction', 'crosswalk', 'stopbar', 'curb', 'gutter', 'lot', 'plaza',
  ...COVER_SURFACE_NAMES.map((n) => `cover.${n}`),
];

export const isSurfaceId = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < SURFACE_COUNT;

export const groundSurf = (cls: number): number => (cls >= 0 && cls < GROUND_NAMES.length ? Surf.GroundBase + cls : Surf.GroundBase + 3);
/** M02h3: the surface id of a post with cover class `c` (1..7). */
export const coverSurf = (c: number): number => Surf.CoverYard - 1 + Math.max(1, Math.min(COVER_SURFACE_NAMES.length, c));
export const roadSurf = (cls: number): number => Surf.RoadBase + Math.max(0, Math.min(ROAD_NAMES.length - 1, cls));
export const wallSurf = (kind: number): number => Surf.WallBase + Math.max(0, Math.min(KIND_NAMES.length - 1, kind));
export const roofSurf = (roof: number): number => (roof === 1 ? Surf.RoofGable : roof === 2 ? Surf.RoofHip : Surf.RoofFlat);

/** Bit 0 of `surf.w` on a wall vertex: the parapet band. */
export const FLAG_PARAPET = 1;

/** Normalisation of the two attributes: the shader multiplies the unorm8 / snorm16 read by these. */
export const SURF_SCALE = 255;
export const FACADE_SCALE = 32767;
/** Largest value `facade` can hold, in decimetres. */
export const FACADE_MAX_DM = 32767;

/** Decimetres clamped into the snorm16 range. */
export const facadeDm = (metres: number): number => Math.max(0, Math.min(FACADE_MAX_DM, Math.round(metres * 10)));
/** Decimetres, signed: the part of a wall below the nominal foot (a foundation that follows a falling street, M02g2) has a negative `v`. */
export const facadeSignedDm = (metres: number): number => Math.max(-FACADE_MAX_DM, Math.min(FACADE_MAX_DM, Math.round(metres * 10)));
