/** Settings: Audio, Subtitles, NPC voices and AI dialogue, Cutscenes, Accessibility (10-ui-pages.md section 2.9). */
import { lk } from '../../i18n/index.ts';
import type { ScreenDef, Widget } from '../../screen/types.ts';

const reset = (cat: string): Widget => ({ k: 'button', id: `reset-${cat}`, label: lk('settings.reset'), style: 'secondary', onPress: { call: 'reset', args: [cat] } });

export const AUDIO_BUSES = ['master', 'music', 'sfx', 'ambience', 'voice', 'radio', 'ui', 'cutscene'] as const;

export function audioScreen(): ScreenDef {
  const rows: Widget[] = [];
  for (const bus of AUDIO_BUSES) {
    rows.push({ k: 'slider', id: `audio-${bus}`, label: lk(`settings.audio.${bus}`), bind: { scope: 'profile', path: `audio.${bus}` }, min: 0, max: 1, step: 0.05 });
    rows.push({ k: 'button', id: `audio-test-${bus}`, label: lk('settings.audio.test'), style: 'secondary', onPress: { call: 'audio.test', args: [bus] } });
  }
  return { id: 'settings-audio', title: lk('settings.audio'), children: [{ k: 'heading', text: lk('settings.audio'), level: 2 }, ...rows, reset('audio')] };
}

export function subtitlesScreen(): ScreenDef {
  const p = (path: string) => ({ scope: 'profile' as const, path: `subtitles.${path}` });
  return {
    id: 'settings-subtitles',
    title: lk('settings.subtitles'),
    children: [
      { k: 'heading', text: lk('settings.subtitles'), level: 2 },
      { k: 'toggle', id: 'sub-on', label: lk('settings.subtitles.on'), bind: p('on') },
      { k: 'choice', id: 'sub-size', label: lk('settings.subtitles.size'), bind: p('size'), options: [{ value: 'm', label: lk('settings.size.m') }, { value: 'l', label: lk('settings.size.l') }, { value: 'xl', label: lk('settings.size.xl') }] },
      { k: 'toggle', id: 'sub-bg', label: lk('settings.subtitles.background'), bind: p('background') },
      { k: 'toggle', id: 'sub-names', label: lk('settings.subtitles.speakers'), bind: p('speakerNames') },
      { k: 'toggle', id: 'sub-captions', label: lk('settings.subtitles.captions'), bind: { scope: 'ui', path: 'soundCaptions' } },
      { k: 'text', text: lk('settings.subtitles.preview'), tone: 'muted' },
      reset('subtitles'),
    ],
  };
}

export function npcScreen(): ScreenDef {
  return {
    id: 'settings-npc',
    title: lk('settings.npc'),
    children: [
      { k: 'heading', text: lk('settings.npc'), level: 2 },
      { k: 'choice', id: 'npc-voice', label: lk('settings.npc.voice'), bind: { scope: 'profile', path: 'npc.voice' }, options: [{ value: 'all', label: lk('settings.npc.all') }, { value: 'heroes', label: lk('settings.npc.heroes') }, { value: 'off', label: lk('settings.off') }] },
      { k: 'toggle', id: 'npc-ai', label: lk('settings.npc.ai'), hint: lk('settings.npc.ai.hint'), bind: { scope: 'profile', path: 'npc.aiDialogue' } },
      { k: 'button', id: 'npc-forget', label: lk('settings.npc.forget'), style: 'danger', disabled: lk('settings.later'), onPress: { call: 'npc.forget' } },
      reset('npc'),
    ],
  };
}

