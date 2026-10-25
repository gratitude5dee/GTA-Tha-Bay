/**
 * The out-of-character safety card (M06a5, 10-ui-hud-xr.md 2.10 item 1, 04-npc.md 5.4): fixed copy with the 988 resource (US). It carries two
 * actions, Close and Resources, and nothing else on the panel can take focus while it is up (the bubble marks the rest inert).
 */
import { t } from '../i18n/index.ts';

export function SafetyCard(props: { resources: boolean; onClose(): void; onResources(): void }) {
  return (
    <section class="dv-dlg-card dv-dlg-safety" data-testid="dialogue-safety" role="alertdialog" aria-labelledby="dv-dlg-safety-title" aria-describedby="dv-dlg-safety-body">
      <h3 id="dv-dlg-safety-title" class="dv-dlg-card-title">
        {t('dialogue.safety.title')}
      </h3>
      <p id="dv-dlg-safety-body" class="dv-dlg-card-text" data-testid="dialogue-safety-body">
        {t('dialogue.safety.body')} {t('dialogue.safety.us')}
      </p>
      {props.resources ? (
        <p class="dv-dlg-card-text" id="dv-dlg-safety-resources" data-testid="dialogue-safety-resources">
          {t('dialogue.safety.resources.body')}
        </p>
      ) : null}
      <div class="dv-dlg-row">
        <button type="button" class="dv-dlg-btn dv-dlg-primary" data-testid="dialogue-safety-close" onClick={props.onClose}>
          {t('dialogue.safety.close')}
        </button>
        <button
          type="button"
          class="dv-dlg-btn"
          data-testid="dialogue-safety-resources-btn"
          aria-expanded={props.resources ? 'true' : 'false'}
          {...(props.resources ? { 'aria-controls': 'dv-dlg-safety-resources' } : {})}
          onClick={props.onResources}
        >
          {t('dialogue.safety.resources')}
        </button>
      </div>
    </section>
  );
}
