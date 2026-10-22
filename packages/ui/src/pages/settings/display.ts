/** Settings: Graphics, XR comfort, Camera and Language (10-ui-pages.md section 2.9). Each builder returns a `ScreenDef`. */
import { lk } from '../../i18n/index.ts';
import type { ScreenDef, Widget } from '../../screen/types.ts';
import type { SettingsEnv } from './index.ts';

const reset = (cat: string): Widget => ({ k: 'button', id: `reset-${cat}`, label: lk('settings.reset'), style: 'secondary', onPress: { call: 'reset', args: [cat] } });

export function graphicsScreen(env: SettingsEnv): ScreenDef {
  const tiers = env.tierChoices.map((id) => ({ value: id, label: lk(`tier.${id}`) }));
  return {
    id: 'settings-graphics',
    title: lk('settings.graphics'),
    children: [
      { k: 'heading', text: lk('settings.graphics'), level: 2 },
      { k: 'text', text: lk('settings.graphics.info'), params: { tier: env.tierLine, backend: env.backend }, tone: 'muted' },
      { k: 'choice', id: 'tier', label: lk('settings.graphics.tier'), bind: { scope: 'device', path: 'tierOverride' }, options: [{ value: 'auto', label: lk('settings.auto') }, ...tiers] },
      { k: 'text', text: lk('settings.graphics.tier.note'), tone: 'muted' },
      { k: 'toggle', id: 'compat', label: lk('settings.graphics.compat'), hint: lk('settings.graphics.compat.hint'), bind: { scope: 'device', path: 'compatibilityMode' } },
      { k: 'choice', id: 'fps', label: lk('settings.graphics.fps'), bind: { scope: 'device', path: 'fpsCap' }, options: [{ value: 'auto', label: lk('settings.auto') }, { value: 30, label: lk('settings.fps.30') }, { value: 60, label: lk('settings.fps.60') }] },
      {
        k: 'choice', id: 'scale', label: lk('settings.graphics.scale'), bind: { scope: 'device', path: 'renderScale' },
        options: [{ value: 'auto', label: lk('settings.auto') }, { value: 0.5, label: lk('settings.scale.50') }, { value: 0.65, label: lk('settings.scale.65') }, { value: 0.8, label: lk('settings.scale.80') }, { value: 1, label: lk('settings.scale.100') }],
      },
      ...(env.deviceClass === 'xr'
        ? [{ k: 'choice' as const, id: 'foveation', label: lk('settings.graphics.foveation'), bind: { scope: 'device' as const, path: 'foveation' }, options: [{ value: 'auto', label: lk('settings.auto') }, { value: 0, label: lk('settings.off') }, { value: 0.5, label: lk('settings.medium') }, { value: 1, label: lk('settings.high') }] }]
        : []),
      { k: 'toggle', id: 'datasaver', label: lk('settings.graphics.datasaver'), bind: { scope: 'device', path: 'dataSaver' } },
      { k: 'toggle', id: 'fps-counter', label: lk('settings.graphics.fpscounter'), bind: { scope: 'ui', path: 'showFps' } },
      { k: 'button', id: 'benchmark', label: lk('settings.graphics.benchmark'), style: 'secondary', onPress: { call: 'benchmark' } },
      reset('graphics'),
    ],
  };
}

