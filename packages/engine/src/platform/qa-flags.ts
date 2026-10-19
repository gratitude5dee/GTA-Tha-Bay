import type { QualityTierId, SimProfile } from '@dv/shared';

/**
 * The single parser for QA URL flags (11-platform-perf.md section 4).
 * It parses nothing unless the build is a QA build (VITE_DV_QA === '1'); production builds ignore every flag.
 * M00 handles ?gl=1, ?tier=, ?xr-emulate=quest3, ?probe=gpu and ?unsupported=1.
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
}

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
});

const TIER_IDS: readonly QualityTierId[] = [
  'desktop-ultra',
  'desktop',
  'mobile',
  'mobile-low',
  'xr-quest',
  'xr-visionpro',
];

export function isQaBuild(): boolean {
  return import.meta.env.VITE_DV_QA === '1';
}

export function parseQaFlags(search: string, enabled: boolean = isQaBuild()): QaFlags {
  if (!enabled) return NO_QA_FLAGS;
  const q = new URLSearchParams(search);
  const tier = q.get('tier');
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
  };
}
