import { sha256Hex } from '../hash.ts';
import {
  FLAT_TIER_OF,
  type DeviceClass,
  type DeviceProfile,
  type DeviceSignals,
  type QualityTierId,
} from './c13.ts';

/**
 * Pure device classification (11-platform.md section 5.2). No globals: the caller gathers `DeviceSignals`
 * (engine `DeviceProbe`), fixtures under tools/ci/fixtures/ua/ replay them.
 *
 * Rules, in order:
 *   1. `OculusBrowser` in the UA and immersive-vr supported: Quest.
 *   2. WebKit engine with navigator.xr, immersive-vr, an XR GPU binding and no touch: Vision Pro. The visionOS UA string is
 *      UNVERIFIED, so the rule keys on capabilities.
 *   3. More than one touch point with a WebKit engine: iPhone or iPad (screen size separates them); other touch devices with a
 *      mobile UA: Android (a touch laptop is still a desktop).
 *   4. Otherwise desktop.
 */

/** Short side, in CSS px, at or above which a touch WebKit device is an iPad. iPhone Pro Max is 440 wide, iPad mini is 744. */
const IPAD_MIN_SHORT_SIDE = 600;

const HASH_CHARS = 16;

function isChromiumEngine(ua: string): boolean {
  return /\b(?:Chrome|Chromium|Edg|EdgA|OPR)\//.test(ua);
}

/** WebKit engine: AppleWebKit in the UA and not Chromium. Chrome and Firefox on iOS (CriOS, FxiOS) are WebKit. */
function isWebKitEngine(ua: string): boolean {
  return /AppleWebKit\//.test(ua) && !isChromiumEngine(ua);
}

function browserOf(ua: string, webkit: boolean): DeviceProfile['browser'] {
  if (/OculusBrowser/.test(ua)) return 'quest-browser';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/CriOS\//.test(ua)) return 'chrome';
  if (webkit) return 'safari';
  if (isChromiumEngine(ua)) return 'chrome';
  return 'other';
}

function textureFamilyOf(features: readonly string[]): DeviceProfile['textureFamily'] {
  if (features.includes('texture-compression-astc')) return 'astc';
  if (features.includes('texture-compression-bc')) return 'bc';
  if (features.includes('texture-compression-etc2')) return 'etc2';
  return 'none';
}

/** Hash of the UA string and the client-hint brands, 16 hex characters. */
export function uaHashOf(s: Pick<DeviceSignals, 'userAgent' | 'platform' | 'uaData'>): string {
  const hints = s.uaData ? `${s.uaData.brands.join(',')};${String(s.uaData.mobile)};${s.uaData.platform}` : '';
  return sha256Hex(`${s.userAgent}|${s.platform}|${hints}`).slice(0, HASH_CHARS);
}

/** Hash of the adapter summary, 16 hex characters; a fixed value when there is no adapter. */
export function adapterHashOf(a: DeviceSignals['adapter']): string {
  if (!a) return sha256Hex('adapter:none').slice(0, HASH_CHARS);
  const parts = [a.vendor, a.architecture, a.device, a.description, String(a.isFallbackAdapter), String(a.maxTextureDimension2D)];
  return sha256Hex(`adapter:${parts.join('|')}`).slice(0, HASH_CHARS);
}

export function classifyDevice(s: DeviceSignals): DeviceProfile {
  const ua = s.userAgent;
  const webkit = isWebKitEngine(ua);
  const touch = s.maxTouchPoints > 0;
  const immersive = s.immersiveVrSupported === true;

  let cls: DeviceClass;
  let headset: DeviceProfile['xrHeadset'] = null;
  if (/OculusBrowser/.test(ua) && immersive) {
    cls = 'quest';
    headset = 'quest';
  } else if (webkit && s.hasNavigatorXr && immersive && s.hasXrGpuBinding && !touch) {
    cls = 'avp';
    headset = 'visionpro';
  } else if (s.maxTouchPoints > 1 && webkit) {
    cls = Math.min(s.screen.w, s.screen.h) >= IPAD_MIN_SHORT_SIDE ? 'ipad' : 'iphone';
  } else if (s.maxTouchPoints > 1 && (s.uaData?.mobile === true || /Android|Mobile/.test(ua))) {
    // Touch laptops (Windows, ChromeOS) report touch points too; only a mobile UA makes a touch device Android.
    cls = 'android';
  } else {
    cls = 'desktop';
  }

  const memoryLow = s.deviceMemoryGB !== null && s.deviceMemoryGB <= 4;
  const coresLow = s.hardwareConcurrency > 0 && s.hardwareConcurrency <= 4;

  return {
    class: cls,
    browser: browserOf(ua, webkit),
    displayMode: s.displayModeStandalone ? 'standalone' : 'tab',
    touch,
    lowMemoryHint: memoryLow || coresLow,
    xrCapable: headset !== null,
    xrHeadset: headset,
    textureFamily: textureFamilyOf(s.gpuFeatures),
    uaHash: uaHashOf(s),
    adapterHash: adapterHashOf(s.adapter),
    signals: s,
  };
}

/**
 * Provisional tier before any benchmark (11-platform.md section 5.3): XR devices boot flat at FLAT_TIER_OF, touch devices
 * start at `mobile` (`mobile-low` with the low-memory hint), everything else at `desktop`.
 */
export function provisionalTier(p: DeviceProfile): QualityTierId {
  if (p.xrHeadset === 'quest') return FLAT_TIER_OF['xr-quest'] ?? 'mobile-low';
  if (p.xrHeadset === 'visionpro') return FLAT_TIER_OF['xr-visionpro'] ?? 'mobile';
  if (p.class === 'iphone' || p.class === 'ipad' || p.class === 'android') return p.lowMemoryHint ? 'mobile-low' : 'mobile';
  return 'desktop';
}
