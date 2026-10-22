/**
 * The mission fail panel (M05c1): the reason (a mission line) and the two commands the story VM takes after a fail, `mission.retry` (from the
 * checkpoint, or from the start when the rule says so) and `mission.quit`. Bound to the `failKey` of `hud.mission`.
 */
import { contentText, t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';

export function MissionFail(props: { fail: { reason: string; retry: string } | undefined }) {
  const { ctx } = useShell();
  const f = props.fail;
  if (!f) return null;
  const send = (name: 'mission.retry' | 'mission.quit'): void => {
    ctx.sendUi({ t: 'mode.cmd', mode: 'story', name });
  };
  return (
    <section class="dv-talk dv-fail" data-testid="mission-fail" role="alertdialog" aria-label={t('mission.fail.title')}>
      <h2 class="dv-talk-npc">{t('mission.fail.title')}</h2>
      <p class="dv-talk-open" data-testid="mission-fail-reason">{contentText(f.reason)}</p>
      <div class="dv-talk-choices">
        <button type="button" class="dv-talk-choice" data-testid="mission-retry" onClick={() => send('mission.retry')}>
          {f.retry === 'start' ? t('mission.fail.retryStart') : t('mission.fail.retry')}
        </button>
        <button type="button" class="dv-talk-choice" data-testid="mission-quit" onClick={() => send('mission.quit')}>{t('mission.fail.quit')}</button>
      </div>
    </section>
  );
}
