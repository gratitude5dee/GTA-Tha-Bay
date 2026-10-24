/** Boot, Coming soon, Credits, Legal, Pause, Loading and Error (10-ui-pages.md sections 2.3 and 2.14). */
import { useEffect, useState } from 'preact/hooks';
import { BRAND } from '../../../../config/brand.ts';
import { PRIVACY_DOC, TERMS_DOC } from '../../../../config/terms.ts';
import worldAttribution from '../../../../config/attribution.world.json';
import { worldCreditsOf, type WorldAttributionFile, type WorldCredits } from '@dv/shared';
import { lk, t } from '../i18n/index.ts';
import { ERROR_TOPIC } from './help.tsx';
import { Button, Progress } from '../kit/widgets.tsx';
import { Link, useShell } from '../shell/context.tsx';
import { isLegalDoc, pageDef } from '../shell/registry.ts';
import type { PageProps } from '../shell/types.ts';

// ---- apiErrorToUi (10-ui-pages.md section 5.3)

export type ApiErrorCode =
  | 'unauthorized' | 'forbidden' | 'tier_required' | 'age_blocked' | 'region_blocked' | 'build_mismatch'
  | 'rate_limited' | 'quota_exhausted' | 'budget_offline' | 'kill_switched' | 'upstream_unavailable' | 'moderation_blocked' | 'internal' | 'network';

export type ApiErrorUi =
  | { kind: 'cta'; message: string }
  | { kind: 'ageExplanation'; message: string }
  | { kind: 'hideOnline'; message: string }
  | { kind: 'update'; message: string; applyAtSafePoint: true }
  | { kind: 'wait'; message: string; retryAfterMs: number }
  | { kind: 'policy'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'offline'; message: string };

/**
 * The one mapping from a `/api/v1` error to what the shell shows. `quota_exhausted`, `budget_offline`, `kill_switched`,
 * `upstream_unavailable` and network failure never open an error dialog: they select the offline path (10-ui.md section 2.3 rule 3).
 */
export function apiErrorToUi(code: ApiErrorCode | string, retryAfterMs = 0): ApiErrorUi {
  switch (code) {
    case 'unauthorized':
    case 'forbidden':
    case 'tier_required':
      return { kind: 'cta', message: lk('api.error.cta') };
    case 'age_blocked':
      return { kind: 'ageExplanation', message: lk('api.error.age') };
    case 'region_blocked':
      return { kind: 'hideOnline', message: lk('api.error.region') };
    case 'build_mismatch':
      return { kind: 'update', message: lk('api.error.update'), applyAtSafePoint: true };
    case 'rate_limited':
      return { kind: 'wait', message: lk('api.error.wait'), retryAfterMs };
    case 'moderation_blocked':
      return { kind: 'policy', message: lk('api.error.policy') };
    case 'quota_exhausted':
    case 'budget_offline':
    case 'kill_switched':
    case 'upstream_unavailable':
    case 'network':
      return { kind: 'offline', message: lk('api.error.offline') };
    default:
      return { kind: 'retry', message: lk('api.error.retry') };
  }
}

// ---- pages

export function BootPage(_props: PageProps) {
  return (
    <main class="dv-screen dv-boot" data-testid="boot">
      <p role="status" aria-live="polite">{t('boot.loading')}</p>
    </main>
  );
}

export function ComingSoonPage(props: PageProps) {
  const { shell } = useShell();
  const def = pageDef(props.page);
  return (
    <main class="dv-page" data-testid="coming-soon" data-page={props.page}>
      <h1>{def ? t(def.titleKey) : t('common.comingSoon')}</h1>
      <p>{t('soon.body')}</p>
      <div class="dv-actions">
        <Button id="back" label={t('common.back')} onPress={() => shell.back()} />
      </div>
    </main>
  );
}

/**
 * The world credits of the build (M02c2, DL-662): `/credits.json` from the build, falling back to a bundled copy of
 * `config/attribution.world.json` when the fetch fails (`pnpm dev`) and to the ODbL notice alone.
 */
