/**
 * The /account/ island (M00e item 10): a plain HTML page with one Preact tree. It is not cross-origin isolated, has no game
 * canvas and loads no game bundle; every link out of it is a full navigation. The access token stays in memory, the refresh
 * token is the HttpOnly cookie dv-rt, and the browser never calls Supabase (10-ui-pages.md section 2.7).
 */
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AgeBracket, LegalDocRes, PasswordExportRes } from '@dv/shared';
import { t, type LocKey } from '@dv/ui/i18n';
import '@dv/ui/tokens.css';
import '@dv/ui/shell.css';
import { BRAND } from '../../../../config/brand.ts';
import { browserAgeBlockStore } from './age-block.ts';
import { bracketFor, deleteConfirmed, fieldOrder, parseField, type DateField } from './age.ts';
import { browserDeps, createAccountApi, purgeLegacySession, type AccountApi, type ApiResult, type SessionState } from './api.ts';

type View =
  | { kind: 'loading' }
  | { kind: 'blocked' }
  | { kind: 'signedIn' }
  | { kind: 'signIn' }
  | { kind: 'create' }
  | { kind: 'age'; purpose: 'create' | 'terms' }
  | { kind: 'terms'; purpose: 'create' | 'terms'; bracket: AgeBracket };

function errorKey(r: Extract<ApiResult<unknown>, { ok: false }>, context: 'login' | 'signup' | 'other'): LocKey {
  switch (r.code) {
    case 'network':
      return 'account.error.network';
    case 'rate_limited':
      return 'account.error.rate';
    case 'unauthorized':
      return context === 'login' ? 'account.error.credentials' : 'account.error.generic';
    case 'conflict':
      return 'account.error.taken';
    case 'upstream_unavailable':
      return 'account.error.upstream';
    case 'feature_disabled':
      return 'account.error.disabled';
    case 'bad_request':
      if (/not available/i.test(r.message)) return 'account.error.unavailable';
      if (/password/i.test(r.message)) return 'account.error.password';
      if (/terms/i.test(r.message)) return 'account.error.terms';
      return 'account.error.generic';
    default:
      return 'account.error.generic';
  }
}

const fill = (text: string): string => text.replaceAll('{brand}', BRAND.displayName);

function Doc(props: { doc: LegalDocRes }) {
  return (
    <section class="dv-doc" data-testid={`doc-${props.doc.doc}`}>
      {props.doc.sections.map((s) => (
        <div key={s.id}>
          <h3>{fill(s.heading)}</h3>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{fill(p)}</p>
          ))}
        </div>
      ))}
    </section>
  );
}

function BackLink() {
  // A full navigation: the title page is cross-origin isolated and this page is not.
  return (
    <a class="dv-link" href="/" data-testid="account-back">
      {t('account.back')}
    </a>
  );
}

/** Three empty numeric fields in locale order and no text that states a threshold. */
function AgeScreen(props: { onBracket: (b: AgeBracket) => void }) {
  const order = useMemo(() => fieldOrder(typeof navigator === 'undefined' ? undefined : navigator.language), []);
  const [values, setValues] = useState<Record<DateField, string>>({ month: '', day: '', year: '' });
  const [invalid, setInvalid] = useState(false);
  const label: Record<DateField, LocKey> = { month: 'account.age.month', day: 'account.age.day', year: 'account.age.year' };
  return (
    <main class="dv-screen dv-account" data-testid="account-age">
      <h1>{t('account.age.title')}</h1>
      <form
        class="dv-form"
        onSubmit={(e) => {
          e.preventDefault();
          const bracket = bracketFor(
            { month: parseField(values.month), day: parseField(values.day), year: parseField(values.year) },
            new Date(),
          );
          if (bracket === null) {
            setInvalid(true);
            return;
          }
          // The date is not kept: only the bracket leaves this screen.
          setValues({ month: '', day: '', year: '' });
          props.onBracket(bracket);
        }}
      >
        <div class="dv-nav">
          {order.map((f) => (
            <label class="dv-field" key={f}>
              <span>{t(label[f])}</span>
              <input
                class="dv-input"
                name={`dob-${f}`}
                inputMode="numeric"
                autocomplete="off"
                maxLength={f === 'year' ? 4 : 2}
                size={f === 'year' ? 5 : 3}
                value={values[f]}
                onInput={(e) => setValues({ ...values, [f]: (e.target as HTMLInputElement).value })}
                data-testid={`age-${f}`}
              />
            </label>
          ))}
        </div>
        {invalid ? (
          <p class="dv-error" role="alert" data-testid="age-invalid">
            {t('account.age.invalid')}
          </p>
        ) : null}
        <button type="submit" class="dv-button" data-testid="age-continue">
          {t('account.continue')}
        </button>
      </form>
    </main>
  );
}

