import type { QualityTierId, SimProfile } from '@dv/shared';

/**
 * The single parser for QA URL flags (11-platform-perf.md section 4).
 * It parses nothing unless the build is a QA build (VITE_DV_QA === '1'); production builds ignore every flag.
 * M00 handles ?gl=1, ?tier=, ?xr-emulate=quest3, ?probe=gpu and ?unsupported=1; M01c adds ?gpu=1, ?perf=1, ?governor=off
 * (parsed, inert until M11a), ?limits= and ?scenario= (the platform flags of 11-platform-perf.md section 4).
 */
export interface QaFlags {
  readonly enabled: boolean;
  /** ?gl=1 forces the WebGL2 backend. */
  readonly gl: boolean;
  /** ?tier=<id> forces a quality tier. */
  readonly tier: QualityTierId | null;
  /** ?xr-emulate=quest3 installs the IWER Quest 3 emulator before the renderer exists. */
  readonly xrEmulate: 'quest3' | null;
  /** ?probe=gpu runs the GPU probe at boot. */
  readonly probe: 'gpu' | null;
  /** ?unsupported=1 shows the unsupported screen. */
  readonly unsupported: boolean;
  /** ?profile=canonical|local picks the sim profile (M01a2). */
  readonly profile: SimProfile | null;
  /** ?transport=pm forces the postMessage transport even when the page is cross-origin isolated (M01a2). */
  readonly transport: 'postMessage' | null;
  /** ?debug=1 makes the engine canvas fill the window and take input (M01b1: the play view for the controller demo). */
  readonly debug: boolean;
  /** ?gpu=1 forces the WebGPU backend (device spikes, QA only). */
  readonly gpu: boolean;
  /** ?perf=1 shows the PerfHud. */
  readonly perf: boolean;
  /** ?governor=off disables the runtime governor. Parsed and inert until M11a. */
  readonly governor: 'off' | null;
  /** ?limits=name:value lowers adapter limits for weak-device emulation. */
  readonly limits: Readonly<Record<string, number>>;
  /** ?scenario=<id> starts a perf scenario at boot. */
  readonly scenario: string | null;
  /** ?world=<id> picks the sim scenario the page boots instead of the gray-box block (`walk-drop`, `physics-drop`; M01b2). */
  readonly world: string | null;
  /** ?touch=1 shows the touch layer on any device (M01b2). */
  readonly touch: boolean;
  /** ?unlockAll=1 unlocks every registered unlock in memory, never persisted (M04a2, C06 rule 6). */
  readonly unlockAll: boolean;
  /**
   * The QA play bypass (M04b1, DL-650): `sandbox` or `story` skips the age, Terms and menu pages and starts that mode at once; `off`
   * runs the normal flow. From `?play=`, else the QA-only localStorage key `dv-qa-play`, else `sandbox` when `?scenario=` is set.
   */
  readonly play: QaPlay | null;
}

export type QaPlay = 'sandbox' | 'story' | 'off';
/** The QA-only localStorage key that supplies `play` when the URL has none (Playwright's storage state sets it). */
export const QA_PLAY_KEY = 'dv-qa-play';

export const NO_QA_FLAGS: QaFlags = Object.freeze({
  enabled: false,
  gl: false,
  tier: null,
  xrEmulate: null,
  probe: null,
  unsupported: false,
  profile: null,
  transport: null,
  debug: false,
  gpu: false,
  perf: false,
  governor: null,
  limits: Object.freeze({}),
  scenario: null,
  world: null,
  touch: false,
  unlockAll: false,
  play: null,
});

const TIER_IDS: readonly QualityTierId[] = [
  'desktop-ultra',
  'desktop',
  'mobile',
  'mobile-low',
  'xr-quest',
  'xr-visionpro',
];

/** Parses `?limits=maxBufferSize:268435456,maxTextureDimension2D:4096` into name/value pairs; malformed pairs are skipped. */
export function parseLimits(value: string | null): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!value) return out;
  for (const pair of value.split(',')) {
    const i = pair.indexOf(':');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const n = Number(pair.slice(i + 1));
    if (/^[A-Za-z0-9]+$/.test(name) && Number.isFinite(n) && n >= 0) out[name] = n;
  }
  return out;
}

export function isQaBuild(): boolean {
  return import.meta.env.VITE_DV_QA === '1';
}

function asPlay(v: string | null | undefined): QaPlay | null {
  return v === 'sandbox' || v === 'story' || v === 'off' ? v : null;
}

/** The stored `dv-qa-play` value; storage can throw (private windows) or be absent (Node), both read as unset. */
function storedPlay(): QaPlay | null {
  try {
    return asPlay(globalThis.localStorage?.getItem(QA_PLAY_KEY));
  } catch {
    return null;
  }
}

export function parseQaFlags(search: string, enabled: boolean = isQaBuild(), stored: () => QaPlay | null = storedPlay): QaFlags {
  if (!enabled) return NO_QA_FLAGS;
  const q = new URLSearchParams(search);
  const tier = q.get('tier');
  const scenario = q.get('scenario') && /^[a-z0-9-]{1,40}$/.test(q.get('scenario') as string) ? (q.get('scenario') as string) : null;
  return {
    enabled: true,
    gl: q.get('gl') === '1',
    tier: TIER_IDS.find((id) => id === tier) ?? null,
    xrEmulate: q.get('xr-emulate') === 'quest3' ? 'quest3' : null,
    probe: q.get('probe') === 'gpu' ? 'gpu' : null,
    unsupported: q.get('unsupported') === '1',
    profile: q.get('profile') === 'canonical' ? 'canonical' : q.get('profile') === 'local' ? 'local' : null,
    transport: q.get('transport') === 'pm' ? 'postMessage' : null,
    debug: q.get('debug') === '1',
    gpu: q.get('gpu') === '1',
    perf: q.get('perf') === '1',
    governor: q.get('governor') === 'off' ? 'off' : null,
    limits: parseLimits(q.get('limits')),
    scenario,
    world: q.get('world') && /^[a-z0-9-]{1,40}$/.test(q.get('world') as string) ? (q.get('world') as string) : null,
    touch: q.get('touch') === '1',
    unlockAll: q.get('unlockAll') === '1',
    play: asPlay(q.get('play')) ?? stored() ?? (scenario !== null ? 'sandbox' : null),
  };
}
