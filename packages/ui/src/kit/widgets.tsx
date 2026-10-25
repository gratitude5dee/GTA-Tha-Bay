/**
 * The Preact kit (10-ui.md section 2.2): buttons, switches, sliders, segmented choices, lists, tabs, progress, toasts, banners,
 * dialogs, the scope badge and the on-screen keyboard. Widgets that `DomScreen` uses are plain functions without hooks, so the
 * screen parity test can expand them. Overlays (toasts, dialogs, banners) live here too (DL-702).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lk, t, type LocKey } from '../i18n/index.ts';
import type { ToastSpec } from '../shell/types.ts';

// ---- plain widgets (hookless)

export function ScopeBadge(props: { scope: 'profile' | 'device' | 'ui' }) {
  const key = props.scope === 'profile' ? lk('scope.profile') : lk('scope.device');
  return (
    <span class="dv-badge" data-scope={props.scope}>
      {t(key)}
    </span>
  );
}

export function Button(props: {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  /** Why the button cannot be used; it stays focusable and is read aloud (aria-disabled), like a `comingSoon` tile. */
  disabledReason?: string | undefined;
  onPress(): void;
  fid?: string;
  testId?: string;
  icon?: string | undefined;
}) {
  const style = props.style ?? 'secondary';
  const off = props.disabledReason !== undefined;
  return (
    <button
      type="button"
      class={`dv-btn dv-btn-${style}`}
      data-fid={props.fid ?? `button.${props.id}`}
      data-testid={props.testId ?? `btn-${props.id}`}
      aria-disabled={off ? 'true' : undefined}
      title={props.disabledReason}
      onClick={() => {
        if (!off) props.onPress();
      }}
    >
      {props.icon ? <span class="dv-icon" aria-hidden="true">{props.icon}</span> : null}
      <span>{props.label}</span>
      {off ? <span class="dv-sr">{` ${props.disabledReason as string}`}</span> : null}
    </button>
  );
}

export function Toggle(props: { id: string; label: string; hint?: string | undefined; on: boolean; scope?: 'profile' | 'device' | 'ui'; disabledReason?: string | undefined; onChange(on: boolean): void }) {
  const off = props.disabledReason !== undefined;
  return (
    <div class="dv-row">
      <div class="dv-row-text">
        <span id={`lbl-${props.id}`}>{props.label}</span>
        {props.hint ? <small>{props.hint}</small> : null}
      </div>
      {props.scope ? <ScopeBadge scope={props.scope} /> : null}
      <button
        type="button"
        role="switch"
        class="dv-switch"
        data-fid={`toggle.${props.id}`}
        data-testid={`toggle-${props.id}`}
        aria-checked={props.on ? 'true' : 'false'}
        aria-labelledby={`lbl-${props.id}`}
        aria-disabled={off ? 'true' : undefined}
        title={props.disabledReason}
        onClick={() => {
          if (!off) props.onChange(!props.on);
        }}
      >
        <span class="dv-switch-knob" aria-hidden="true" />
        <span class="dv-sr">{props.on ? t('common.on') : t('common.off')}</span>
      </button>
    </div>
  );
}

export function Slider(props: { id: string; label: string; value: number; min: number; max: number; step: number; unit?: string | undefined; scope?: 'profile' | 'device' | 'ui'; onChange(v: number): void }) {
  return (
    <div class="dv-row">
      <label class="dv-row-text" for={`in-${props.id}`}>
        <span>{props.label}</span>
        <small data-testid={`val-${props.id}`}>{`${props.value}${props.unit ?? ''}`}</small>
      </label>
      {props.scope ? <ScopeBadge scope={props.scope} /> : null}
      <input
        id={`in-${props.id}`}
        class="dv-range"
        type="range"
        data-fid={`slider.${props.id}`}
        data-testid={`slider-${props.id}`}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </div>
  );
}

