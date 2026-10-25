/**
 * The player's side of the bubble (M06a5): the intent buttons and, on flat screens, a typed line of up to 280 characters.
 * Pure markup over props, so the unit tests read the tree directly.
 */
import { t } from '../i18n/index.ts';
import type { DialogueChoice, PanelIntent } from './session.ts';
import { TEXT_MAX } from './session.ts';

export interface IntentChoicesProps {
  choices: readonly DialogueChoice[];
  /** A turn is in flight: the buttons stay, and wait. */
  busy: boolean;
  canType: boolean;
  onChoose(intent: PanelIntent): void;
  onSend(text: string): void;
}

export function IntentChoices(props: IntentChoicesProps) {
  return (
    <div class="dv-dlg-choices" data-testid="dialogue-choices">
      <ul class="dv-dlg-intents" aria-label={t('dialogue.choices')}>
        {props.choices.map((c) => (
          <li key={c.intent}>
            <button
              type="button"
              class="dv-dlg-btn dv-dlg-intent"
              data-testid={`dialogue-intent-${c.intent}`}
              data-intent={c.intent}
              aria-disabled={props.busy ? 'true' : undefined}
              onClick={() => {
                if (!props.busy) props.onChoose(c.intent);
              }}
            >
              {t(`dialogue.intent.${c.intent}`)}
            </button>
          </li>
        ))}
      </ul>
      {props.canType ? (
        <form
          class="dv-dlg-type"
          data-testid="dialogue-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement;
            const input = form.elements.namedItem('text') as HTMLInputElement | null;
            const text = input?.value ?? '';
            if (props.busy || text.trim() === '') return;
            props.onSend(text);
            if (input) input.value = '';
          }}
        >
          <label class="dv-dlg-label" for="dv-dlg-text">
            {t('dialogue.text.label')}
          </label>
          <div class="dv-dlg-typerow">
            <input
              id="dv-dlg-text"
              name="text"
              type="text"
              class="dv-dlg-input"
              data-testid="dialogue-input"
              maxLength={TEXT_MAX}
              autocomplete="off"
              placeholder={t('dialogue.text.placeholder', { max: TEXT_MAX })}
            />
            <button type="submit" class="dv-dlg-btn dv-dlg-send" data-testid="dialogue-send" aria-disabled={props.busy ? 'true' : undefined}>
              {t('dialogue.text.send')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
