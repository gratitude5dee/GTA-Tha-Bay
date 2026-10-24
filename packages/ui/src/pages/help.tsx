/**
 * Help (10-ui-pages.md section 2.14): the troubleshooting guide from `content/ui/help/troubleshooting.json` (schema 4.4), grouped, with
 * error-page deep links. A stale translation falls back to English: each translated key stores the hash of the English text it was made
 * from (`<lang>.hashes.json`, written by `check:i18n`), and a translation whose hash differs is not shown.
 */
import { h } from 'preact';
import guideJson from '../../../../content/ui/help/troubleshooting.json';
import { sha256Hex } from '@dv/shared';
import { catalogs, getLang, t } from '../i18n/index.ts';
import { Button } from '../kit/widgets.tsx';
import { useShell } from '../shell/context.tsx';
import type { PageProps } from '../shell/types.ts';
import type { ErrorKind } from './system.tsx';

export interface TroubleshootingGuide {
  version: 1;
  updated: string;
  groups: { id: string; title: string; topics: { id: string; title: string; steps: string[] }[] }[];
  sources: { title: string; url: string }[];
}
export const GUIDE: TroubleshootingGuide = guideJson as unknown as TroubleshootingGuide;

/** The topic each error-page kind deep-links to. */
export const ERROR_TOPIC: Record<ErrorKind, string> = {
  'gpu-init': 'graphics.gpu',
  'wasm-load': 'performance.load',
  'sim-crash': 'graphics.crash',
  'storage-unavailable': 'saves.storage',
  'region-blocked': 'online.region',
};

export function topicIds(): string[] {
  return GUIDE.groups.flatMap((g) => g.topics.map((x) => x.id));
}

const hash12 = (s: string): string => sha256Hex(s).slice(0, 12);

/**
 * The text for a key in a language: the translation only when its recorded hash matches the English source, otherwise English.
 * `hashes` is the sidecar of that language (key to the 12-hex hash of the English string it was translated from).
 */
export function helpText(key: string, lang: string, cats: Readonly<Record<string, Readonly<Record<string, string>>>>, hashes: Readonly<Record<string, string>> = {}): string {
  const en = cats['en']?.[key];
  const base = lang.split('-')[0] ?? lang;
  for (const l of lang === 'en' ? [] : [lang, base]) {
    const tr = cats[l]?.[key];
    if (tr !== undefined && en !== undefined && hashes[key] === hash12(en)) return tr;
  }
  return en ?? key;
}

export default function HelpPage(props: PageProps) {
  const { shell } = useShell();
  const want = props.params['topic'];
  const lang = getLang();
  const text = (k: string): string => (lang === 'en' ? t(k) : helpText(k, lang, catalogs, {}));
  return h(
    'main',
    { class: 'dv-page dv-help', 'data-testid': 'help' },
    h('h1', null, t('nav.help')),
    ...GUIDE.groups.map((g) =>
      h(
        'section',
        { key: g.id, 'data-testid': `help-group-${g.id}` },
        h('h2', null, text(g.title)),
        ...g.topics.map((topic) =>
          h(
            'details',
            { key: topic.id, class: 'dv-help-topic', open: want === topic.id, 'data-testid': `help-topic-${topic.id}` },
            h('summary', null, text(topic.title)),
            h('ol', null, ...topic.steps.map((s, i) => h('li', { key: i }, text(s)))),
          ),
        ),
      ),
    ),
    h('div', { class: 'dv-actions' }, h(Button, { id: 'help-back', label: t('common.back'), onPress: () => shell.back() })),
  );
}
