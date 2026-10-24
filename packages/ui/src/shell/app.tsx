import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PwaUpdateController } from '@dv/shared';
import { BRAND } from '../../../../config/brand.ts';
import { t } from '../i18n/index.ts';
import { FocusManager } from '../kit/focus.ts';
import { ConfirmBody, Dialog, ToastHost, type ToastItem } from '../kit/widgets.tsx';
import { StoryHud } from '../hud/story-hud.tsx';
import { CoachMark, InstallChip } from '../onboarding/coach-mark.tsx';
import { RotateOverlay } from '../onboarding/rotate.tsx';
import { Banners } from './banners.tsx';
import { AttributionSplash } from './attribution-splash.tsx';
import type { ShellCore } from './core.ts';
import { ShellProvider } from './context.tsx';
import { pageDef } from './registry.ts';
import type { PageComponent, PageDef, PageId } from './types.ts';

const loaded = new Map<PageId, PageComponent>();

/** Loads a page chunk once; renders nothing while the chunk loads (the first paint of a page needs only the shell, the kit and its chunk). */
function usePage(def: PageDef | undefined): PageComponent | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!def || loaded.has(def.id)) return undefined;
    let live = true;
    def.load().then((m) => {
      loaded.set(def.id, m.default as PageComponent);
      if (live) force((n) => n + 1);
    }, (e: unknown) => console.error('page chunk failed', def.id, e));
    return () => {
      live = false;
    };
  }, [def?.id]);
  return def ? (loaded.get(def.id) ?? null) : null;
}

function UpdateToastView(props: { visible: boolean; onApply(): void; onLater(): void }) {
  if (!props.visible) return null;
  return (
    <div class="dv-toast" role="status" data-testid="update-toast">
      <span>{t('update.ready')}</span>
      <button type="button" class="dv-button" onClick={props.onApply} data-testid="update-apply" data-fid="update.apply">
        {t('update.apply')}
      </button>
      <button type="button" class="dv-link" onClick={props.onLater} data-fid="update.later">
        {t('update.later')}
      </button>
    </div>
  );
}

/** "Update ready" only when the controller says an update can be offered (a safe point). */
function UpdateToast(props: { controller: PwaUpdateController }) {
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
  return <UpdateToastView visible={available && !dismissed} onApply={() => void controller.applyNow().catch(() => setDismissed(false))} onLater={() => setDismissed(true)} />;
}

function Unsupported(props: { diagnostics: string }) {
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

function applyPrefs(core: ShellCore): void {
  const root = document.documentElement;
  const p = core.props.prefs.get();
  const s = core.settings();
  root.style.fontSize = `${Math.round(p.uiScale * 100)}%`;
  if (p.highContrast) root.dataset['contrast'] = 'high';
  else delete root.dataset['contrast'];
  root.dataset['focusRing'] = p.focusRing;
  root.dataset['reducedMotion'] = s?.accessibility.reducedMotion === true ? 'true' : 'false';
  root.dataset['palette'] = s?.accessibility.hudPalette ?? 'default';
  root.lang = s?.language ?? p.lang ?? 'en';
}

export function ShellApp(props: { core: ShellCore }) {
  const { core } = props;
  const [, redraw] = useState(0);
  const ctx = useMemo(() => core.context(), [core]);
  useEffect(() => core.subscribe(() => redraw((n) => n + 1)), [core]);
  useEffect(() => {
    core.guard.start();
    const onPop = (): void => core.popstate(location.pathname);
    const setOnline = (): void => {
      core.gate.online = navigator.onLine !== false;
      core.touch();
    };
    const onHide = (): void => core.guard.stop();
    addEventListener('pagehide', onHide);
    addEventListener('popstate', onPop);
    addEventListener('online', setOnline);
    addEventListener('offline', setOnline);
    setOnline();
    const root = document.getElementById('app') ?? document.body;
    const focus = new FocusManager({ root, onBack: () => core.back(), escapeBacks: () => core.escapeBacks(), active: () => !(core.state === 'InMode' && core.frame === null) });
    // Leave Booting after the first paint.
    const boot = setTimeout(() => core.ready(), 0);
    return () => {
      clearTimeout(boot);
      removeEventListener('pagehide', onHide);
      removeEventListener('popstate', onPop);
      removeEventListener('online', setOnline);
      removeEventListener('offline', setOnline);
      focus.dispose();
      core.dispose();
    };
  }, [core]);
  useEffect(() => applyPrefs(core));

  const pageId = core.currentPage();
  const def = pageDef(pageId === 'unsupported' ? 'boot' : pageId);
  const Page = usePage(core.state === 'InMode' && !core.frame ? undefined : def);
  useEffect(() => {
    document.title = core.frame?.id === 'credits' ? `${t('credits.title')} - ${BRAND.displayName}` : BRAND.displayName;
  }, [core.frame?.id]);
  const shellHidden = core.state === 'InMode' && !core.frame;
  const bundle = { shell: core, ctx };
  const toastAction = (item: ToastItem): void => {
    const a = item.action?.cmd;
    if (!a) return;
    if ('nav' in a) core.navigate(a.nav);
    else core.sendUi(a);
    core.toastStore.dismiss(item.id);
  };
  return (
    <ShellProvider value={bundle}>
      {core.state === 'Unsupported' ? (
        <Unsupported diagnostics={core.props.diagnostics()} />
      ) : shellHidden ? null : (
        <>
          <Banners online={core.gate.online} otherTab={core.guard.otherTab} noSave={core.noSave} notIsolated={typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated} />
          {Page ? <Page page={pageId} shell={core} ctx={ctx} params={core.frame?.params ?? {}} /> : <main class="dv-screen" aria-busy="true" />}
        </>
      )}
      {shellHidden ? (
        <>
          <StoryHud />
          <RotateOverlay />
        </>
      ) : null}
      {core.state === 'Menu' && !core.frame ? (
        <>
          <CoachMark />
          <InstallChip />
        </>
      ) : null}
      <AttributionSplash />
      <ToastHost store={core.toastStore} announce={core.props.prefs.get().announce} onAction={toastAction} />
      {core.modals.map((m) =>
        m.confirm ? (
          <Dialog key={m.id} title={m.title} onClose={() => core.closeModal(m.id, false)}>
            <ConfirmBody
              body={t(m.confirm.bodyKey, m.confirm.params)}
              confirm={t(m.confirm.confirmKey)}
              cancel={t('common.cancel')}
              danger={m.confirm.danger}
              typeToConfirm={m.confirm.typeToConfirm}
              onDone={(ok) => core.closeModal(m.id, ok)}
            />
          </Dialog>
        ) : (
          <Dialog key={m.id} title={m.title} onClose={() => core.closeModal(m.id, null)}>
            {m.render?.((v) => core.closeModal(m.id, v))}
          </Dialog>
        ),
      )}
      {core.props.update ? <UpdateToast controller={core.props.update} /> : null}
      <div class="dv-sr" aria-live="polite" role="status" data-testid="announcer">{core.live}</div>
    </ShellProvider>
  );
}
