/**
 * The lane layout of a road segment and the `road` vertex attribute (M02h1, street markings). Pure: no `three`, no DOM, no random,
 * so the mesher (asset.worker), the unit tests and the TS reference of the shader rules (`markingAt`) all read the same numbers.
 *
 * A segment is drawn as one ribbon of width `seg.widthM` along its centreline. Across that width, from the `+` side (the left of
 * travel along the segment's point order, `dir 1`) to the `-` side, the layout is:
 *
 *     [parking] [lanes of dir -1] [median] [lanes of dir 1] [parking]            two-way
 *     [parking] [lanes]                                       [parking]            one-way
 *
 * Traffic keeps right, so `dir 1` uses the `-` half. With one parking lane it lies on the `-` side and the carriageway shifts towards
 * the other (the segment centreline stays the centre of the ribbon). `packRoad` rescales the lane width so that the strips add up to
 * `seg.widthM` (the bake's width includes the parking lanes and the median).
 *
 * The `road` attribute is an `Int16x4` per road vertex, uploaded normalised (`value / 32767`, like `facade`):
 *  - `x` decimetres along the segment from its first point, wrapped at `ROAD_WRAP_M` (a multiple of every period of the paint);
 *  - `y` centimetres across, `+` on the left of `dir 1`;
 *  - `z` the lane width in 0.05 m steps plus 1024 x the median in 0.5 m steps;
 *  - `w` bits 0-2 lanes each way, 3-4 parking sides, 5 OneWay, 6 Divided, 7 BusLane, 8 NoParking, 9-11 `markClass`.
 * Crosswalk quads store the metres along the crossing in `x` (dm), the metres across in `y` (cm) and in `z` the crossing length in
 * dm x 2 plus 1 for the ladder; the junction patch and the stop bars store zeros.
 */
import { EdgeFlag, type RoadEdge, type RoadSegment } from '@dv/shared';

/** The attribute is normalised: the shader multiplies the read by this. */
export const ROAD_SCALE = 32767;
/** `x` wraps here (metres). 2,880 = 12 x 240, so the 12 m dash period, the 6 m T period and every divisor of them continue across the wrap. */
export const ROAD_WRAP_M = 2880;
/** Largest `x` in decimetres: the wrap plus the length of one quad must stay under it. */
export const ROAD_X_MAX_DM = 32767;
export const LANE_STEP_M = 0.05;
export const MEDIAN_STEP_M = 0.5;
const LANE_FIELD = 1024;

/** Bit positions of `w`. */
export const RoadBits = {
  Lanes: 0, // 3 bits
  Parking: 3, // 2 bits
  OneWay: 5,
  Divided: 6,
  BusLane: 7,
  NoParking: 8,
  Class: 9, // 3 bits
} as const;

/** The paint rules of one `markClass` (config/world/look.json `markings.rules`). */
export interface MarkRule {
  /** A white edge line where the carriageway meets the parking lane or the curb. */
  edges: boolean;
  /** White dashed lines between lanes of one direction. */
  dashes: boolean;
  /** The yellow centre line of a two-way road: never, always when two-way, or only when `widthM` reaches `centreWideMinM`. */
  centre: 'never' | 'twoWay' | 'twoWayWide';
  /** Parking Ts where the road has a parking lane. */
  ts: boolean;
}

/** The slice of `look.json` `markings` the layout reads. */
export interface LayoutConfig {
  classes: readonly string[];
  byClass: Readonly<Record<string, string>>;
  rules: Readonly<Record<string, MarkRule>>;
  parkingM: number;
  centreWideMinM: number;
  lineM: number;
  dashOnM: number;
  dashOffM: number;
  doubleGapM: number;
  edgeInsetM: number;
  tEveryM: number;
  tStemM: number;
  tBarM: number;
}

export const ROAD_CLASS_NAMES = ['freeway', 'ramp', 'arterial', 'collector', 'local', 'service'] as const;