function Blocked() {
  return (
    <main class="dv-screen dv-account" data-testid="account-blocked">
      <h1>{t('account.age.blocked')}</h1>
      <nav class="dv-nav">
        <a class="dv-link" href="/legal/privacy">
          {t('legal.doc.privacy')}
        </a>
        <a class="dv-link" href="/legal/terms">
          {t('legal.doc.terms')}
        </a>
      </nav>
    </main>
  );
}

function SignedIn(props: { api: AccountApi; session: SessionState; contact: () => Promise<string>; onSignedOut: (notice?: string) => void }) {
  const { api, session } = props;
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [exported, setExported] = useState<PasswordExportRes | null>(null);

  const remove = async () => {
    setBusy(true);
    const r = await api.deleteAccount();
    setBusy(false);
    if (r.ok) {
      props.onSignedOut(t('account.delete.done'));
    } else if (r.code === 'feature_disabled') {
      setNote(t('account.delete.contact', { contact: await props.contact() }));
    } else {
      setNote(t(errorKey(r, 'other')));
    }
  };

  const exportData = async () => {
    setBusy(true);
    const r = await api.exportData();
    setBusy(false);
    if (r.ok) setExported(r.data);
    else if (r.code === 'feature_disabled') setNote(t('account.export.contact', { contact: await props.contact() }));
    else if (r.termsRequired) setNote(t('account.export.terms'));
    else setNote(t(errorKey(r, 'other')));
  };

  return (
    <main class="dv-screen dv-account" data-testid="account">
      <h1>{t('account.title')}</h1>
      <p data-testid="account-signed-in">{t('account.signedIn', { name: session.user.username })}</p>
      <div class="dv-nav">
        <button
          type="button"
          class="dv-button"
          onClick={async () => {
            await api.logout();
            props.onSignedOut();
          }}
          data-testid="account-signout"
        >
          {t('account.signOut')}
        </button>
        <BackLink />
      </div>
      <div class="dv-nav">
        <button type="button" class="dv-link" disabled={busy} onClick={() => void exportData()} data-testid="account-export">
          {t('account.export')}
        </button>
        <button type="button" class="dv-link" onClick={() => setConfirming(true)} data-testid="account-delete">
          {t('account.delete')}
        </button>
      </div>
      {exported ? (
        <pre class="dv-diagnostics" data-testid="account-export-data">
          {JSON.stringify(exported, null, 2)}
        </pre>
      ) : null}
      {confirming ? (
        <form
          class="dv-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (deleteConfirmed(typed, session.user.username)) void remove();
          }}
        >
          <label class="dv-field">
            <span>{t('account.delete.confirm')}</span>
            <input
              class="dv-input"
              name="confirm"
              autocomplete="off"
              autocapitalize="none"
              value={typed}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              data-testid="account-delete-confirm"
            />
          </label>
          <div class="dv-nav">
            <button
              type="submit"
              class="dv-button"
              disabled={busy || !deleteConfirmed(typed, session.user.username)}
              data-testid="account-delete-go"
            >
              {t('account.delete.go')}
            </button>
            <button type="button" class="dv-link" onClick={() => (setConfirming(false), setTyped(''))}>
              {t('account.delete.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {note ? (
        <p role="status" data-testid="account-note">
          {note}
        </p>
      ) : null}
    </main>
  );
}

