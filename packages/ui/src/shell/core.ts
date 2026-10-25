import type { ComponentChildren } from 'preact';
import type { GameModeId, JsonValue, ProfileSettings, SlotId, UiCommand } from '@dv/shared';
import { TERMS_VERSION } from '../../../../config/terms.ts';
import { lk, setLang, t } from '../i18n/index.ts';
import { ToastStore, toastIcon } from '../kit/widgets.tsx';
import { resolveLayout } from '../hud/touch.ts';
import { SettingsBinder } from './binder.ts';
import { defaultOverlayHooks, type OverlayHooks } from './overlay-hooks.ts';
import { InstanceGuard, type ChannelLike } from './banners.tsx';
import { defaultGateCtx } from './gates.ts';
import { transition, type ShellEvent } from './machine.ts';
import { frameFor, hrefFor, pageDef, PUBLIC_PAGES, type Frame } from './registry.ts';
import type {
  ConfirmSpec, EnginePort, GateCtx, ModalSpec, PageId, PlatformPort, SavesPort, ShellApi, ShellContext, ShellProps, ShellState, ToastSpec,
} from './types.ts';

/** A toast the sim raised (`UiBridge.toast`), as the engine hands it over. */
export interface SimToast { id: string; kind: string; text: string; params?: Record<string, string | number> }

/** Maps a sim toast to a shell toast. An unlock toast becomes "New mode unlocked: <title>" with an Open action. */
export function simToastToSpec(rec: SimToast): ToastSpec {
  if (rec.kind === 'unlock') {
    return {
      id: rec.id,
      kind: 'unlock',
      text: lk('toast.unlock'),
      params: { title: t(rec.text) },
      action: { label: lk('toast.open'), cmd: { nav: 'modes' } },
      ttlMs: 8000,
      icon: toastIcon('unlock'),
    };
  }
  const kind = rec.kind === 'warning' || rec.kind === 'error' || rec.kind === 'success' ? rec.kind : 'info';
  return { id: rec.id, kind, text: rec.text, ...(rec.params ? { params: rec.params } : {}), ttlMs: 5000, icon: toastIcon(kind) };
}

export interface ModalEntry {
  id: number;
  title: string;
  render: ((close: (v: unknown) => void) => ComponentChildren) | null;
  confirm: ConfirmSpec | null;
  resolve: (v: unknown) => void;
}

/** How long a `mode.start` may stay in Loading before the shell gives up and returns to the menu. */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * The shell's brain: state machine, frame (the page above the root), ports, modals, toasts, banners and the QA play bypass. A plain class
 * so the unit tests drive it without a DOM; `ShellApp` renders it.
 */
export class ShellCore implements ShellApi {
  state: ShellState;
  frame: Frame | null = null;
  /** A deep link that waits for the gates (History routing rule 1). */
  pending: Frame | null = null;
  engine: EnginePort | null = null;
  saves: SavesPort | null = null;
  platform: PlatformPort | null = null;
  readonly toastStore = new ToastStore();
  readonly gate: GateCtx;
  readonly binder: SettingsBinder;
  /** The read-only signal stream: `dv-shell` window events and the `dv-shell` channel (M04b5). */
  readonly overlay: OverlayHooks;
  readonly guard: InstanceGuard;
  modals: ModalEntry[] = [];
  noSave = false;
  /**
   * The world-load error (BD-FU-A02): the detail code (`catalog-404`, `index-http`, ...) once the page has found that the asset catalog
   * or the world index it names cannot be loaded after the fetch layer's retry policy. A mode start then shows the error page, with a
   * retry, instead of entering an empty world. Null while the world loads, or when the failure is the offline path (M11a2).
   */
  worldError: string | null = null;
  /** Incremented on every change the view should redraw for. */
  version = 0;
  /** What the QA play bypass still has to do: send `mode.start` once the sim has published its modes. */
  private bypassPending: 'sandbox' | 'story' | null;
  private readonly subs = new Set<() => void>();
  private offVm: (() => void) | null = null;
  private modalSeq = 0;
  private loadTimer: unknown = null;
  private pageSince = 0;
  private lastPage: PageId | null = null;
  private lastRunningMode = false;
  private offFrameStats: (() => void) | null = null;