export interface RoadLayout {
  widthM: number;
  /** Lanes in each direction (1..7). */
  lanes: number;
  /** Lane width after the rescale, metres (not quantised). */
  laneM: number;
  /** Median between the two carriageways, metres (0 when none). */
  medianM: number;
  /** 0, 1 or 2 parking lanes; 1 is on the right of `dir 1` (the `-` side). */
  parking: 0 | 1 | 2;
  oneWay: boolean;
  divided: boolean;
  busLane: boolean;
  noParking: boolean;
  /** Index into `classes` (0 = nothing is painted). */
  markClass: number;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * The layout of a segment from its width and its edges (one for a one-way street, two otherwise; their fields agree, the larger lane
 * count and median and the union of the flags win). `cfg` says which class paints what.
 */
export function packRoad(
  seg: Pick<RoadSegment, 'widthM'>,
  edges: readonly Pick<RoadEdge, 'cls' | 'lanes' | 'medianM' | 'parkingSides' | 'flags'>[],
  cfg: LayoutConfig,
): RoadLayout {
  const first = edges[0];
  const cls = first?.cls ?? 4;
  let flags = 0;
  let lanes = 1;
  let median = 0;
  let parking = 0;
  for (const e of edges) {
    flags |= e.flags;
    lanes = Math.max(lanes, e.lanes);
    median = Math.max(median, e.medianM);
    parking = Math.max(parking, e.parkingSides);
  }
  const oneWay = (flags & EdgeFlag.OneWay) !== 0 || edges.length < 2;
  lanes = clampInt(lanes, 1, 7);
  const width = Math.max(0.5, seg.widthM);
  const total = (): number => lanes * (oneWay ? 1 : 2);
  const rest = (): number => width - median - parking * cfg.parkingM;
  // Not enough road for the strips: parking goes first, then the median, then the extra lanes.
  while (rest() / total() < 2.2 && parking > 0) parking--;
  while (rest() / total() < 2.2 && median > 0) median = 0;
  while (rest() / total() < 2.2 && lanes > 1) lanes--;
  const laneM = rest() / total();
  const className = ROAD_CLASS_NAMES[clampInt(cls, 0, 5)] as string;
  const rule = cfg.byClass[className] ?? 'none';
  const markClass = Math.max(0, cfg.classes.indexOf(rule));
  return {
    widthM: width,
    lanes,
    laneM,
    medianM: median,
    parking: parking as 0 | 1 | 2,
    oneWay,
    divided: (flags & EdgeFlag.Divided) !== 0 && median > 0,
    busLane: (flags & EdgeFlag.BusLane) !== 0,
    noParking: (flags & EdgeFlag.NoParking) !== 0,
    markClass,
  };
}

/** The sum of the strips of a layout: equals `widthM` (`packRoad` shrinks the strips first when the road is too narrow for them). */
export function layoutSumM(l: RoadLayout, cfg: Pick<LayoutConfig, 'parkingM'>): number {
  return l.medianM + l.lanes * (l.oneWay ? 1 : 2) * l.laneM + l.parking * cfg.parkingM;
}

// ---- the attribute -----------------------------------------------------------------------------------------------------------

/** The `z` and `w` fields of a layout (the same for every vertex of a segment). */
export interface RoadFields {
  z: number;
  w: number;
}

export function roadFields(l: RoadLayout): RoadFields {
  const laneSteps = clampInt(l.laneM / LANE_STEP_M, 0, LANE_FIELD - 1);
  const medSteps = clampInt(l.medianM / MEDIAN_STEP_M, 0, 31);
  const w =
    (clampInt(l.lanes, 0, 7) << RoadBits.Lanes) |
    (l.parking << RoadBits.Parking) |
    ((l.oneWay ? 1 : 0) << RoadBits.OneWay) |
    ((l.divided ? 1 : 0) << RoadBits.Divided) |
    ((l.busLane ? 1 : 0) << RoadBits.BusLane) |
    ((l.noParking ? 1 : 0) << RoadBits.NoParking) |
    (clampInt(l.markClass, 0, 7) << RoadBits.Class);
  return { z: laneSteps + LANE_FIELD * medSteps, w };
}

/**
 * One vertex record `[x, y, z, w]` of a ribbon: `sM` metres along the segment (already wrapped, or wrapped at the quad's near row so
 * the far row may run past the wrap), `tM` metres across (`+` left of `dir 1`).
 */
export function roadVertex(sM: number, tM: number, f: RoadFields): [number, number, number, number] {
  return [clampInt(sM * 10, 0, ROAD_X_MAX_DM), clampInt(tM * 100, -ROAD_X_MAX_DM, ROAD_X_MAX_DM), f.z, f.w];
}

/** The x field of a position `sM` metres along the segment: wrapped at `ROAD_WRAP_M`. */
export const wrapAlong = (sM: number): number => ((sM % ROAD_WRAP_M) + ROAD_WRAP_M) % ROAD_WRAP_M;

export interface RoadUnpacked {
  sM: number;
  tM: number;
  lanes: number;
  laneM: number;
  medianM: number;
  parking: number;
  oneWay: boolean;
  divided: boolean;
  busLane: boolean;
  noParking: boolean;
  markClass: number;
}

/** The inverse of `roadVertex` and `roadFields`: what the shader reads (up to the quantisation of the steps). */
export function unpackRoad(v: readonly [number, number, number, number]): RoadUnpacked {
  const [x, y, z, w] = v;
  return {
    sM: x / 10,
    tM: y / 100,
    lanes: (w >> RoadBits.Lanes) & 7,
    laneM: (z % LANE_FIELD) * LANE_STEP_M,
    medianM: Math.floor(z / LANE_FIELD) * MEDIAN_STEP_M,
    parking: (w >> RoadBits.Parking) & 3,
    oneWay: ((w >> RoadBits.OneWay) & 1) === 1,
    divided: ((w >> RoadBits.Divided) & 1) === 1,
    busLane: ((w >> RoadBits.BusLane) & 1) === 1,
    noParking: ((w >> RoadBits.NoParking) & 1) === 1,
    markClass: (w >> RoadBits.Class) & 7,
  };
}

// ---- the TS reference of the shader rules ---------------------------------------------------------------------------------------

export type MarkKind = 'none' | 'dash' | 'edge' | 'doubleYellow' | 'medianYellow' | 'parkingT' | 'bus';

/** Signed distance of the carriageway's centre from the ribbon centreline (parking on one side pushes it away from that side). */
export const carriagewayShift = (l: RoadLayout, parkingM: number): number => ((l.parking >= 1 ? 1 : 0) - (l.parking === 2 ? 1 : 0)) * (parkingM / 2);

/** Distance from the carriageway's centre to the outer edge of its lanes (two-way: from the centreline, past the median). */
export const carriagewayOuterM = (l: RoadLayout): number => (l.oneWay ? (l.lanes * l.laneM) / 2 : l.medianM / 2 + l.lanes * l.laneM);

/**
 * The paint at (`sM` along, `tM` across) of a layout, evaluated hard (no antialiasing): the reference the shader's rules follow. The
 * paint that wins is the yellow centre or median line, then white (edge, dash, T), then the bus tint.
 */
export function markingAt(l: RoadLayout, sM: number, tM: number, cfg: LayoutConfig): MarkKind {
  if (l.markClass === 0) return 'none';
  const rule = cfg.rules[cfg.classes[l.markClass] ?? 'none'];
  if (!rule) return 'none';
  const half = l.widthM / 2;
  if (Math.abs(tM) > half) return 'none';
  const park = cfg.parkingM;
  const parkMinus = l.parking >= 1;
  const parkPlus = l.parking === 2;
  const u = tM - carriagewayShift(l, park);
  const au = Math.abs(u);
  const lw = l.laneM;
  const n = l.lanes;
  const m = l.medianM / 2;
  const hw = cfg.lineM / 2;
  const s = wrapAlong(sM);
  // yellow
  if (!l.oneWay) {
    const wantCentre = rule.centre === 'twoWay' || (rule.centre === 'twoWayWide' && l.widthM >= cfg.centreWideMinM);
    if (l.divided) {
      if (Math.abs(au - m) <= hw) return 'medianYellow';
    } else if (wantCentre && Math.abs(au - (cfg.doubleGapM / 2 + hw)) <= hw) return 'doubleYellow';
  }
  // white: the edge lines sit inside the outer lane, a little in from the curb where there is no parking lane
  const outer = carriagewayOuterM(l);
  if (rule.edges) {
    const plus = outer - hw - (parkPlus ? 0 : cfg.edgeInsetM);
    const minus = outer - hw - (parkMinus ? 0 : cfg.edgeInsetM);
    if (Math.abs(u - plus) <= hw || Math.abs(u + minus) <= hw) return 'edge';
  }
  if (rule.dashes && n >= 2 && s % (cfg.dashOnM + cfg.dashOffM) < cfg.dashOnM) {
    const q = l.oneWay ? (u + outer) / lw : (au - m) / lw;
    const k = Math.round(q);
    if (k >= 1 && k <= n - 1 && Math.abs(q - k) * lw <= hw) return 'dash';
  }
  if (rule.ts && !l.noParking && (parkMinus || parkPlus)) {
    const onPlus = parkPlus && tM >= half - park;
    const onMinus = parkMinus && tM <= -half + park;
    if (onPlus || onMinus) {
      const curb = half - Math.abs(tM);
      const across = Math.abs((s % cfg.tEveryM) - cfg.tEveryM / 2);
      if (across <= hw && curb <= cfg.tStemM) return 'parkingT';
      if (Math.abs(curb - cfg.tStemM) <= hw && across <= cfg.tBarM / 2) return 'parkingT';
    }
  }
  if (l.busLane) {
    if (l.oneWay ? u >= -outer && u <= -outer + lw : au >= m + (n - 1) * lw && au <= m + n * lw) return 'bus';
  }
  return 'none';
}