export function useWorldCredits(): WorldCredits {
  const [credits, setCredits] = useState<WorldCredits>(() => worldCreditsOf(worldAttribution as unknown as WorldAttributionFile));
  useEffect(() => {
    let live = true;
    void fetch('/credits.json', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`credits.json ${r.status}`))))
      .then((doc: Partial<WorldCredits>) => {
        if (live && Array.isArray(doc.world) && typeof doc.odblNotice === 'string') setCredits({ world: doc.world, odblNotice: doc.odblNotice });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return credits;
}

export function CreditsPage(_props: PageProps) {
  const { shell } = useShell();
  const world = useWorldCredits();
  return (
    <main class="dv-page dv-credits" data-testid="credits">
      <h1>{t('credits.title')}</h1>
      <p>{t('credits.pending')}</p>
      <section>
        <h2>{t('credits.data')}</h2>
        <p>{t('credits.data.body')}</p>
        <ul class="dv-credits-world" data-testid="credits-world">
          {world.world.map((e) => (
            <li key={e.id} data-testid={`credit-${e.id}`}>
              {e.text}
              {' '}
              <small>(<a href={e.licenceUrl} rel="noreferrer noopener" target="_blank">{e.licence}</a>)</small>
            </li>
          ))}
        </ul>
        <p data-testid="odbl-notice">{world.odblNotice}</p>
      </section>
      <section>
        <h2>{t('credits.ai')}</h2>
        <p>{t('credits.ai.body')}</p>
      </section>
      <p class="dv-disclaimer" data-testid="disclaimer">
        {BRAND.disclaimer}
      </p>
      <nav class="dv-nav">
        <Link to="legal" params={{ doc: 'terms' }}>{t('legal.doc.terms')}</Link>
        <Link to="legal" params={{ doc: 'privacy' }}>{t('legal.doc.privacy')}</Link>
        <Button id="back" label={t('credits.back')} onPress={() => shell.back()} testId="credits-back" />
      </nav>
    </main>
  );
}

/** Replaces the `{brand}` and `{contact}` placeholders of a legal text. */
export function legalText(s: string): string {
  return s.replace(/\{brand\}/g, BRAND.displayName).replace(/\{contact\}/g, t('legal.contact.text'));
}

export function LegalPage(props: PageProps) {
  const { shell } = useShell();
  const doc = props.params['doc'] ?? 'terms';
  const known = isLegalDoc(doc);
  const body = doc === 'terms' ? TERMS_DOC : doc === 'privacy' ? PRIVACY_DOC : null;
  const titleKey = known ? `legal.doc.${doc}` : lk('legal.notFound');
  return (
    <main class="dv-page dv-legal" data-testid="legal" data-doc={doc}>
      <h1>{t(titleKey)}</h1>
      {known && (!body || !body.counselReviewed) ? <p data-testid="legal-pending">{t('legal.pending')}</p> : null}
      {body
        ? body.sections.map((s) => (
            <section key={s.id}>
              <h2>{legalText(s.heading)}</h2>
              {s.paragraphs.map((p, i) => (
                <p key={i}>{legalText(p)}</p>
              ))}
            </section>
          ))
        : null}
      <Button id="back" label={t('legal.back')} onPress={() => shell.back()} testId="legal-back" />
    </main>
  );
}

const TIPS = [lk('loading.tip.1'), lk('loading.tip.2'), lk('loading.tip.3')];

export function LoadingPage(_props: PageProps) {
  const { ctx } = useShell();
  const [tip, setTip] = useState(0);
  const calm = ctx.settings?.accessibility.reducedMotion === true || !ctx.props.prefs.get().showTips;
  useEffect(() => {
    if (calm) return undefined;
    const id = setInterval(() => setTip((n) => (n + 1) % TIPS.length), 8000);
    return () => clearInterval(id);
  }, [calm]);
  return (
    <main class="dv-screen dv-loading" data-testid="loading">
      <h1>{t('loading.title')}</h1>
      <Progress value={0.5} label={t('loading.title')} />
      {calm ? null : <p data-testid="loading-tip">{t(TIPS[tip] as string)}</p>}
      <Button id="loading-cancel" label={t('common.cancel')} onPress={() => ctx.sendUi({ t: 'mode.quit' })} testId="loading-cancel" />
    </main>
  );
}

export type ErrorKind = 'gpu-init' | 'wasm-load' | 'sim-crash' | 'storage-unavailable' | 'region-blocked';
export const ERROR_KINDS: readonly ErrorKind[] = ['gpu-init', 'wasm-load', 'sim-crash', 'storage-unavailable', 'region-blocked'];

export function ErrorPage(props: PageProps) {
  const { shell, ctx } = useShell();
  const kind = (ERROR_KINDS as readonly string[]).includes(props.params['kind'] ?? '') ? (props.params['kind'] as ErrorKind) : 'sim-crash';
  const [copied, setCopied] = useState(false);
  return (
    <main class="dv-screen dv-error-page" data-testid="error" data-kind={kind}>
      <h1>{t('error.title')}</h1>
      <p>{t(`error.kind.${kind}`)}</p>
      <p class="dv-muted" data-testid="error-code">{t('error.code', { code: kind })}</p>
      <div class="dv-actions">
        <Button
          id="copy-diagnostics"
          label={copied ? t('error.copied') : t('error.copy')}
          onPress={() => {
            void navigator.clipboard?.writeText(ctx.props.diagnostics()).then(() => setCopied(true), () => setCopied(false));
          }}
        />
        <Button id="error-help" label={t('nav.help')} onPress={() => shell.navigate('help', { topic: ERROR_TOPIC[kind] })} />
      </div>
    </main>
  );
}
