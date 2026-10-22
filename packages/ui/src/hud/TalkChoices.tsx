/**
 * The talk panel (M05c1, 10-ui-hud-xr.md 2.10): renders `mode.story.talk { talkId, npc, intent, open?, choices[{id, label, enabled, hint?}] }`
 * the story VM publishes when a `talk` objective starts. It shows the NPC's opening line from the mission lines and the outcome buttons at once
 * (no LLM before M06a3, no ink before M06a3 and M10c). A gated outcome is a disabled button with its hint beside it. A choice sends
 * `UiCommand { t: 'mode.cmd', mode: 'story', name: 'talk.result', args: { talkId, outcome, turns: 0, path: 'scripted' } }`; the VM decides the
 * rest. Keys 1 to 9 pick the matching enabled button.
 */
import type { JsonValue } from '@dv/shared';
import { useEffect, useRef } from 'preact/hooks';
import { contentText, t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';
import { formatCents } from '../i18n/index.ts';
import { speakerName, useVm } from './widgets.tsx';

export interface TalkChoice {
  id: string;
  label: string;
  enabled: boolean;
  hint?: string;
  hintParams?: Record<string, string | number>;
}

export interface TalkView {
  talkId: string;
  npc: string;
  intent?: string;
  open?: string;
  choices: TalkChoice[];
}

/** The hint text of a gated choice: a `talk.gate.*` key with its parameters, `cents` shown as money. */
export function hintText(c: TalkChoice): string {
  if (!c.hint) return '';
  const vars: Record<string, string | number> = { ...(c.hintParams ?? {}) };
  if (typeof vars['cents'] === 'number') vars['amount'] = formatCents(vars['cents']);
  return t(c.hint, vars);
}

/** The panel as a pure function of its data (the unit test renders this). */
export function TalkChoices(props: { talk: TalkView; onPick(talkId: string, outcome: string): void }) {
  const { talk } = props;
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [talk.talkId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const n = Number.parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > talk.choices.length) return;
      const c = talk.choices[n - 1];
      if (c?.enabled) {
        e.preventDefault();
        props.onPick(talk.talkId, c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [talk]);
  return (
    <section ref={root} class="dv-talk" data-testid="talk-panel" data-talk={talk.talkId} role="dialog" aria-label={t('talk.title', { npc: speakerName(talk.npc) })}>
      <h2 class="dv-talk-npc">{speakerName(talk.npc)}</h2>
      {talk.open ? <p class="dv-talk-open" data-testid="talk-open">{talk.open}</p> : null}
      {talk.intent ? <p class="dv-talk-intent" data-testid="talk-intent">{contentText(talk.intent)}</p> : null}
      <ol class="dv-talk-choices" aria-label={t('talk.pick')}>
        {talk.choices.map((c, i) => {
          const hint = hintText(c);
          return (
            <li key={c.id}>
              <button
                type="button"
                class="dv-talk-choice"
                data-testid={`talk-choice-${c.id}`}
                data-outcome={c.id}
                disabled={!c.enabled}
                aria-disabled={!c.enabled}
                {...(hint ? { 'aria-describedby': `talk-hint-${c.id}` } : {})}
                onClick={() => props.onPick(talk.talkId, c.id)}
              >
                <span class="dv-talk-key" aria-hidden="true">{i + 1}</span> {contentText(c.label)}
              </button>
              {hint ? <span id={`talk-hint-${c.id}`} class="dv-talk-hint" data-testid={`talk-hint-${c.id}`}>{hint}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Binds the panel to `mode.story.talk`; renders nothing while no talk is on. */
export function TalkPanel() {
  const { ctx } = useShell();
  const talk = useVm<JsonValue>('mode.story.talk') as unknown as TalkView | null | undefined;
  if (!talk || !Array.isArray(talk.choices)) return null;
  return (
    <TalkChoices
      talk={talk}
      onPick={(talkId, outcome) => ctx.sendUi({ t: 'mode.cmd', mode: 'story', name: 'talk.result', args: { talkId, outcome, turns: 0, path: 'scripted' } })}
    />
  );
}