  constructor(readonly props: ShellProps, channel: ChannelLike | null = null) {
    const prefs = props.prefs.get();
    this.bypassPending = props.qaPlay ? props.qaPlay.mode : null;
    this.state = props.unsupported ? 'Unsupported' : props.qaPlay ? 'InMode' : prefs.age.blocked ? 'Blocked' : 'Booting';
    this.gate = { ...defaultGateCtx(), flags: { ...(props.flags ?? {}) }, attested: prefs.age.attested === '18p' || props.qaPlay !== null };
    setLang(prefs.lang);
    this.overlay = props.overlay ?? defaultOverlayHooks();
    this.binder = new SettingsBinder({
      signal: (ref, value) => this.overlay.setting(ref, value),
      base: () => this.settings(),
      sendUi: (c) => this.sendUi(c),
      platform: () => this.platform,
      prefs: props.prefs,
      changed: () => this.touch(),
    });
    this.guard = new InstanceGuard(channel);
    this.guard.onChange(() => this.touch());
    this.pageSince = Date.now();
    const frame = frameFor(props.initialPath);
    if (frame) {
      if (PUBLIC_PAGES.has(frame.id)) this.frame = frame;
      else if (!props.qaPlay) this.pending = frame;
    }
    props.prefs.subscribe((p) => {
      this.gate.attested = p.age.attested === '18p' || props.qaPlay !== null;
      setLang(this.settings()?.language ?? p.lang);
      this.syncTouch();
      this.touch();
    });
    this.applyHooks();
  }

  // ---- subscription

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  touch(): void {
    this.version++;
    for (const cb of [...this.subs]) cb();
  }

  // ---- ports

  attachEngine(engine: EngineAttach | null): void {
    this.offVm?.();
    this.offVm = null;
    this.engine = engine;
    if (!engine) {
      this.touch();
      return;
    }
    this.touchSig = '';
    this.offVm = engine.vm.subscribe('sys.*', (_v, k) => this.onVm(k));
    this.onVm('sys.mode');
    this.onVm('sys.unlocks');
    this.onVm('sys.profile');
    this.syncTouch();
    this.armBypass();
    this.touch();
  }

  attachSaves(saves: SavesPort | null): void {
    this.saves = saves;
    this.noSave = saves !== null && !saves.persistent;
    this.touch();
  }

  attachPlatform(p: PlatformPort | null): void {
    this.offFrameStats?.();
    this.offFrameStats = null;
    this.platform = p;
    // The `fps` signal flows whether or not the chip is shown.
    this.offFrameStats = p?.onFrameStats?.((s) => this.overlay.fps(s.fps, s.tier)) ?? null;
    this.touch();
  }

