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

export type Route = { page: 'title' } | { page: 'credits' } | { page: 'legal'; doc: string };

/** Maps a pathname to a shell page. Unknown paths show the title (the Worker serves the SPA for every path). */
export function routeFor(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/menu/credits') return { page: 'credits' };
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
