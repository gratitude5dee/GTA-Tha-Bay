/**
 * `DialogueBubble` (M06a5, 10-ui-hud-xr.md 2.10 item 1): the real interface for talking to an NPC. It replaces the M06a3 debug overlay.
 * The speaker's name, the line (revealed no faster than its audio), the intent choices and a typed line, the persistent AI character
 * badge, the report control (only once route 41 exists) and Close. The offline ink line looks like any other line: no error state.
 * Focus order is speaker, line, choices, report, close. Esc and `UiBack` close it.
 *
 * `DialogueBubble` is plain markup over `DialogueView`; `DialoguePanel` binds it to the session in the registry and to the page.
 * @ugc-surface (the lines are generated; the report control is the kit `ReportButton`).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n/index.ts';
import { ReportButton } from '../kit/report.tsx';
import { DIALOGUE_REPORT_CATEGORIES, chatTurnId, dialogueCapabilities } from './capabilities.ts';
import { IntentChoices } from './IntentChoices.tsx';
import { LikenessCard } from './LikenessCard.tsx';
import { SafetyCard } from './SafetyCard.tsx';
import { getDialogueSession, onDialogueSession, type DialogueSession, type DialogueView, type PanelIntent } from './session.ts';
import type { ReportCategory } from './capabilities.ts';

export interface DialogueActions {
  choose(intent: PanelIntent): void;
  send(text: string): void;
  showFull(): void;
  close(): void;
  dismissLikeness(): void;
  toggleResources(): void;
  report(category: ReportCategory): void;
}

/** The report control shows when the capability is on and the line came from a model turn (an ink line has no encounter to report). */
export function showsReport(view: DialogueView, reportsOn: boolean = dialogueCapabilities.reports): boolean {
  return reportsOn && view.turn !== null && !view.fallback && view.full !== '';
}

export function DialogueBubble(props: { view: DialogueView; actions: DialogueActions; reportsOn?: boolean }) {
  const { view, actions } = props;
  const safety = view.card?.kind === 'safety' ? view.card : null;
  const likeness = view.card?.kind === 'likeness' ? view.card : null;
  const waiting = view.busy && view.full === '';
  const turn = view.turn;
  return (
    <section
      class="dv-dlg"
      data-testid="dialogue-panel"
      data-npc={view.npcId}
      data-fallback={view.fallback ? '1' : '0'}
      data-closing={view.closing ? '1' : '0'}
      role="dialog"
      aria-label={t('dialogue.title', { npc: view.speaker })}
    >
      {safety ? <SafetyCard resources={safety.resources} onClose={actions.close} onResources={actions.toggleResources} /> : null}
      <div class="dv-dlg-body" {...(safety ? { inert: true } : {})}>
        <header class="dv-dlg-head">
          <h2 class="dv-dlg-speaker" id="dv-dlg-speaker" data-testid="dialogue-speaker" tabIndex={-1}>
            {view.speaker}
          </h2>
          {view.badge ? (
            <span class="dv-dlg-badge" data-testid="dialogue-ai-badge" title={t('dialogue.badge.hint')}>
              <span class="dv-dlg-badge-icon" aria-hidden="true">
                {'✦'}
              </span>
              {t('dialogue.badge')}
            </span>
          ) : null}
        </header>
        {likeness ? (
          <LikenessCard disclaimer={likeness.disclaimer} name={likeness.name} onContinue={actions.dismissLikeness} />
        ) : (
          <>
            <p
              class="dv-dlg-line"
              data-testid="dialogue-line"
              data-revealing={view.revealing ? '1' : '0'}
              tabIndex={0}
              aria-live="polite"
              aria-busy={view.busy ? 'true' : 'false'}
              aria-labelledby="dv-dlg-speaker"
            >
              {waiting ? <span class="dv-dlg-wait">{t('dialogue.waiting')}</span> : view.shown}
            </p>
            {view.revealing ? (
              <button type="button" class="dv-dlg-btn dv-dlg-showfull" data-testid="dialogue-showfull" onClick={actions.showFull}>
                {t('dialogue.showFull')}
              </button>
            ) : null}
            <IntentChoices choices={view.choices} busy={view.busy} canType={view.canType} onChoose={actions.choose} onSend={actions.send} />
            {showsReport(view, props.reportsOn) && turn ? (
              <div class="dv-dlg-report" data-testid="dialogue-report">
                {view.reported ? (
                  <span class="dv-dlg-reported" role="status">
                    {t('report.thanks')}
                  </span>
                ) : (
                  <ReportButton
                    target={chatTurnId(turn.npcId, turn.encounterId, turn.turnIndex)}
                    label={t('dialogue.report')}
                    categories={DIALOGUE_REPORT_CATEGORIES}
                    onReport={(c) => actions.report(c as ReportCategory)}
                  />
                )}
              </div>
            ) : null}
          </>
        )}
        <button type="button" class="dv-dlg-btn dv-dlg-close" data-testid="dialogue-close" onClick={actions.close}>
          {t('dialogue.close')}
        </button>
      </div>
    </section>
  );
}

function actionsOf(session: DialogueSession): DialogueActions {
  return {
    choose: (i) => void session.choose(i),
    send: (text) => void session.sendText(text),
    showFull: () => session.showFull(),
    close: () => session.close(),
    dismissLikeness: () => session.dismissCard(),
    toggleResources: () => session.toggleResources(),
    report: (c) => void session.report(c),
  };
}

/** The bound panel: renders nothing until a session is registered and open. Mounted once, at the root of the shell. */
export function DialoguePanel() {
  const [session, setSession] = useState<DialogueSession | null>(() => getDialogueSession());
  const [view, setView] = useState<DialogueView | null>(() => getDialogueSession()?.state() ?? null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => onDialogueSession(() => setSession(getDialogueSession())), []);
  useEffect(() => {
    setView(session?.state() ?? null);
    return session?.subscribe(() => setView(session.state()));
  }, [session]);
  const open = view?.open === true && session !== null;
  // Esc closes the panel before the shell's own back handler sees it (a modal on top, like the report dialog, keeps its own Esc).
  useEffect(() => {
    if (!open || !session) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || document.querySelector('[data-dv-modal]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      session.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, session]);
  // The minimap steps aside while the panel is up (M06a5 risks); the first focus goes to the speaker, then Tab walks the panel in order.
  useEffect(() => {
    if (!open) return undefined;
    document.documentElement.dataset['dvDialogue'] = 'open';
    root.current?.querySelector<HTMLElement>('[data-testid="dialogue-speaker"]')?.focus({ preventScroll: true });
    return () => {
      delete document.documentElement.dataset['dvDialogue'];
    };
  }, [open, view?.npcId]);
  // The safety card takes focus when it appears: Close and Resources are the only controls that can be reached.
  const card = view?.card?.kind;
  useEffect(() => {
    if (open && card === 'safety') root.current?.querySelector<HTMLElement>('[data-testid="dialogue-safety-close"]')?.focus({ preventScroll: true });
  }, [open, card]);
  if (!open || !view || !session) return null;
  return (
    <div ref={root} class="dv-dlg-host" data-testid="dialogue-host">
      <DialogueBubble view={view} actions={actionsOf(session)} />
    </div>
  );
}