  private onVm(key: string): void {
    if (key === 'sys.unlocks') {
      const ids = this.engine?.vm.get('sys.unlocks');
      this.gate.unlocks = new Set(Array.isArray(ids) ? ids.map(String) : []);
    } else if (key === 'sys.settings' || key === 'sys.controls') {
      this.binder.rebase();
      this.syncTouch();
      setLang(this.settings()?.language ?? this.props.prefs.get().lang);
    } else if (key === 'sys.modes') {
      this.armBypass();
    } else if (key === 'sys.mode') {
      this.onModeState();
    } else if (key === 'sys.profile') {
      const id = (this.engine?.vm.get('sys.profile') as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string') this.overlay.profile(id);
    }
    this.touch();
  }

  private onModeState(): void {
    const mode = this.mode();
    const running = mode.state === 'Running';
    if (running && this.state === 'Loading') this.fire('modeRunning');
    else if (mode.state === 'Idle' && this.lastRunningMode && (this.state === 'InMode' || this.state === 'Paused')) this.fire('modeIdle');
    this.lastRunningMode = running;
  }

  /** The QA play bypass (DL-650): once the sim has published its modes, start the requested mode, in memory only. */
  private armBypass(): void {
    const id = this.bypassPending;
    if (!id || !this.engine) return;
    if (this.engine.vm.get('sys.modes') === undefined) return;
    this.bypassPending = null;
    if (this.mode().state === 'Idle') this.engine.sendUi({ t: 'mode.start', id });
    if (typeof window !== 'undefined') {
      const unlock = (): void => {
        this.engine?.firstGesture();
        window.removeEventListener('keydown', unlock, true);
        window.removeEventListener('pointerdown', unlock, true);
      };
      window.addEventListener('keydown', unlock, true);
      window.addEventListener('pointerdown', unlock, true);
    }
  }

  // ---- context for pages

  settings(): ProfileSettings | null {
    const vm = this.engine?.vm;
    if (!vm) return null;
    const s = vm.get('sys.settings');
    const c = vm.get('sys.controls');
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return { ...(s as unknown as Omit<ProfileSettings, 'controls'>), controls: c as unknown as ProfileSettings['controls'] } as ProfileSettings;
  }

  mode(): { state: string; stack: { id: string; state: string }[] } {
    const v = this.engine?.vm.get('sys.mode') as { state?: string; stack?: { id: string; state: string }[] } | undefined;
    return { state: v?.state ?? 'Idle', stack: v?.stack ?? [] };
  }

  context(): ShellContext {
    const base = {
      props: this.props,
      prefs: this.props.prefs,
      binder: this.binder,
      vm: <T extends JsonValue>(key: string) => this.engine?.vm.get(key as never) as T | undefined,
      sendUi: (cmd: UiCommand) => this.sendUi(cmd),
      startMode: (id: GameModeId, slot?: SlotId) => this.startMode(id, slot),
      fire: (e: ShellEvent['t']) => this.fire(e),
    };
    // Live values: pages read them on each render, so they are getters over the core.
    return Object.defineProperties(base, {
      engine: { get: () => this.engine, enumerable: true },
      saves: { get: () => this.saves, enumerable: true },
      platform: { get: () => this.platform, enumerable: true },
      gate: { get: () => this.gate, enumerable: true },
      settings: { get: () => this.settings(), enumerable: true },
      mode: { get: () => this.mode(), enumerable: true },
      profile: { get: () => (this.engine?.vm.get('sys.profile') as { id: string; name: string; hasStory: boolean } | undefined) ?? null, enumerable: true },
      otherTab: { get: () => this.guard.otherTab, enumerable: true },
      engineReady: { get: () => this.engine !== null, enumerable: true },
    }) as unknown as ShellContext;
  }

  sendUi(cmd: UiCommand): boolean {
    return this.engine?.sendUi(cmd) ?? false;
  }

  // ---- state machine

  fire(t: ShellEvent['t']): void {
    const prefs = this.props.prefs.get();
    const next = transition(this.state, { t } as ShellEvent, { prefs, termsVersion: TERMS_VERSION });
    if (t === 'resume' && this.state === 'Paused') {
      // A page still open over Pause (the phone, after a jump from its Sandbox app, M04e2) closes with the resume: left behind it kept
      // Escape for the focus manager (`back()` -> history.back() -> a popstate that pauses the running game) and the engine's own Pause
      // toggle at once, and the two cancelled out (BD-M04e2-07). No history.back() here: its popstate would land in InMode and pause.
      if (this.frame) {
        this.frame = null;
        try {
          history.replaceState(null, '', '/');
        } catch {
          // no History in a test environment
        }
        this.pageChanged();
      }
      this.props.hooks.setPaused(false);
    }
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.overlay.state(next);
    if (next !== 'Loading' && this.loadTimer !== null) {
      clearTimeout(this.loadTimer as ReturnType<typeof setTimeout>);
      this.loadTimer = null;
    }
    if (next === 'Loading') {
      this.loadTimer = setTimeout(() => {
        if (this.state === 'Loading') this.fire('modeFailed');
      }, LOAD_TIMEOUT_MS);
    }
    if (prev === 'AgeGate' && next === 'Terms') this.props.onGatesPassed?.('attested');
    if (next === 'Terms' && prev === 'Title') this.props.onGatesPassed?.('attested');
    if (prev === 'Terms' && next === 'Menu') this.onTermsAccepted();
    if (next === 'Menu') this.applyPending();
    this.applyHooks();
    this.setSafePoint(next === 'Loading' ? 'loading' : 'menu');
    this.touch();
  }

  private onTermsAccepted(): void {
    this.props.onGatesPassed?.('terms');
    this.platform?.emit('ui.onboard', { step: 'terms', outcome: 'accepted' });
  }

  private applyPending(): void {
    if (this.pending && !this.frame) {
      const f = this.pending;
      this.pending = null;
      const def = pageDef(f.id);
      if (def && def.gate(this.gate).state === 'open') this.frame = f;
      history.replaceState(null, '', hrefFor(f.id, f.params));
    }
  }

  private applyHooks(): void {
    const h = this.props.hooks;
    if (this.state === 'InMode') {
      h.play(true);
      h.setPaused(false);
      h.view(true);
    } else if (this.state === 'Paused') {
      h.play(true);
      h.setPaused(true);
      h.view(false);
    } else {
      h.play(false);
      h.setPaused(false);
      h.view(false);
    }
  }

  /** The engine's Pause action toggled the pause. */
  enginePaused(paused: boolean): void {
    if (paused && this.state === 'InMode') this.fire('pause');
    else if (!paused && this.state === 'Paused') this.fire('resume');
  }

  private touchSig = '';
  /** Hands the engine the touch layout `ControlsSettings.touch.layout` names (a shipped id or a saved `custom:<n>`). */
  private syncTouch(): void {
    const engine = this.engine;
    const c = this.settings()?.controls;
    if (!engine?.setTouchLayout || !c) return;
    const layout = resolveLayout(c.touch.layout, this.props.prefs.get().customTouchLayouts);
    const opacity = layout.opacity ?? c.touch.opacity;
    const sig = JSON.stringify([layout, opacity]);
    if (sig === this.touchSig) return;
    this.touchSig = sig;
    const labels: Record<string, string> = {};
    for (const w of layout.widgets) if (w.kind === 'button' && w.label) labels[w.label] = t(w.label);
    engine.setTouchLayout({ ...layout, opacity }, labels);
  }

  /** The phone key (`client.Phone`): from a mode it pauses the sim and opens the phone; pressed again it closes it and resumes. */
  togglePhone(): void {
    if (this.state === 'Paused' && this.frame?.id === 'phone') {
      this.frame = null;
      this.pageChanged();
      this.fire('resume');
      return;
    }
    if (this.state === 'InMode') this.fire('pause');
    if (this.state === 'Paused') this.navigate('phone');
  }

  /** The page found that the world cannot be loaded (BD-FU-A02). A mode that is already loading or running shows the error at once. */
  worldUnavailable(detail: string): void {
    this.worldError = detail;
    if (this.state === 'Loading' || this.state === 'InMode' || this.state === 'Paused') this.showWorldError();
    this.touch();
  }

  /** The error page of kind `world-load` over the current state; Back returns to it, Retry reloads the page. */
  private showWorldError(): void {
    this.frame = { id: 'error', params: { kind: 'world-load', detail: this.worldError ?? '' } };
    this.pageChanged();
    this.touch();
  }

  startMode(id: GameModeId, slot?: SlotId): void {
    if (!this.engine) {
      this.toast({ id: 'engine.notReady', kind: 'warning', text: lk('engine.notReady') });
      return;
    }
    // A world that cannot be loaded is never entered: the error page says so and offers a retry (BD-FU-A02).
    if (this.worldError !== null) {
      this.showWorldError();
      return;
    }
    // The page that started the mode (New Game, Continue, Modes) closes: the loading screen, then the HUD, take its place.
    if (this.frame) {
      this.frame = null;
      try {
        history.replaceState(null, '', '/');
      } catch {
        // no History in a test environment
      }
    }
    this.fire('startMode');
    this.engine.sendUi(slot ? { t: 'mode.start', id, slot } : { t: 'mode.start', id });
  }

  /**
   * Toasts from the sim. A refused `mode.start` while Loading returns to the menu. A toast with an empty text takes the toast of that id
   * off the screen (`UiBridge` has no dismiss call; the story's loading hint uses it once the wait is over, BD-FIX-SPAWN-04).
   */
  onEngineToast(rec: SimToast): void {
    if (rec.text === '') {
      this.toastStore.dismiss(rec.id);
      return;
    }
    this.toastStore.push(simToastToSpec(rec));
    if (rec.id.startsWith('mode:') && this.state === 'Loading') this.fire('modeFailed');
    if (rec.id === 'unlock' || rec.kind === 'unlock') this.touch();
  }

  /** A crash of sim.worker: the engine restarts it from the last save. */
  crashed(): void {
    this.fire('crash');
  }
  recovered(): void {
    this.fire('recovered');
  }

  // ---- ShellApi

  navigate(id: PageId, params: Record<string, string> = {}): void {
    const def = pageDef(id);
    if (!def) return;
    const publicPage = PUBLIC_PAGES.has(id);
    if (!publicPage && this.state !== 'Menu' && this.state !== 'Paused') return;
    const g = def.gate(this.gate);
    if (g.state === 'hidden') return;
    if (g.state === 'disabled') {
      this.toast({ id: `gate.${id}`, kind: 'info', text: g.reason });
      return;
    }
    const next: Frame = { id, params };
    const href = hrefFor(id, params);
    // Moving between settings categories replaces the entry, so one Back still leaves Settings.
    if (this.frame?.id === 'settings' && id === 'settings') history.replaceState({ dv: 1 }, '', href);
    else history.pushState({ dv: 1 }, '', href);
    this.frame = next;
    this.overlay.page(id);
    this.pageChanged();
    this.touch();
  }

  back(): void {
    const top = this.modals[this.modals.length - 1];
    if (top) {
      this.closeModal(top.id, null);
      return;
    }
    if (this.frame) {
      this.frame = null;
      if (history.state && (history.state as { dv?: number }).dv === 1) history.back();
      else history.replaceState(null, '', '/');
      this.pageChanged();
      this.touch();
      return;
    }
    if (this.state === 'Paused') this.fire('resume');
  }

  /** The browser's own back or forward button. In a mode it opens Pause instead of leaving the app (routing rule 3). */
  popstate(pathname: string): void {
    if (this.state === 'InMode') {
      history.pushState({ dv: 1 }, '', '/');
      this.props.hooks.setPaused(true);
      this.fire('pause');
      return;
    }
    const f = frameFor(pathname);
    const ok = f !== null && (PUBLIC_PAGES.has(f.id) || this.state === 'Menu' || this.state === 'Paused') && pageDef(f.id)?.gate(this.gate).state !== 'hidden';
    this.frame = ok ? f : null;
    this.pageChanged();
    this.touch();
  }

  /** Escape belongs to the engine's Pause action while the pause menu shows without a page or modal above it. */
  escapeBacks(): boolean {
    return !(this.state === 'Paused' && this.frame === null && this.modals.length === 0);
  }

  modal<T>(spec: ModalSpec<T>): Promise<T | null> {
    return new Promise((resolve) => {
      const id = ++this.modalSeq;
      this.modals.push({ id, title: t(spec.titleKey), render: spec.body as ModalEntry['render'], confirm: null, resolve: resolve as (v: unknown) => void });
      this.touch();
    });
  }

  closeModal(id: number, value: unknown): void {
    const i = this.modals.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.modals.splice(i, 1);
    m?.resolve(value);
    this.touch();
  }

  confirm(spec: ConfirmSpec): Promise<boolean> {
    return new Promise((resolve) => {
      const id = ++this.modalSeq;
      this.modals.push({ id, title: t(spec.titleKey), render: null, confirm: spec, resolve: (v) => resolve(v === true) });
      this.touch();
    });
  }

  toast(spec: Partial<ToastSpec> & Pick<ToastSpec, 'text'>): void {
    const kind = spec.kind ?? 'info';
    this.toastStore.push({ id: spec.id ?? spec.text, kind, text: spec.text, ...(spec.params ? { params: spec.params } : {}), ...(spec.action ? { action: spec.action } : {}), ttlMs: spec.ttlMs ?? 5000, icon: spec.icon ?? toastIcon(kind) });
  }

  announce(text: string): void {
    if (this.props.prefs.get().announce) this.live = text;
    this.touch();
  }
  live = '';

  setSafePoint(kind: 'menu' | 'mission-end' | 'safehouse' | 'loading'): void {
    this.props.update?.markSafePoint(kind);
  }

  /** `ui.page {page, ms}` after Terms are accepted, when the page the player is on changes. */
  pageChanged(): void {
    const now = Date.now();
    const page = this.currentPage();
    const accepted = this.props.prefs.get().terms?.version === TERMS_VERSION && !this.props.prefs.get().age.blocked && this.props.qaPlay === null;
    if (accepted && this.lastPage !== null && this.lastPage !== page) this.platform?.emit('ui.page', { page: this.lastPage, ms: now - this.pageSince });
    this.lastPage = page;
    this.pageSince = now;
  }

  /** The page the player sees now. */
  currentPage(): PageId {
    if (this.frame) return this.frame.id;
    switch (this.state) {
      case 'Booting': return 'boot';
      case 'Unsupported': return 'unsupported';
      case 'Title': return 'title';
      case 'AgeGate': return 'age';
      case 'Blocked': return 'blocked';
      case 'Terms': return 'terms';
      case 'Menu': return 'main';
      case 'Loading':
      case 'Recovering': return 'loading';
      case 'Paused': return 'pause';
      case 'InMode': return 'main';
      case 'Error': return 'error';
    }
  }

  /** The shell finished its first paint; leave Booting. */
  ready(): void {
    this.fire('ready');
    this.pageChanged();
  }

  dispose(): void {
    this.offVm?.();
    this.offFrameStats?.();
    this.offFrameStats = null;
    this.overlay.dispose();
    this.guard.stop();
    if (this.loadTimer !== null) clearTimeout(this.loadTimer as ReturnType<typeof setTimeout>);
  }
}

export type EngineAttach = EnginePort;
