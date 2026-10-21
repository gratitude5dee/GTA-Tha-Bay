/**
 * The modes panel (QA builds only, M04a2): a small box in the top-right corner that shows the mode host state, the wallet, the unlocks
 * and the last toasts the sim raised, with buttons to start story or sandbox, quit, unlock racing and add $100. M04b1 brings the real
 * shell, menus and toasts; this file is reached only through a dynamic import behind `VITE_DV_QA === '1'`, so a production dist does
 * not contain it (apps/web/scripts/verify-dist.mjs).
 *
 * Plain DOM; every element has a `data-testid`.
 */
import type { GameModeId, JsonValue, ViewModelSource } from '@dv/shared';

export interface ModesPanelOptions {
  container: HTMLElement;
  vm: ViewModelSource;
  toasts(): readonly { id: string; kind: string; text: string }[];
  onStart(id: GameModeId): void;
  onQuit(): void;
  onUnlock(id: string): void;
  onCredit(cents: number): void;
}

const STYLE = `
.dv-modes{position:fixed;right:calc(env(safe-area-inset-right,0px) + .5rem);top:calc(env(safe-area-inset-top,0px) + .5rem);z-index:35;max-inline-size:min(21rem,60vw);
padding:.4rem .5rem;border-radius:.5rem;background:rgba(14,18,26,.82);color:#f3f5f8;font:600 .8rem/1.25 system-ui,sans-serif;pointer-events:none}
.dv-modes button{pointer-events:auto;min-block-size:1.9rem;padding-inline:.5rem;border:1px solid rgba(255,255,255,.35);border-radius:.3rem;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}
.dv-modes__line{display:block;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dv-modes__row{display:flex;flex-wrap:wrap;gap:.25rem;margin-block-start:.3rem}
.dv-modes__toasts{margin:.3rem 0 0;padding:0;list-style:none;color:#f2c230}
`;

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export class ModesPanel {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly state: HTMLSpanElement;
  private readonly wallet: HTMLSpanElement;
  private readonly unlocks: HTMLSpanElement;
  private readonly toastList: HTMLUListElement;
  private shown = '';

  constructor(private readonly o: ModesPanelOptions) {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.append(this.style);
    const root = document.createElement('div');
    root.className = 'dv-modes';
    root.dataset['testid'] = 'modes-panel';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Modes debug');
    const line = (testid: string): HTMLSpanElement => {
      const s = document.createElement('span');
      s.className = 'dv-modes__line';
      s.dataset['testid'] = testid;
      root.append(s);
      return s;
    };
    this.state = line('modes-state');
    this.wallet = line('modes-wallet');
    this.unlocks = line('modes-unlocks');
    const row = document.createElement('div');
    row.className = 'dv-modes__row';
    const button = (label: string, testid: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset['testid'] = testid;
      b.addEventListener('click', fn);
      row.append(b);
    };
    button('story', 'modes-start-story', () => o.onStart('story'));
    button('sandbox', 'modes-start-sandbox', () => o.onStart('sandbox'));
    button('racing', 'modes-start-racing', () => o.onStart('racing'));
    button('quit', 'modes-quit', () => o.onQuit());
    button('unlock racing', 'modes-unlock-racing', () => o.onUnlock('unlock.racing'));
    button('+$100', 'modes-credit', () => o.onCredit(10_000));
    root.append(row);
    this.toastList = document.createElement('ul');
    this.toastList.className = 'dv-modes__toasts';
    this.toastList.dataset['testid'] = 'modes-toasts';
    root.append(this.toastList);
    o.container.append(root);
    this.root = root;
    this.refresh();
  }

  /** Redraws from the view models and the toast log; cheap, and a no-op when nothing changed. */
  refresh(): void {
    const mode = this.o.vm.get<JsonValue>('sys.mode') as { state?: string; stack?: { id: string; state: string }[] } | undefined;
    const wallet = this.o.vm.get<JsonValue>('hud.wallet') as { cashCents?: number } | undefined;
    const unlocks = this.o.vm.get<JsonValue>('sys.unlocks') as string[] | undefined;
    const toasts = this.o.toasts().slice(-3);
    const key = JSON.stringify([mode, wallet, unlocks, toasts.map((t) => t.id)]);
    if (key === this.shown) return;
    this.shown = key;
    const stack = (mode?.stack ?? []).map((e) => `${e.id}:${e.state}`).join(' > ');
    this.state.textContent = `MODE ${mode?.state ?? 'Idle'}${stack ? ` (${stack})` : ''}`;
    this.wallet.textContent = `WALLET ${money(wallet?.cashCents ?? 0)}`;
    this.unlocks.textContent = `UNLOCKED ${unlocks && unlocks.length > 0 ? unlocks.join(', ') : 'none'}`;
    this.toastList.replaceChildren(
      ...toasts.map((t) => {
        const li = document.createElement('li');
        li.textContent = `${t.kind}: ${t.text}`;
        return li;
      }),
    );
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
