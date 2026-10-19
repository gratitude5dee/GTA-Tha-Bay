/**
 * Shell skeleton (M00): BootScreen, Unsupported, Title stub, credits and legal stubs, UpdateToast.
 * M04b1 splits these into shell/, kit/ and pages/ (10-ui.md section 2.2).
 */
import { createContext, render, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { PwaUpdateController } from '@dv/shared';
import { BRAND } from '../../../config/brand.ts';
import { t, type LocKey } from './i18n.ts';
import './kit/tokens.css';
import './kit/shell.css';

export { t } from './i18n.ts';
export type { LocKey } from './i18n.ts';

export const LEGAL_DOCS = [
  'terms',
  'privacy',
  'dmca',
  'ncii',
  'ugc',
  'ai-disclosure',
  'repeat-infringer',
  'contact',
] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export type Route = { page: 'title' } | { page: 'credits' } | { page: 'legal'; doc: string } | { page: 'account' };

/** Maps a pathname to a shell page. Unknown paths show the title (the Worker serves the SPA for every path). */
export function routeFor(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/menu/credits') return { page: 'credits' };
  if (clean === '/account' || clean === '/account/signin') return { page: 'account' };
  const m = /^\/legal\/([^/]+)$/.exec(clean);
  if (m?.[1]) return { page: 'legal', doc: m[1] };
  return { page: 'title' };
}

function isLegalDoc(doc: string): doc is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(doc);
}

const NavContext = createContext<(to: string) => void>(() => {});

export function Link(props: { href: string; class?: string; children: ComponentChildren }) {
  const go = useContext(NavContext);
  return (
    <a
      class={props.class ?? 'dv-link'}
      href={props.href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(props.href);
      }}
    >
      {props.children}
    </a>
  );
}

export function BootScreen() {
  return (
    <main class="dv-screen dv-boot" data-testid="boot">
      <p role="status" aria-live="polite">
        {t('boot.loading')}
      </p>
    </main>
  );
}

export function Unsupported(props: { diagnostics: string }) {
  return (
    <main class="dv-screen dv-unsupported" data-testid="unsupported">
      <h1>{t('unsupported.title')}</h1>
      <p>{t('unsupported.body')}</p>
      <h2>{t('unsupported.diagnostics')}</h2>
      <pre class="dv-diagnostics" data-testid="diagnostics">
        {props.diagnostics}
      </pre>
    </main>
  );
}

export function Title() {
  return (
    <main class="dv-screen dv-title" data-testid="title">
      <h1 data-testid="title-name">{t('title.name')}</h1>
      <p>{BRAND.tagline}</p>
      <button type="button" class="dv-button" data-testid="title-start">
        {t('title.start')}
      </button>
      <nav class="dv-nav">
        <Link href="/account">{t('title.account')}</Link>
        <Link href="/menu/credits">{t('title.credits')}</Link>
        <Link href="/legal/terms">{t('title.legal')}</Link>
      </nav>
    </main>
  );
}

export function Credits() {
  return (
    <main class="dv-screen dv-credits" data-testid="credits">
      <h1>{t('credits.title')}</h1>
      <p>{t('credits.pending')}</p>
      <p class="dv-disclaimer" data-testid="disclaimer">
        {BRAND.disclaimer}
      </p>
      <Link href="/">{t('credits.back')}</Link>
    </main>
  );
}

export function Legal(props: { doc: string }) {
  const known = isLegalDoc(props.doc);
  const titleKey: LocKey = known ? (`legal.doc.${props.doc}` as LocKey) : 'legal.notFound';
  return (
    <main class="dv-screen dv-legal" data-testid="legal" data-doc={props.doc}>
      <h1>{t(titleKey)}</h1>
      <p>{known ? t('legal.pending') : ''}</p>
      <Link href="/">{t('legal.back')}</Link>
    </main>
  );
}

interface StoredSession {
  user: { id: string | null; username: string | null };
  session: { accessToken: string | null; refreshToken: string | null; expiresIn: number | null; tokenType: string | null };
}

const SESSION_KEY = 'dv-session';

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.session?.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

