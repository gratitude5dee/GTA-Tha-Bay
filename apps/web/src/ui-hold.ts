/**
 * What the page notes on the engine's `UiHold` (BD-FIX-MENU-BOOT-01): the shell's work goes before the next frame of the tier benchmark
 * or of the world behind the menus, each of which is one long main-thread task on a slow GPU (seconds on the CI's software renderers).
 *
 * - A new page the shell puts up, outside play: the page lays out and paints at the next display frame instead of after a 3D frame. In
 *   play (`InMode`), on the loading screen and in recovery the world's frames are the content, so a page change there (the phone over the
 *   game) holds nothing.
 * - The player's input while the gates are up (Title, the age screen, the Terms card, the blocked page, the boot screen): taps and typing
 *   run between frames. Nothing behind the gates is live 3D the player is looking at. In the menus input holds nothing, so the
 *   creator's preview and the Settings' live changes keep drawing while the player drags a slider.
 */
export interface UiHoldShell {
  readonly state: string;
  currentPage(): string;
  subscribe(cb: () => void): () => void;
}

export interface UiHoldRoot {
  addEventListener(type: string, cb: () => void, options: AddEventListenerOptions): void;
  removeEventListener(type: string, cb: () => void, options: EventListenerOptions): void;
}

/** States whose pages go before the 3D frames when they change (everything but play, the loading screen and recovery). */
export const PLAY_STATES: ReadonlySet<string> = new Set(['InMode', 'Loading', 'Recovering']);
/** States in which the player's input on the shell holds the 3D frames. */
export const GATE_STATES: ReadonlySet<string> = new Set(['Booting', 'Title', 'AgeGate', 'Terms', 'Blocked']);
/** The input that holds: a press, a key, typed text. Pointer moves never hold. */
export const HOLD_INPUT = ['pointerdown', 'keydown', 'input'] as const;

export function wireUiHold(o: { core: UiHoldShell; root: UiHoldRoot; hold: { note(): void } }): () => void {
  let shown = o.core.currentPage();
  const off = o.core.subscribe(() => {
    const page = o.core.currentPage();
    if (page === shown) return;
    shown = page;
    if (!PLAY_STATES.has(o.core.state)) o.hold.note();
  });
  const onInput = (): void => {
    if (GATE_STATES.has(o.core.state)) o.hold.note();
  };
  for (const type of HOLD_INPUT) o.root.addEventListener(type, onInput, { capture: true, passive: true });
  return () => {
    off();
    for (const type of HOLD_INPUT) o.root.removeEventListener(type, onInput, { capture: true });
  };
}
