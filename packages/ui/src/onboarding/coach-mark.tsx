/**
 * Install prompts and the welcome-back line (10-ui-hud-xr.md 2.11 rules 2, 3 and 8).
 *  - iOS coach mark: a one-time card "Share, then Add to Home Screen" on the first main-menu visit in a Safari tab (not standalone). No
 *    `beforeinstallprompt` exists on Safari. The dismissal (and the first display) is remembered in `UiPrefs.dismissed`, every storage access
 *    in try/catch; a throwing store leaves the page working. A permanent entry stays in Settings > Install and storage.
 *  - Chromium install chip: shown while the platform holds a deferred `beforeinstallprompt`; after a dismissal it does not return in the session.
 *  - Welcome-back line: the last save status; after `abnormal_exit` a one-time notice offers lower quality (S11 demotion text).
 */
import { useEffect, useState } from 'preact/hooks';
import type { LastSaveStatus } from '@dv/shared';
import { formatDate, t } from '../i18n/index.ts';
import { Button } from '../kit/widgets.tsx';
import { useShell } from '../shell/context.tsx';

export const COACH_ID = 'coach.ios';

/** The conditions of the coach mark, separate from the DOM so the unit test can drive them. */
export function coachApplies(env: { isIos: boolean; standalone: boolean; dismissed: readonly string[] }): boolean {
  return env.isIos && !env.standalone && !env.dismissed.includes(COACH_ID);
}

export function CoachMark() {
  const { ctx } = useShell();
  const install = ctx.platform?.install;
  const prefs = ctx.props.prefs;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!install) return;
    let dismissed: readonly string[] = [];
    try {
      dismissed = prefs.get().dismissed;
    } catch {
      dismissed = [];
    }
    if (!coachApplies({ isIos: install.isIos, standalone: install.standalone, dismissed })) return;
    setShow(true);
    // Shown once: the first display is remembered at once, so the second visit to the menu does not show it again.
    try {
      prefs.set({ dismissed: [...dismissed, COACH_ID] });
    } catch {
      // a store that throws leaves the card up for this visit only
    }
  }, [install]);
  if (!show) return null;
  return (
    <div class="dv-coach" role="dialog" aria-label={t('coach.title')} data-testid="coach-mark">
      <strong>{t('coach.title')}</strong>
      <p>{t('coach.body')}</p>
      <Button id="coach-close" label={t('coach.close')} onPress={() => setShow(false)} testId="coach-close" />
    </div>
  );
}

/** A small "Install app" chip on the main menu while the browser offers installation (Chromium, Quest Browser). */
export function InstallChip() {
  const { ctx } = useShell();
  const install = ctx.platform?.install;
  const [can, setCan] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!install) return undefined;
    const check = (): void => setCan(install.canPrompt());
    check();
    const id = setInterval(check, 1500);
    return () => clearInterval(id);
  }, [install]);
  if (!install || !can || gone || install.standalone) return null;
  return (
    <div class="dv-install-chip" data-testid="install-chip">
      <Button id="install-app" label={t('install.chip')} onPress={() => void install.prompt().finally(() => setGone(true))} testId="install-chip-button" />
      <Button id="install-later" label={t('install.later')} onPress={() => setGone(true)} testId="install-chip-later" />
    </div>
  );
}

/** "Last saved ..." under the menu; after an abnormal exit a one-time notice (S11 text). */
export function WelcomeBack(props: { status: LastSaveStatus | null; abnormalExit: boolean }) {
  const s = props.status;
  return (
    <p class="dv-muted dv-welcome" data-testid="welcome-back">
      {s && !s.error ? t('welcome.lastSave', { when: formatDate(s.at) }) : t('welcome.noSave')}
      {props.abnormalExit ? <span data-testid="welcome-abnormal">{` ${t('welcome.abnormal')}`}</span> : null}
    </p>
  );
}