export function Choice(props: { id: string; label: string; options: { key: string; label: string; on: boolean }[]; scope?: 'profile' | 'device' | 'ui'; disabledReason?: string | undefined; onPick(index: number): void }) {
  const off = props.disabledReason !== undefined;
  return (
    <div class="dv-row" role="radiogroup" aria-labelledby={`lbl-${props.id}`} aria-disabled={off ? 'true' : undefined}>
      <div class="dv-row-text">
        <span id={`lbl-${props.id}`}>{props.label}</span>
        {off ? <small data-testid={`reason-${props.id}`}>{props.disabledReason}</small> : null}
      </div>
      {props.scope ? <ScopeBadge scope={props.scope} /> : null}
      <div class="dv-segmented">
        {props.options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            class="dv-seg"
            data-fid={`choice.${props.id}.${i}`}
            data-testid={`choice-${props.id}-${o.key}`}
            aria-checked={o.on ? 'true' : 'false'}
            tabIndex={o.on ? 0 : -1}
            aria-disabled={off ? 'true' : undefined}
            title={props.disabledReason}
            onClick={() => {
              if (!off) props.onPick(i);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ListItem { id: string; text: string; detail?: string | undefined; badge?: string | undefined; disabled?: boolean | undefined; hint?: string | undefined }

export function ListBox(props: { id: string; rows: readonly ListItem[]; empty: string; onPress(rowId: string): void }) {
  if (props.rows.length === 0) return <p class="dv-muted" data-testid={`empty-${props.id}`}>{props.empty}</p>;
  return (
    <ul class="dv-list" data-testid={`list-${props.id}`}>
      {props.rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            class="dv-list-row"
            data-fid={`row.${props.id}.${r.id}`}
            data-testid={`row-${props.id}-${r.id}`}
            aria-disabled={r.disabled ? 'true' : undefined}
            onClick={() => {
              if (!r.disabled) props.onPress(r.id);
            }}
          >
            <span class="dv-list-text">{r.text}</span>
            {r.detail ? <small>{r.detail}</small> : null}
            {r.badge ? <span class="dv-badge dv-badge-new">{r.badge}</span> : null}
            {r.disabled && r.hint ? <span class="dv-sr">{r.hint}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Tabs(props: { id: string; tabs: { id: string; label: string }[]; active: string; onSelect(tabId: string): void }) {
  return (
    <div class="dv-tabs" role="tablist" data-testid={`tabs-${props.id}`}>
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          class="dv-tab"
          id={`tab-${props.id}-${tab.id}`}
          data-fid={`tab.${props.id}.${tab.id}`}
          data-testid={`tab-${props.id}-${tab.id}`}
          aria-selected={tab.id === props.active ? 'true' : 'false'}
          tabIndex={tab.id === props.active ? 0 : -1}
          onClick={() => props.onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Progress(props: { value: number; label?: string | undefined }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <div class="dv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={props.label ?? t('common.progress')}>
      <div class="dv-progress-bar" style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

// ---- toasts (queue 3, 10-ui.md section 3.1)

export interface ToastItem extends ToastSpec { at: number }
export const TOAST_QUEUE = 3;
export const TOAST_PERSIST_MS = 8000;

/** The toast queue as a plain store. Newest `info` replaces the oldest `info` when full; `unlock` and `error` persist up to 8 s. */
export class ToastStore {
  private items: ToastItem[] = [];
  private readonly subs = new Set<(items: readonly ToastItem[]) => void>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  get list(): readonly ToastItem[] {
    return this.items;
  }

  subscribe(cb: (items: readonly ToastItem[]) => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  push(spec: ToastSpec): void {
    const item: ToastItem = { ...spec, ttlMs: spec.kind === 'unlock' || spec.kind === 'error' ? Math.min(spec.ttlMs, TOAST_PERSIST_MS) : spec.ttlMs, at: this.clock() };
    const same = this.items.findIndex((x) => x.id === spec.id);
    if (same >= 0) this.items.splice(same, 1);
    this.items.push(item);
    while (this.items.length > TOAST_QUEUE) {
      const info = this.items.findIndex((x) => x.kind === 'info');
      this.items.splice(info >= 0 ? info : 0, 1);
    }
    this.emit();
  }

  dismiss(id: string): void {
    const n = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== n) this.emit();
  }

  /** Drops what has outlived its ttl. */
  expire(): void {
    const now = this.clock();
    const n = this.items.length;
    this.items = this.items.filter((x) => now - x.at < x.ttlMs);
    if (this.items.length !== n) this.emit();
  }

  private emit(): void {
    for (const cb of [...this.subs]) cb(this.items);
  }
}

const TOAST_ICON: Record<ToastSpec['kind'], string> = { info: 'i', success: '✓', warning: '!', unlock: '★', error: '×' };
export const toastIcon = (kind: ToastSpec['kind']): string => TOAST_ICON[kind];

export function ToastHost(props: { store: ToastStore; announce: boolean; onAction(item: ToastItem): void }) {
  const [items, setItems] = useState<readonly ToastItem[]>(props.store.list);
  useEffect(() => {
    const off = props.store.subscribe((l) => setItems([...l]));
    const timer = setInterval(() => props.store.expire(), 500);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [props.store]);
  return (
    <div class="dv-toasts" data-testid="toasts" role="status" aria-live={props.announce ? 'polite' : 'off'}>
      {items.map((x) => (
        <div key={x.id} class={`dv-toast-item dv-toast-${x.kind}`} data-testid={`toast-${x.kind}`} data-toast-id={x.id}>
          <span class="dv-toast-icon" aria-hidden="true">{x.icon}</span>
          <span class="dv-toast-text">{t(x.text, x.params)}</span>
          {x.action ? (
            <button type="button" class="dv-btn dv-btn-secondary" data-fid={`toast.${x.id}.action`} onClick={() => props.onAction(x)}>
              {t(x.action.label)}
            </button>
          ) : null}
          <button type="button" class="dv-btn dv-btn-quiet" aria-label={t('common.dismiss')} data-fid={`toast.${x.id}.close`} onClick={() => props.store.dismiss(x.id)}>
            {'×'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- banners (persistent, top)

export function Banner(props: { id: string; tone?: 'info' | 'warning'; icon: string; text: string; action?: { label: string; onPress(): void } | undefined }) {
  return (
    <div class={`dv-banner dv-banner-${props.tone ?? 'info'}`} role="status" data-testid={`banner-${props.id}`}>
      <span aria-hidden="true">{props.icon}</span>
      <span>{props.text}</span>
      {props.action ? (
        <button type="button" class="dv-btn dv-btn-secondary" data-fid={`banner.${props.id}.action`} onClick={props.action.onPress}>
          {props.action.label}
        </button>
      ) : null}
    </div>
  );
}

// ---- dialogs

/** A modal dialog: focus moves in on open, Tab stays inside, and focus returns to the opener on close. */
export function Dialog(props: { title: string; onClose(): void; children: ComponentChildren; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('input,button,[tabindex]:not([tabindex="-1"])');
    first?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <div class="dv-overlay" data-dv-modal>
      <div
        ref={ref}
        class="dv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dv-dialog-title"
        data-testid={props.testId ?? 'dialog'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            props.onClose();
          } else if (e.key === 'Tab') {
            const els = [...(ref.current?.querySelectorAll<HTMLElement>('input,button:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
            if (els.length === 0) return;
            const firstEl = els[0] as HTMLElement;
            const lastEl = els[els.length - 1] as HTMLElement;
            if (e.shiftKey && document.activeElement === firstEl) {
              e.preventDefault();
              lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
              e.preventDefault();
              firstEl.focus();
            }
          }
        }}
      >
        <h2 id="dv-dialog-title">{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function ConfirmBody(props: { body: string; confirm: string; cancel: string; danger?: boolean | undefined; typeToConfirm?: string | undefined; onDone(ok: boolean): void }) {
  const [typed, setTyped] = useState('');
  const ready = props.typeToConfirm === undefined || typed.trim().toLowerCase() === props.typeToConfirm.trim().toLowerCase();
  return (
    <div class="dv-dialog-body">
      <p>{props.body}</p>
      {props.typeToConfirm !== undefined ? (
        <label class="dv-field">
          <span>{t('confirm.type', { text: props.typeToConfirm })}</span>
          <input class="dv-input" data-testid="confirm-input" value={typed} autocomplete="off" onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
        </label>
      ) : null}
      <div class="dv-actions">
        <button type="button" class="dv-btn dv-btn-secondary" data-testid="confirm-cancel" data-fid="confirm.cancel" onClick={() => props.onDone(false)}>
          {props.cancel}
        </button>
        <button
          type="button"
          class={`dv-btn ${props.danger ? 'dv-btn-danger' : 'dv-btn-primary'}`}
          data-testid="confirm-ok"
          data-fid="confirm.ok"
          aria-disabled={ready ? undefined : 'true'}
          onClick={() => {
            if (ready) props.onDone(true);
          }}
        >
          {props.confirm}
        </button>
      </div>
    </div>
  );
}

// ---- on-screen keyboard (gamepad text entry)

const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm.-_'];

/** A grid keyboard: A/Accept types, the Back key deletes, Space and Shift are buttons, Done closes. Focus navigation reaches every key. */
export function OnScreenKeyboard(props: { value: string; maxLength: number; onChange(v: string): void; onDone(): void }) {
  const [shift, setShift] = useState(false);
  const type = (c: string): void => {
    if (props.value.length < props.maxLength) props.onChange(props.value + (shift ? c.toUpperCase() : c));
  };
  return (
    <div class="dv-osk" data-testid="osk" role="group" aria-label={t('osk.title')}>
      <output class="dv-osk-value" data-testid="osk-value">{props.value || ' '}</output>
      {KEY_ROWS.map((row) => (
        <div key={row} class="dv-osk-row">
          {[...row].map((c) => (
            <button key={c} type="button" class="dv-btn dv-btn-secondary dv-osk-key" data-fid={`osk.${c}`} onClick={() => type(c)}>
              {shift ? c.toUpperCase() : c}
            </button>
          ))}
        </div>
      ))}
      <div class="dv-osk-row">
        <button type="button" class="dv-btn dv-btn-secondary" data-fid="osk.shift" aria-pressed={shift ? 'true' : 'false'} onClick={() => setShift(!shift)}>
          {t('osk.shift')}
        </button>
        <button type="button" class="dv-btn dv-btn-secondary dv-osk-space" data-fid="osk.space" onClick={() => type(' ')}>
          {t('osk.space')}
        </button>
        <button type="button" class="dv-btn dv-btn-secondary" data-fid="osk.back" onClick={() => props.onChange(props.value.slice(0, -1))}>
          {t('osk.back')}
        </button>
        <button type="button" class="dv-btn dv-btn-primary" data-fid="osk.done" onClick={props.onDone}>
          {t('osk.done')}
        </button>
      </div>
    </div>
  );
}

/** Runs an async loader when `deps` change; `reload` runs it again. The last result stays while a new one loads. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload(): void } {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, error: undefined, loading: false }),
      (error: unknown) => live && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export type { LocKey };
