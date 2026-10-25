/**
 * `LikenessCard` (M06a5, 04-npc.md 5.10 item 3): shown once per save profile, before the first line, for an NPC that is not an original
 * invention. The text is fixed per disclaimer: parody, fictional, or "appears courtesy of".
 */
import { t } from '../i18n/index.ts';

export type LikenessDisclaimer = 'parody' | 'fictional' | 'courtesy';

/** The fixed text of a disclaimer. `name` fills the courtesy line. */
export function likenessText(disclaimer: LikenessDisclaimer, name: string): string {
  return t(`dialogue.likeness.${disclaimer}`, { name });
}

export function LikenessCard(props: { disclaimer: LikenessDisclaimer; name: string; onContinue(): void }) {
  return (
    <section class="dv-dlg-card dv-dlg-likeness" data-testid="dialogue-likeness" data-disclaimer={props.disclaimer} role="group" aria-labelledby="dv-dlg-likeness-text">
      <p id="dv-dlg-likeness-text" class="dv-dlg-card-text" data-testid="dialogue-likeness-text">
        {likenessText(props.disclaimer, props.name)}
      </p>
      <button type="button" class="dv-dlg-btn dv-dlg-primary" data-testid="dialogue-likeness-continue" onClick={props.onContinue}>
        {t('dialogue.likeness.continue')}
      </button>
    </section>
  );
}
