/**
 * The strings of the mode UI. The catalog is `content/ui/i18n/en.json` (keys `fighter.*`); the UI half reads it directly so the mode
 * package does not depend on `@dv/ui`. `{name}` placeholders are filled from `params`. Every string is original wording (M04e5).
 */
import en from '../../../../../content/ui/i18n/en.json';

const catalog = en as unknown as Record<string, string>;

export function tt(key: string, params?: Record<string, string | number>): string {
  let s = catalog[key] ?? key;
  if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

/** Keys the UI half uses, listed once so a test can check the catalog has every one. */
export const UI_KEYS: readonly string[] = [
  'fighter.ui.title', 'fighter.ui.versus', 'fighter.ui.training', 'fighter.ui.controls', 'fighter.ui.leave', 'fighter.ui.start', 'fighter.ui.back',
  'fighter.ui.rematch', 'fighter.ui.resume', 'fighter.ui.pause', 'fighter.ui.moves', 'fighter.ui.restart', 'fighter.ui.you', 'fighter.ui.opponent',
  'fighter.ui.stage', 'fighter.ui.day', 'fighter.ui.night', 'fighter.ui.difficulty', 'fighter.ui.level.0', 'fighter.ui.level.1', 'fighter.ui.level.2',
  'fighter.ui.level.3', 'fighter.ui.scheme', 'fighter.ui.scheme.classic', 'fighter.ui.scheme.simple', 'fighter.ui.rounds', 'fighter.ui.locked',
  'fighter.ui.hint.classic', 'fighter.ui.hint.simple', 'fighter.ui.hint.touch', 'fighter.ui.result.win', 'fighter.ui.result.lose',
  'fighter.ui.result.line', 'fighter.ui.result.xp', 'fighter.ui.moveList', 'fighter.ui.move.input', 'fighter.ui.move.frames', 'fighter.ui.move.adv',
  'fighter.hud.round', 'fighter.hud.fight', 'fighter.hud.ko', 'fighter.hud.time', 'fighter.hud.win', 'fighter.hud.lose', 'fighter.hud.hits',
  'fighter.hud.scale', 'fighter.hud.rattled', 'fighter.hud.hype', 'fighter.hud.composure', 'fighter.hud.health', 'fighter.hud.timer', 'fighter.hud.paused',
  'fighter.train.title', 'fighter.train.meter', 'fighter.train.startup', 'fighter.train.active', 'fighter.train.recovery', 'fighter.train.advantage',
  'fighter.train.result.hit', 'fighter.train.result.block', 'fighter.train.result.whiff', 'fighter.train.measured', 'fighter.train.dummy',
  'fighter.train.dummy.stand', 'fighter.train.dummy.crouch', 'fighter.train.dummy.blockAll', 'fighter.train.dummy.blockFirst', 'fighter.train.dummy.jump',
  'fighter.train.dummy.cpu', 'fighter.train.dummy.playback', 'fighter.train.record', 'fighter.train.stop', 'fighter.train.play', 'fighter.train.reset',
  'fighter.train.refill', 'fighter.train.boxes', 'fighter.train.meterToggle', 'fighter.train.inputs', 'fighter.train.damage', 'fighter.train.last',
  'fighter.train.none', 'fighter.train.recorded', 'fighter.train.invuln',
];
