/**
 * Title, age screen, blocked screen and Terms card (10-ui-pages.md sections 2.3 and 2.4). `AgeGate` has no dependency on the shell,
 * so an island entry (M12a2: the `/account/` page) can import it without the game bundle.
 */
import { useEffect, useState } from 'preact/hooks';
import type { PlatformSettings } from '@dv/shared';
import { BRAND } from '../../../../config/brand.ts';
import { TERMS_VERSION } from '../../../../config/terms.ts';
import { getLang, t } from '../i18n/index.ts';
import { Link, useShell } from '../shell/context.tsx';
import type { AgeBracket, PageProps, PlatformPort, PrefsStore } from '../shell/types.ts';

// ---- age rules (pure, unit-tested)

export type DobField = 'month' | 'day' | 'year';

/** The order of the month, day and year fields for a locale (`Intl.DateTimeFormat(...).formatToParts`). */
export function fieldOrder(locale: string): DobField[] {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(2000, 10, 22));
    const order = parts.map((p) => p.type).filter((x): x is DobField => x === 'month' || x === 'day' || x === 'year');
    if (order.length === 3) return order;
  } catch {
    // an unknown locale tag falls back to month, day, year
  }
  return ['month', 'day', 'year'];
}

export interface Dob { y: number; m: number; d: number }

const daysIn = (y: number, m: number): number => new Date(y, m, 0).getDate();

/** A real calendar date, not in the future, year 1900 or later; null otherwise. The entered date is never kept. */
export function parseDob(month: string, day: string, year: string, today: Date): Dob | null {
  if (!/^\d{1,2}$/.test(month.trim()) || !/^\d{1,2}$/.test(day.trim()) || !/^\d{4}$/.test(year.trim())) return null;
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  if (y > ty || (y === ty && (m > tm || (m === tm && d > td)))) return null;
  return { y, m, d };
}

/** Whole years on `today` (the birthday counts on the day itself). */
export function ageOn(dob: Dob, today: Date): number {
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  return ty - dob.y - (tm < dob.m || (tm === dob.m && td < dob.d) ? 1 : 0);
}

export const bracketOf = (age: number): AgeBracket => (age >= 18 ? '18p' : 'u18');

/** Writes the outcome; M04b3 rebinds `attest` to `IdentityService.attestAge`. No call leaves the device for a blocked player. */
export interface AgeAttestationPort {
  attest(bracket: '18p'): void;
  block(): void;
}

/** OS age signals (California AB 1043, from 2027-01-01). The v1 provider returns null; M14b3 wires a real one. */
export interface AgeSignalProvider {
  read(): Promise<AgeBracket | null>;
}
export const NO_AGE_SIGNAL: AgeSignalProvider = { read: () => Promise.resolve(null) };

export function AgeGate(props: {
  locale?: string;
  today?: () => Date;
  signal?: AgeSignalProvider;
  onPass(): void;
  onBlock(): void;
}) {
  const locale = props.locale ?? getLang();
  const [vals, setVals] = useState<Record<DobField, string>>({ month: '', day: '', year: '' });
  const [error, setError] = useState(false);
  const order = fieldOrder(locale);
  const label: Record<DobField, string> = { month: t('age.month'), day: t('age.day'), year: t('age.year') };
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const today = props.today ? props.today() : new Date();
    const dob = parseDob(vals.month, vals.day, vals.year, today);
    if (!dob) {
      setError(true);
      return;
    }
    setError(false);
    // An OS signal under 18 overrides the typed date.
    const signal = await (props.signal ?? NO_AGE_SIGNAL).read();
    if (signal === 'u18' || bracketOf(ageOn(dob, today)) === 'u18') props.onBlock();
    else props.onPass();
  };
  return (
    <form class="dv-form dv-age" data-testid="age-form" onSubmit={(e) => void submit(e)} autocomplete="off" noValidate>
      <h1>{t('age.title')}</h1>
      <div class="dv-dob" role="group" aria-label={t('age.title')}>
        {order.map((f) => (
          <label key={f} class="dv-field">
            <span>{label[f]}</span>
            <input
              class="dv-input"
              data-testid={`age-${f}`}
              data-fid={`age.${f}`}
              inputMode="numeric"
              autocomplete="off"
              maxLength={f === 'year' ? 4 : 2}
              value={vals[f]}
              onInput={(ev) => setVals({ ...vals, [f]: (ev.currentTarget as HTMLInputElement).value })}
            />
          </label>
        ))}
      </div>
      {error ? (
        <p class="dv-error" role="alert" data-testid="age-error">
          {t('age.invalid')}
        </p>
      ) : null}
      <button type="submit" class="dv-btn dv-btn-primary" data-testid="age-continue" data-fid="age.continue">
        {t('common.continue')}
      </button>
    </form>
  );
}

// ---- Title

const isModifier = (e: KeyboardEvent): boolean => e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.ctrlKey || e.altKey || e.metaKey;

