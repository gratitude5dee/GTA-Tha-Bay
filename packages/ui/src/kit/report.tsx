/**
 * `ReportButton` and `UgcSurface` (10-ui-hud-xr.md 2.10, "Report button"). A component that shows user-generated content wraps its
 * output in `UgcSurface`, which always renders `ReportButton`; the `ugc-surface` unit test fails any source file that tags a component
 * `@ugc-surface` without using the wrapper or the button (M06a5 and M13b1 rely on both). The dialog is a stub until M13b1: it takes a
 * reason, and `copyright` opens `/legal/dmca`.
 */
import type { ComponentChildren } from 'preact';
import { t } from '../i18n/index.ts';
import { Button } from './widgets.tsx';
import { useShell } from '../shell/context.tsx';

export const REPORT_REASONS = ['inappropriate', 'harassment', 'copyright', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** What a reason does: `copyright` goes to the DMCA page, the rest are acknowledged (the intake route arrives with M13b1). */
export function reportOutcome(reason: ReportReason): { kind: 'legal'; doc: 'dmca' } | { kind: 'ack' } {
  return reason === 'copyright' ? { kind: 'legal', doc: 'dmca' } : { kind: 'ack' };
}

/**
 * With `onReport` (M06a5) the dialog lists `categories` instead of the four reasons and hands the pick to the caller, which files the C12
 * `ReportReq`; the label of a category is `report.category.<value>`. Without it, the stub flow above runs.
 */
export function ReportButton(props: { target: string; label?: string; categories?: readonly string[]; onReport?: (category: string) => void | Promise<unknown> }) {
  const { shell } = useShell();
  const open = (): void => {
    const pick = props.onReport;
    const categories = props.categories;
    if (pick && categories) {
      void shell
        .modal<string>({
          titleKey: 'report.title',
          body: (close) => (
            <div class="dv-form" data-testid="report-dialog" data-target={props.target}>
              <p>{t('report.lead.live')}</p>
              {categories.map((c) => (
                <Button key={c} id={`report-${c}`} label={t(`report.category.${c}`)} onPress={() => close(c)} />
              ))}
            </div>
          ),
        })
        .then((category) => {
          if (!category) return;
          void Promise.resolve(pick(category)).then(() => shell.toast({ id: 'report.thanks', kind: 'success', text: 'report.thanks' }));
        });
      return;
    }
    void shell
      .modal<ReportReason>({
        titleKey: 'report.title',
        body: (close) => (
          <div class="dv-form" data-testid="report-dialog" data-target={props.target}>
            <p>{t('report.lead')}</p>
            {REPORT_REASONS.map((r) => (
              <Button key={r} id={`report-${r}`} label={t(`report.reason.${r}`)} onPress={() => close(r)} />
            ))}
            <p class="dv-muted">{t('report.stub')}</p>
          </div>
        ),
      })
      .then((reason) => {
        if (!reason) return;
        const out = reportOutcome(reason);
        if (out.kind === 'legal') shell.navigate('legal', { doc: out.doc });
        else shell.toast({ id: 'report.thanks', kind: 'success', text: 'report.thanks' });
      });
  };
  return <Button id="report" label={props.label ?? t('report.button')} onPress={open} testId="report-button" icon={'⚑'} />;
}

/** Wraps user-generated content; the report button is part of the wrapper, so a surface cannot forget it. */
export function UgcSurface(props: { target: string; children: ComponentChildren }) {
  return (
    <div class="dv-ugc" data-ugc-surface="1" data-target={props.target}>
      {props.children}
      <ReportButton target={props.target} />
    </div>
  );
}