/** Username/password account page (Supabase Auth via /api/v1/auth/*). Providers land later. */
export function Account() {
  const [session, setSession] = useState<StoredSession | null>(() => readSession());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: 'signup' | 'login') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as StoredSession & { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? t('account.error.generic'));
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setSession(data);
    } catch {
      setError(t('account.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const token = session?.session.accessToken;
    if (token) {
      await fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  if (session) {
    return (
      <main class="dv-screen dv-account" data-testid="account">
        <h1>{t('account.title')}</h1>
        <p data-testid="account-signed-in">{t('account.signedIn', { name: session.user.username ?? '?' })}</p>
        <div class="dv-nav">
          <button type="button" class="dv-button" onClick={signOut} data-testid="account-signout">
            {t('account.signOut')}
          </button>
          <Link href="/">{t('account.back')}</Link>
        </div>
      </main>
    );
  }

  return (
    <main class="dv-screen dv-account" data-testid="account">
      <h1>{t('account.title')}</h1>
      <p>{t('account.lead')}</p>
      <form
        class="dv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit('login');
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
            autocomplete="current-password"
            required
            minLength={6}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            data-testid="account-password"
          />
        </label>
        {error ? (
          <p class="dv-error" role="alert" data-testid="account-error">
            {error}
          </p>
        ) : null}
        <div class="dv-nav">
          <button type="submit" class="dv-button" disabled={busy} data-testid="account-login">
            {t('account.signIn')}
          </button>
          <button type="button" class="dv-link" disabled={busy} onClick={() => void submit('signup')} data-testid="account-signup">
            {t('account.create')}
          </button>
        </div>
      </form>
      <Link href="/">{t('account.back')}</Link>
    </main>
  );
}

export function UpdateToastView(props: { visible: boolean; onApply: () => void; onLater: () => void }) {
  if (!props.visible) return null;
  return (
    <div class="dv-toast" role="status" data-testid="update-toast">
      <span>{t('update.ready')}</span>
      <button type="button" class="dv-button" onClick={props.onApply} data-testid="update-apply">
        {t('update.apply')}
      </button>
      <button type="button" class="dv-link" onClick={props.onLater}>
        {t('update.later')}
      </button>
    </div>
  );
}

/** Shows "update ready" only when the controller says an update can be offered (a safe point). */
export function UpdateToast(props: { controller: PwaUpdateController }) {
  const { controller } = props;
  const [available, setAvailable] = useState(controller.updateAvailable);
  const [dismissed, setDismissed] = useState(false);
  useEffect(
    () =>
      controller.onChange((next) => {
        setAvailable(next);
        if (next) setDismissed(false);
      }),
    [controller],
  );
  return (
    <UpdateToastView
      visible={available && !dismissed}
      onApply={() => {
        controller.applyNow().catch(() => setDismissed(false));
      }}
      onLater={() => setDismissed(true)}
    />
  );
}

export interface ShellProps {
  /** Builds the diagnostics string for the unsupported screen. */
  diagnostics: () => string;
  /** Show the unsupported screen (WebGL2 init failed, or ?unsupported=1 in QA builds). */
  unsupported: boolean;
  update: PwaUpdateController | null;
  initialPath: string;
}

function pageTitle(route: Route): string {
  if (route.page === 'credits') return `${t('credits.title')} - ${BRAND.displayName}`;
  if (route.page === 'account') return `${t('account.title')} - ${BRAND.displayName}`;
  return BRAND.displayName;
}

export function App(props: ShellProps) {
  const [phase, setPhase] = useState<'booting' | 'ready'>(props.unsupported ? 'ready' : 'booting');
  const [path, setPath] = useState(props.initialPath);

  useEffect(() => {
    if (phase !== 'booting') return undefined;
    const id = setTimeout(() => setPhase('ready'), 0);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const route = routeFor(path);
  useEffect(() => {
    document.title = props.unsupported ? BRAND.displayName : pageTitle(route);
  }, [props.unsupported, route.page]);

  const go = (to: string) => {
    history.pushState(null, '', to);
    setPath(to);
    scrollTo(0, 0);
  };

  let body: ComponentChildren;
  if (props.unsupported) body = <Unsupported diagnostics={props.diagnostics()} />;
  else if (phase === 'booting') body = <BootScreen />;
  else if (route.page === 'credits') body = <Credits />;
  else if (route.page === 'account') body = <Account />;
  else if (route.page === 'legal') body = <Legal doc={route.doc} />;
  else body = <Title />;

  return (
    <NavContext.Provider value={go}>
      {body}
      {props.update ? <UpdateToast controller={props.update} /> : null}
    </NavContext.Provider>
  );
}

export function mountShell(root: HTMLElement, props: ShellProps): void {
  render(<App {...props} />, root);
}