export function cutscenesScreen(): ScreenDef {
  return {
    id: 'settings-cutscenes',
    title: lk('settings.cutscenes'),
    children: [
      { k: 'heading', text: lk('settings.cutscenes'), level: 2 },
      { k: 'toggle', id: 'cut-gen', label: lk('settings.cutscenes.generated'), hint: lk('settings.cutscenes.generated.hint'), bind: { scope: 'profile', path: 'cutscenes.generated' } },
      { k: 'choice', id: 'cut-audio', label: lk('settings.cutscenes.audio'), bind: { scope: 'profile', path: 'cutscenes.audio' }, options: [{ value: 'engine', label: lk('settings.cutscenes.engine') }, { value: 'generated', label: lk('settings.cutscenes.generatedAudio') }] },
      reset('cutscenes'),
    ],
  };
}

export function accessibilityScreen(): ScreenDef {
  const a = (path: string) => ({ scope: 'profile' as const, path: `accessibility.${path}` });
  const ui = (path: string) => ({ scope: 'ui' as const, path });
  return {
    id: 'settings-accessibility',
    title: lk('settings.accessibility'),
    children: [
      { k: 'heading', text: lk('settings.accessibility'), level: 2 },
      { k: 'toggle', id: 'a11y-motion', label: lk('settings.a11y.motion'), hint: lk('settings.a11y.motion.hint'), bind: a('reducedMotion') },
      {
        k: 'choice', id: 'a11y-palette', label: lk('settings.a11y.palette'), bind: a('hudPalette'),
        options: [{ value: 'default', label: lk('settings.a11y.palette.default') }, { value: 'deutan', label: lk('settings.a11y.palette.deutan') }, { value: 'protan', label: lk('settings.a11y.palette.protan') }, { value: 'tritan', label: lk('settings.a11y.palette.tritan') }],
      },
      { k: 'choice', id: 'a11y-timer', label: lk('settings.a11y.timer'), bind: a('timerScale'), options: [{ value: 1, label: lk('settings.a11y.timer.1') }, { value: 1.25, label: lk('settings.a11y.timer.125') }, { value: 1.5, label: lk('settings.a11y.timer.15') }, { value: 2, label: lk('settings.a11y.timer.2') }] },
      { k: 'toggle', id: 'a11y-block', label: lk('settings.a11y.autoblock'), bind: a('autoBlockStoryFights') },
      { k: 'toggle', id: 'a11y-tycoon', label: lk('settings.a11y.tycoonpause'), bind: a('pauseOnTycoonEvents') },
      { k: 'slider', id: 'a11y-uiscale', label: lk('settings.a11y.uiscale'), bind: ui('uiScale'), min: 0.85, max: 1.5, step: 0.05 },
      { k: 'toggle', id: 'a11y-contrast', label: lk('settings.a11y.contrast'), bind: ui('highContrast') },
      { k: 'choice', id: 'a11y-ring', label: lk('settings.a11y.ring'), bind: ui('focusRing'), options: [{ value: 'default', label: lk('settings.a11y.ring.default') }, { value: 'thick', label: lk('settings.a11y.ring.thick') }] },
      { k: 'slider', id: 'a11y-hudscale', label: lk('settings.a11y.hudscale'), bind: ui('hudScale'), min: 0.8, max: 1.4, step: 0.05 },
      { k: 'slider', id: 'a11y-hudopacity', label: lk('settings.a11y.hudopacity'), bind: ui('hudOpacity'), min: 0.4, max: 1, step: 0.05 },
      { k: 'slider', id: 'a11y-hudmargin', label: lk('settings.a11y.hudmargin'), bind: ui('hudSafeMarginPct'), min: 0, max: 10, step: 1, unit: '%' },
      { k: 'choice', id: 'a11y-units', label: lk('settings.a11y.units'), bind: ui('units'), options: [{ value: 'mph', label: lk('settings.a11y.mph') }, { value: 'kph', label: lk('settings.a11y.kph') }] },
      { k: 'toggle', id: 'a11y-tips', label: lk('settings.a11y.tips'), bind: ui('showTips') },
      { k: 'toggle', id: 'a11y-announce', label: lk('settings.a11y.announce'), bind: ui('announce') },
      reset('accessibility'),
    ],
  };
}