export function AccountIsland(props: { api: AccountApi; onSession: (fn: (s: SessionState | null) => void) => () => void }) {
  const { api } = props;
  const blockStore = useMemo(() => browserAgeBlockStore(), []);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [canCreate, setCanCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [doc, setDoc] = useState<{ terms: LegalDocRes; privacy: LegalDocRes } | null>(null);
  const [docError, setDocError] = useState(false);
  const termsVersionRequired = useRef<string | null>(null);
  const contactCache = useRef<string | null>(null);

  // Mount: the under-18 flag first, then the cookie session, then the create switch from /boot.
  useEffect(() => {
    let live = true;
    void (async () => {
      if (await blockStore.isBlocked()) {
        if (live) setView({ kind: 'blocked' });
        return;
      }
      const refreshed = await api.refresh();
      if (!live) return;
      if (refreshed.ok) {
        setSession(refreshed.data);
        setView({ kind: 'signedIn' });
      } else {
        setView({ kind: 'signIn' });
      }
      const boot = await api.boot();
      if (live && boot.ok) setCanCreate(boot.data.flags['auth.password'] === true);
    })();
    return () => {
      live = false;
    };
  }, []);

  // A refresh timer that fails ends the session: back to the sign-in form.
  useEffect(
    () =>
      props.onSession((s) => {
        setSession(s);
        if (s === null) setView((v) => (v.kind === 'signedIn' ? { kind: 'signIn' } : v));
      }),
    [],
  );

  const loadDocs = async (): Promise<boolean> => {
    if (doc) return true;
    setDocError(false);
    const [terms, privacy] = await Promise.all([api.legal('terms'), api.legal('privacy')]);
    if (terms.ok && privacy.ok) {
      setDoc({ terms: terms.data, privacy: privacy.data });
      return true;
    }
    setDocError(true);
    return false;
  };

  const contact = async (): Promise<string> => {
    if (contactCache.current !== null) return contactCache.current;
    const r = await api.legal('privacy');
    const line = r.ok ? (r.data.sections.find((s) => s.id === 'contact')?.paragraphs[0] ?? '') : '';
    contactCache.current = fill(line);
    return contactCache.current;
  };

  const block = async () => {
    await blockStore.block();
    setPassword('');
    setView({ kind: 'blocked' });
  };

  const afterSession = (s: SessionState) => {
    setSession(s);
    setPassword('');
    setError(null);
    setView({ kind: 'signedIn' });
  };

  const signIn = async (extra?: { ageBracket: AgeBracket; termsVersion: string }) => {
    setBusy(true);
    setError(null);
    const r = await api.login({ username, password, ...(extra ?? {}) });
    setBusy(false);
    if (r.ok) return afterSession(r.data);
    if (r.termsRequired) {
      termsVersionRequired.current = r.termsRequired.termsVersion;
      setView({ kind: 'age', purpose: 'terms' });
      return;
    }
    if (r.code === 'age_blocked') return void (await block());
    setError(t(errorKey(r, 'login')));
  };

  const createAccount = async (bracket: AgeBracket) => {
    if (!doc) return;
    setBusy(true);
    setError(null);
    const r = await api.signup({ username, password, ageBracket: bracket, termsVersion: doc.terms.version });
    setBusy(false);
    if (r.ok) return afterSession(r.data);
    if (r.code === 'age_blocked') return void (await block());
    setError(t(errorKey(r, 'signup')));
    setView({ kind: 'create' });
  };

  const onBracket = async (purpose: 'create' | 'terms', bracket: AgeBracket) => {
    if (bracket !== '18p' && purpose === 'create') {
      // No server call for a blocked sign-up (10-ui-pages.md section 2.4 rule 4).
      await block();
      return;
    }
    if (bracket !== '18p' && purpose === 'terms') {
      // The password was already checked at sign-in; the answer deletes the account (DL-612).
      await signIn({ ageBracket: bracket, termsVersion: termsVersionRequired.current ?? '' });
      return;
    }
    await loadDocs();
    setView({ kind: 'terms', purpose, bracket });
  };

  if (view.kind === 'loading') {
    return (
      <main class="dv-screen dv-account" data-testid="account-loading">
        <p role="status">{t('account.loading')}</p>
      </main>
    );
  }
  if (view.kind === 'blocked') return <Blocked />;
  if (view.kind === 'signedIn' && session) {
    return (
      <SignedIn
        api={api}
        session={session}
        contact={contact}
        onSignedOut={(msg) => {
          setSession(null);
          setNotice(msg ?? null);
          setUsername('');
          setPassword('');
          setView({ kind: 'signIn' });
        }}
      />
    );
  }
  if (view.kind === 'age') {
    return <AgeScreen onBracket={(b) => void onBracket(view.purpose, b)} />;
  }
  if (view.kind === 'terms') {
    const bracket = view.bracket;
    const purpose = view.purpose;
    return (
      <main class="dv-screen dv-account" data-testid="account-terms">
        <h1>{t('account.terms.heading')}</h1>
        {doc ? (
          <div class="dv-doc-wrap">
            <p>{t('account.terms.interim')}</p>
            <Doc doc={doc.terms} />
            <Doc doc={doc.privacy} />
          </div>
        ) : (
          <p role="status">{docError ? t('account.terms.failed') : t('account.terms.loading')}</p>
        )}
        {error ? (
          <p class="dv-error" role="alert" data-testid="account-error">
            {error}
          </p>
        ) : null}
        <div class="dv-nav">
          {doc ? (
            <button
              type="button"
              class="dv-button"
              disabled={busy}
              onClick={() => (purpose === 'create' ? void createAccount(bracket) : void signIn({ ageBracket: bracket, termsVersion: doc.terms.version }))}
              data-testid="account-agree"
            >
              {purpose === 'create' ? t('account.terms.agreeCreate') : t('account.terms.agreeContinue')}
            </button>
          ) : (
            <button type="button" class="dv-button" onClick={() => void onBracket(purpose, bracket)}>
              {t('account.continue')}
            </button>
          )}
          <button type="button" class="dv-link" onClick={() => setView({ kind: purpose === 'create' ? 'create' : 'signIn' })}>
            {t('account.backToSignIn')}
          </button>
        </div>
      </main>
    );
  }

  const creating = view.kind === 'create';
  return (
    <main class="dv-screen dv-account" data-testid="account">
      <h1>{t('account.title')}</h1>
      <p>{t('account.lead')}</p>
      {notice ? (
        <p role="status" data-testid="account-notice">
          {notice}
        </p>
      ) : null}
      <form
        class="dv-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (creating) setView({ kind: 'age', purpose: 'create' });
          else void signIn();
        }}
      >
        <label class="dv-field">
          <span>{t('account.username')}</span>
          <input
            class="dv-input"
            name="username"
            autocomplete="username"
            autocapitalize="none"
            required
            minLength={3}
            maxLength={20}
            value={username}
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            data-testid="account-username"
          />
        </label>
        <label class="dv-field">
          <span>{t('account.password')}</span>
          <input
            class="dv-input"
            name="password"
            type="password"
            autocomplete={creating ? 'new-password' : 'current-password'}
            required
            minLength={creating ? 8 : 1}
            maxLength={256}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            data-testid="account-password"
          />
          {creating ? <small>{t('account.password.hint')}</small> : null}
        </label>
        {creating ? <p>{t('account.noRecovery')}</p> : null}
        {error ? (
          <p class="dv-error" role="alert" data-testid="account-error">
            {error}
          </p>
        ) : null}
        <div class="dv-nav">
          <button type="submit" class="dv-button" disabled={busy} data-testid={creating ? 'account-continue' : 'account-login'}>
            {creating ? t('account.continue') : t('account.signIn')}
          </button>
          {canCreate && !creating ? (
            <button
              type="button"
              class="dv-link"
              disabled={busy}
              onClick={() => {
                setError(null);
                setNotice(null);
                setView({ kind: 'create' });
              }}
              data-testid="account-signup"
            >
              {t('account.create')}
            </button>
          ) : null}
          {creating ? (
            <button type="button" class="dv-link" onClick={() => (setError(null), setView({ kind: 'signIn' }))}>
              {t('account.backToSignIn')}
            </button>
          ) : null}
        </div>
      </form>
      <BackLink />
    </main>
  );
}

function start(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');
  try {
    purgeLegacySession(localStorage);
  } catch {
    /* storage can be blocked */
  }
  document.title = `${t('account.title')} - ${BRAND.displayName}`;
  const listeners = new Set<(s: SessionState | null) => void>();
  const api = createAccountApi(browserDeps(), (s) => listeners.forEach((fn) => fn(s)));
  render(
    <AccountIsland
      api={api}
      onSession={(fn) => {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      }}
    />,
    root,
  );
}

if (typeof document !== 'undefined' && document.getElementById('app')) start();
