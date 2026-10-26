/**
 * The phone app registry (10-ui-hud-xr.md 2.10, "Phone and pause (U-24)"). Pause and Phone share it: Pause lists the same Settings and
 * Help entries as the apps. An app is a `PhoneAppDef`; its screen is a `ScreenDef`, so one tree draws in DOM and in an XR panel.
 * Apps whose systems are not shipped register as `comingSoon` tiles (the A-06 pattern); Camera and Feed stay so in v1 (DL-292).
 */
import { lk, type LocKey } from '../i18n/index.ts';
import type { ScreenDef } from '../screen/types.ts';
import type { GateResult } from '../shell/types.ts';
import { appScreen, type PhoneEnv } from './apps.ts';

export type { PhoneEnv } from './apps.ts';

export interface PhoneGateCtx {
  /** The id of the running top-level mode, or null. */
  mode: string | null;
}

export interface PhoneAppDef {
  id: string;
  titleKey: LocKey;
  icon: string;
  gate(c: PhoneGateCtx): GateResult;
  /** The app's screen for the current data. */
  screen(env: PhoneEnv): ScreenDef;
  xr: 'panel' | 'none';
  pauses: boolean;
  milestone: string;
  /** Registered but not shipped: a tile that cannot be opened. */
  comingSoon?: boolean;
}

const open = (): GateResult => ({ state: 'open' });
const sandboxOnly = (c: PhoneGateCtx): GateResult => (c.mode === 'sandbox' ? { state: 'open' } : { state: 'hidden' });

const app = (id: string, icon: string, milestone: string, extra: Partial<PhoneAppDef> = {}): PhoneAppDef => ({
  id,
  titleKey: lk(`phone.app.${id}`),
  icon,
  gate: open,
  screen: (env) => appScreen(id, env),
  xr: 'panel',
  pauses: true,
  milestone,
  ...extra,
});

export const PHONE_APPS: readonly PhoneAppDef[] = [
  app('map', '▦', 'M02c2'),
  app('messages', '✉', 'M05c2'),
  app('jobs', '⚑', 'M04b2'),
  app('garage', '⚙', 'M04b2'),
  app('ride', '⇄', 'M04b2'),
  app('camera', '◉', 'post-v1', { comingSoon: true }),
  app('feed', '☰', 'post-v1', { comingSoon: true }),
  app('bank', '$', 'M04b2'),
  app('sandbox', '⚒', 'M04b2', { gate: sandboxOnly }),
  app('settings', '⚙', 'M04b1'),
  app('help', '?', 'M04b2'),
];

/** The apps shown on the home screen for a mode. */
export function visibleApps(c: PhoneGateCtx): PhoneAppDef[] {
  return PHONE_APPS.filter((a) => a.gate(c).state !== 'hidden');
}

export function appDef(id: string): PhoneAppDef | undefined {
  return PHONE_APPS.find((a) => a.id === id);
}
