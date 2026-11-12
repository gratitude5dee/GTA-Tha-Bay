import type { DynamicQuality, DynamicRange } from '@dv/shared';

/**
 * The governor's knobs in the order of 11-platform.md section 5.5 (cheapest visual loss first). A downgrade moves the first knob that
 * is not at its floor; an upgrade restores the last knob that is not at its ceiling, so the order of loss is the reverse order of gain.
 */
export const KNOB_ORDER = [
  'renderScale',
  'shadowDistanceScale',
  'buildingDistanceScale',
  'lodBias',
  'crowdDensity',
  'postLevel',
  'atmosphereLevel',
  'textureMipBias',
  'foveation',
  'targetFps',
] as const satisfies readonly (keyof DynamicQuality)[];
export type KnobId = (typeof KNOB_ORDER)[number];

/** One step of each knob toward its floor (BD-M11a1-01). `targetFps` goes to its floor in one step (Quest 90 to 72, phone 60 to 30). */
export const KNOB_STEP: Readonly<Record<KnobId, number>> = {
  renderScale: 0.1,
  shadowDistanceScale: 0.1,
  buildingDistanceScale: 0.1,
  lodBias: 0.5,
  crowdDensity: 0.2,
  postLevel: 1,
  atmosphereLevel: 1,
  textureMipBias: 0.5,
  foveation: 0.25,
  targetFps: Number.POSITIVE_INFINITY,
};

/** What limits a knob right now besides its tier range. */
export interface KnobContext {
  range: DynamicRange;
  /** An XR session is presenting: `renderScale` is never touched, `foveation` is the XR knob. */
  xr: boolean;
  /** The player fixed the render scale (`PlatformSettings.renderScale`, DL-727): the knob is skipped. */
  renderScalePinned: boolean;
  /** The player's frame cap (30 or 60): the ceiling of `targetFps`, never raised by the governor. */
  fpsCap: number | null;
  /** `look.json` `postLevelCap`: levels above it draw the same as the cap, so a step through them would only cost time. */
  postLevelCap: number | null;
  /**
   * The knobs something in the app consumes (BD-M11a1-03). A knob nothing reads is skipped, so no 5 s step is spent on it; null means
   * all ten (the unit tests). The order among the live knobs is unchanged.
   */
  live?: ReadonlySet<KnobId> | null;
}

export interface Limits {
  /** The value the knob returns to (best quality). */
  ceil: number;
  /** The value the knob stops at (worst allowed). */
  floor: number;
  step: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** The numbers a knob moves between under a context, or null when the knob is not in play (XR, pin, no foveation). */
export function limitsOf(id: KnobId, ctx: KnobContext): Limits | null {
  const { floor: f, ceil: c } = ctx.range;
  if (ctx.live && !ctx.live.has(id)) return null;
  if (id === 'renderScale') return ctx.xr || ctx.renderScalePinned ? null : { ceil: c.renderScale, floor: f.renderScale, step: KNOB_STEP.renderScale };
  if (id === 'foveation') {
    if (!ctx.xr || c.foveation === null || f.foveation === null) return null;
    return { ceil: c.foveation, floor: f.foveation, step: KNOB_STEP.foveation };
  }
  let ceil = c[id];
  let floor = f[id];
  if (id === 'targetFps' && ctx.fpsCap !== null && !ctx.xr) ceil = Math.min(ceil, ctx.fpsCap);
  if (id === 'postLevel' && ctx.postLevelCap !== null) ceil = Math.min(ceil, ctx.postLevelCap);
  // A ceiling lowered past the floor leaves nothing to move.
  floor = f[id] > c[id] ? Math.max(floor, ceil) : Math.min(floor, ceil);
  return { ceil, floor, step: KNOB_STEP[id] };
}

/** +1 when the floor is above the ceiling (more bias, more foveation), -1 when it is below. */
const dir = (l: Limits): number => (l.floor > l.ceil ? 1 : -1);

/** True when `cur` has reached the floor of the limits (a knob with no travel is always at its floor). */
export function atFloor(cur: number, l: Limits): boolean {
  return l.floor === l.ceil || (dir(l) > 0 ? cur >= l.floor - 1e-9 : cur <= l.floor + 1e-9);
}

export function atCeil(cur: number, l: Limits): boolean {
  return l.floor === l.ceil || (dir(l) > 0 ? cur <= l.ceil + 1e-9 : cur >= l.ceil - 1e-9);
}

/** The value one step toward the floor, starting from the better of `cur` and the ceiling. */
export function stepDown(cur: number, l: Limits): number {
  const from = dir(l) > 0 ? Math.max(cur, l.ceil) : Math.min(cur, l.ceil);
  const next = from + dir(l) * l.step;
  return round(dir(l) > 0 ? Math.min(next, l.floor) : Math.max(next, l.floor));
}

/** The value one step toward the ceiling. */
export function stepUp(cur: number, l: Limits): number {
  const next = cur - dir(l) * l.step;
  return round(dir(l) > 0 ? Math.max(next, l.ceil) : Math.min(next, l.ceil));
}

export interface KnobMove {
  knob: KnobId;
  from: number;
  to: number;
}

const valueOf = (q: DynamicQuality, id: KnobId): number | null => q[id];

/** The next downgrade: the first knob in order that is in play and not at its floor. */
export function nextDown(q: DynamicQuality, ctx: KnobContext): KnobMove | null {
  for (const id of KNOB_ORDER) {
    const l = limitsOf(id, ctx);
    const cur = valueOf(q, id);
    if (!l || cur === null || atFloor(cur, l)) continue;
    return { knob: id, from: cur, to: stepDown(cur, l) };
  }
  return null;
}

/** The next upgrade: the last knob in order that is in play and not at its ceiling. */
export function nextUp(q: DynamicQuality, ctx: KnobContext): KnobMove | null {
  for (let i = KNOB_ORDER.length - 1; i >= 0; i--) {
    const id = KNOB_ORDER[i] as KnobId;
    const l = limitsOf(id, ctx);
    const cur = valueOf(q, id);
    if (!l || cur === null || atCeil(cur, l)) continue;
    return { knob: id, from: cur, to: stepUp(cur, l) };
  }
  return null;
}

/** True when every knob in play is at its floor (the 20 s clock of the tier demotion runs while this holds). */
export function allAtFloor(q: DynamicQuality, ctx: KnobContext): boolean {
  return nextDown(q, ctx) === null;
}

/** `q` with the move applied. */
export function applyMove(q: DynamicQuality, m: KnobMove): DynamicQuality {
  return { ...q, [m.knob]: m.to } as DynamicQuality;
}