export function TitlePage(_props: PageProps) {
  const { ctx } = useShell();
  const start = (): void => {
    ctx.engine?.audioUnlock();
    ctx.fire('gesture');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (isModifier(e) || e.key === 'Escape' || target?.closest('a,button')) return;
      start();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const device = ctx.engine?.activeDevice() ?? 'kbm';
  return (
    <main
      class="dv-screen dv-title"
      data-testid="title"
      onPointerUp={(e) => {
        if (!(e.target as HTMLElement).closest('a,button')) start();
      }}
    >
      <h1 data-testid="title-name">{t('title.name')}</h1>
      <p>{BRAND.tagline}</p>
      <button type="button" class="dv-btn dv-btn-primary dv-title-start" data-testid="title-start" data-fid="title.start" autoFocus onClick={start}>
        {device === 'touch' ? t('title.start') : t('title.press')}
      </button>
      <nav class="dv-nav" aria-label={t('title.nav')}>
        {/* /account/ is the non-isolated island (M00e): a full navigation, never a SPA route. */}
        <a
          class="dv-link"
          href="/account/"
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            location.assign('/account/');
          }}
          data-testid="title-account"
        >
          {t('title.account')}
        </a>
        <Link to="credits">{t('title.credits')}</Link>
        <Link to="legal" params={{ doc: 'terms' }}>{t('title.legal')}</Link>
      </nav>
      <small class="dv-build" data-testid="build-id">{t('common.build', { build: ctx.props.build })}</small>
    </main>
  );
}

// ---- Age page

export function AgePage(_props: PageProps) {
  const { ctx } = useShell();
  const port: AgeAttestationPort = {
    attest: () => {
      ctx.props.prefs.set({ age: { attested: '18p', attestedAt: Date.now(), blocked: false } });
      ctx.props.onAttest?.('18p');
    },
    block: () => ctx.props.prefs.set({ age: { attested: null, attestedAt: null, blocked: true } }),
  };
  return (
    <main class="dv-screen dv-age-screen" data-testid="age">
      <AgeGate
        onPass={() => {
          port.attest('18p');
          ctx.fire('agePass');
        }}
        onBlock={() => {
          port.block();
          ctx.fire('ageFail');
        }}
      />
    </main>
  );
}

// ---- Blocked page

/** One neutral message for every blocked case: no reason, no retry, no back; links only to the public Privacy and Legal pages. */
export function BlockedPage(_props: PageProps) {
  return (
    <main class="dv-screen dv-blocked" data-testid="blocked">
      <h1>{t('blocked.title')}</h1>
      <nav class="dv-nav">
        <a class="dv-link" href="/legal/privacy" data-testid="blocked-privacy">{t('legal.doc.privacy')}</a>
        <a class="dv-link" href="/legal/terms" data-testid="blocked-legal">{t('title.legal')}</a>
      </nav>
    </main>
  );
}

// ---- Terms card

export const defaultConsent = (): PlatformSettings['telemetryConsent'] => ({ diagnostics: true, analytics: true });

/**
 * The Terms card's "Agree and continue" (rules 6 and 7): the two toggles go to `PlatformSettings.telemetryConsent` (device scope), the
 * accepted version and time to `UiPrefs`. Before the platform exists the consent is handed to the app, which applies it when it does.
 */
export function acceptTerms(d: {
  platform: PlatformPort | null;
  prefs: PrefsStore;
  consent: PlatformSettings['telemetryConsent'];
  onConsent?: ((c: PlatformSettings['telemetryConsent']) => void) | undefined;
  now?: () => number;
}): void {
  if (d.platform) {
    void d.platform.update({ telemetryConsent: d.consent });
    d.platform.applyConsent(d.consent);
  } else d.onConsent?.(d.consent);
  d.prefs.set({ terms: { version: TERMS_VERSION, acceptedAt: (d.now ?? Date.now)() } });
}

export function TermsPage(_props: PageProps) {
  const { ctx } = useShell();
  const [consent, setConsent] = useState<PlatformSettings['telemetryConsent']>(() => ctx.platform?.settings().telemetryConsent ?? defaultConsent());
  const accept = (): void => {
    acceptTerms({ platform: ctx.platform, prefs: ctx.props.prefs, consent, onConsent: ctx.props.onConsent });
    ctx.fire('termsAccept');
  };
  return (
    <main class="dv-screen dv-terms" data-testid="terms">
      <h1>{t('terms.title')}</h1>
      <div class="dv-card dv-terms-body">
        <p>
          {t('terms.links.before')} <Link to="legal" params={{ doc: 'terms' }} testId="terms-link-tos">{t('legal.doc.terms')}</Link> {t('terms.links.and')}{' '}
          <Link to="legal" params={{ doc: 'privacy' }} testId="terms-link-privacy">{t('legal.doc.privacy')}</Link>.
        </p>
        <p data-testid="terms-ai">{t('terms.ai')}</p>
        <p data-testid="terms-content">{t('terms.content')}</p>
        <p>{t('terms.telemetry')}</p>
        <fieldset class="dv-consent">
          <legend class="dv-sr">{t('terms.telemetry.legend')}</legend>
          <label class="dv-check">
            <input
              type="checkbox"
              role="switch"
              data-testid="consent-diagnostics"
              data-fid="consent.diagnostics"
              checked={consent.diagnostics}
              onChange={(e) => setConsent({ ...consent, diagnostics: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span>{t('terms.diagnostics')}</span>
          </label>
          <label class="dv-check">
            <input
              type="checkbox"
              role="switch"
              data-testid="consent-analytics"
              data-fid="consent.analytics"
              checked={consent.analytics}
              onChange={(e) => setConsent({ ...consent, analytics: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span>{t('terms.analytics')}</span>
          </label>
        </fieldset>
      </div>
      <div class="dv-actions">
        <button type="button" class="dv-btn dv-btn-secondary" data-testid="terms-decline" data-fid="terms.decline" onClick={() => ctx.fire('termsDecline')}>
          {t('terms.decline')}
        </button>
        <button type="button" class="dv-btn dv-btn-primary" data-testid="terms-accept" data-fid="terms.accept" onClick={accept}>
          {t('terms.accept')}
        </button>
      </div>
      <p class="dv-disclaimer" data-testid="terms-disclaimer">{BRAND.disclaimer}</p>
    </main>
  );
}