export function xrScreen(env: SettingsEnv): ScreenDef {
  if (!env.xrCapable) {
    return { id: 'settings-xr', title: lk('settings.xr'), children: [{ k: 'heading', text: lk('settings.xr'), level: 2 }, { k: 'text', text: lk('settings.xr.collapsed'), tone: 'muted' }] };
  }
  const p = (path: string) => ({ scope: 'profile' as const, path: `xr.${path}` });
  return {
    id: 'settings-xr',
    title: lk('settings.xr'),
    children: [
      { k: 'heading', text: lk('settings.xr'), level: 2 },
      { k: 'choice', id: 'xr-loco', label: lk('settings.xr.locomotion'), bind: p('locomotion'), options: [{ value: 'teleport', label: lk('settings.xr.teleport') }, { value: 'smooth', label: lk('settings.xr.smooth') }] },
      { k: 'choice', id: 'xr-turn', label: lk('settings.xr.turn'), bind: p('turn'), options: [{ value: 'snap', label: lk('settings.xr.snap') }, { value: 'smooth', label: lk('settings.xr.smooth') }] },
      { k: 'choice', id: 'xr-snap', label: lk('settings.xr.snapAngle'), bind: p('snapAngleDeg'), options: [{ value: 30, label: lk('settings.xr.deg30') }, { value: 45, label: lk('settings.xr.deg45') }] },
      { k: 'slider', id: 'xr-speed', label: lk('settings.xr.speed'), bind: p('smoothSpeedMps'), min: 1, max: 6, step: 0.5, unit: ' m/s' },
      { k: 'toggle', id: 'xr-quant', label: lk('settings.xr.quantize'), bind: p('quantizeVelocity') },
      { k: 'choice', id: 'xr-vignette', label: lk('settings.xr.vignette'), bind: p('vignette'), options: [{ value: 'off', label: lk('settings.off') }, { value: 'low', label: lk('settings.low') }, { value: 'medium', label: lk('settings.medium') }, { value: 'high', label: lk('settings.high') }] },
      { k: 'slider', id: 'xr-assist', label: lk('settings.xr.assist'), bind: p('comfortAssist'), min: 0, max: 1, step: 0.1 },
      { k: 'toggle', id: 'xr-seated', label: lk('settings.xr.seated'), bind: p('seated') },
      { k: 'choice', id: 'xr-hand', label: lk('settings.xr.hand'), bind: p('dominantHand'), options: [{ value: 'left', label: lk('settings.xr.left') }, { value: 'right', label: lk('settings.xr.right') }] },
      { k: 'toggle', id: 'xr-horizon', label: lk('settings.xr.horizon'), bind: p('cockpitHorizonLock') },
      { k: 'choice', id: 'xr-chase', label: lk('settings.xr.chase'), bind: p('chaseView'), options: [{ value: 'cockpit', label: lk('settings.xr.cockpit') }, { value: 'diorama', label: lk('settings.xr.diorama') }] },
      { k: 'choice', id: 'xr-arena', label: lk('settings.xr.arena'), bind: p('arenaScale'), options: [{ value: 'tabletop', label: lk('settings.xr.tabletop') }, { value: 'life-size', label: lk('settings.xr.lifesize') }] },
      { k: 'toggle', id: 'xr-hands', label: lk('settings.xr.hands'), bind: p('handsEnabled') },
      { k: 'slider', id: 'xr-distance', label: lk('settings.xr.distance'), bind: p('uiDistanceM'), min: 0.8, max: 2, step: 0.1, unit: ' m' },
      reset('xr'),
    ],
  };
}

export function cameraScreen(): ScreenDef {
  const p = (path: string) => ({ scope: 'profile' as const, path: `camera.${path}` });
  return {
    id: 'settings-camera',
    title: lk('settings.camera'),
    children: [
      { k: 'heading', text: lk('settings.camera'), level: 2 },
      { k: 'choice', id: 'cam-mode', label: lk('settings.camera.mode'), bind: p('defaultMode'), options: [{ value: 'tp', label: lk('settings.camera.tp') }, { value: 'fp', label: lk('settings.camera.fp') }] },
      { k: 'slider', id: 'cam-fov', label: lk('settings.camera.fov'), bind: p('fovDeg'), min: 60, max: 100, step: 5, unit: '°' },
      { k: 'choice', id: 'cam-shoulder', label: lk('settings.camera.shoulder'), bind: p('shoulder'), options: [{ value: 'right', label: lk('settings.xr.right') }, { value: 'left', label: lk('settings.xr.left') }] },
      { k: 'toggle', id: 'cam-shake', label: lk('settings.camera.shake'), hint: lk('settings.camera.shake.hint'), bind: p('shake') },
      reset('camera'),
    ],
  };
}

export function languageScreen(): ScreenDef {
  return {
    id: 'settings-language',
    title: lk('settings.language'),
    children: [
      { k: 'heading', text: lk('settings.language'), level: 2 },
      { k: 'choice', id: 'lang', label: lk('settings.language'), bind: { scope: 'profile', path: 'language' }, options: [{ value: 'en', label: lk('settings.language.en') }] },
      { k: 'text', text: lk('settings.language.note'), tone: 'muted' },
    ],
  };
}
