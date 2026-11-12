/**
 * What the page notes on the engine's `UiHold` (BD-FIX-MENU-BOOT-01): the shell's work goes before the next frame of the tier benchmark
 * or of the world behind the menus, each of which is one long main-thread task on a slow GPU (seconds on the CI's software renderers).
 *
 * - A new page the shell puts up in the menus (the gates, the boot screen, the main menu and the pages over it): the page lays out and
 *   paints at the next display frame instead of after a 3D frame.
 * - The player's input while the gates are up (Title, the age screen, the Terms card, the blocked page, the boot screen): taps and typing
 *   run between frames. Nothing behind the gates is live 3D the player is looking at. In the main menu input holds nothing, so the
 *   creator's preview and the Settings' live changes keep drawing while the player drags a slider.
 * - Never while a game runs (second round): not in play, not on the loading screen, not in recovery, not on the pause page or the phone
 *   over the game (`Paused`), and not in the menu a quit has just opened while the sim still runs the mode (`sys.mode` not yet `Idle`). A
 *   held frame skips the engine hand-off that sends the sim its frame signal and reads its snapshots, and the first frame after a hold
 *   starts the clocks fresh, so a hold there stopped the game and then lost a frame of its ticks: a weather change made in the phone's
 *   Sandbox app reached the sky three heavy frames after Resume instead of two (sandbox-world.spec.ts on the CI runner). Any hold still
 *   in force when the shell leaves the menus is released at once.
 */
export interface UiHoldShell {
  readonly state: string;
  currentPage(): string;
  /** The engine's mode host as the shell sees it (`sys.mode`): `Idle` when no mode runs (and before the engine is attached). */
  mode(): { state: string };
  subscribe(cb: () => void): () => void;
}

export interface UiHoldRoot {
  addEventListener(type: string, cb: () => void, options: AddEventListenerOptions): void;
  removeEventListener(type: string, cb: () => void, options: EventListenerOptions): void;
}

/** What `wireUiHold` drives: a note per new menu page or gate input, a release whenever the shell is outside the menus. */
export interface UiHoldTarget {
  note(): void;
  release(): void;
}

/** States whose pages go before the 3D frames when they change: the boot screen, the gates and the main menu with its pages. */
export const MENU_STATES: ReadonlySet<string> = new Set(['Booting', 'Title', 'AgeGate', 'Terms', 'Blocked', 'Menu']);
/** States in which the player's input on the shell holds the 3D frames. */
export const GATE_STATES: ReadonlySet<string> = new Set(['Booting', 'Title', 'AgeGate', 'Terms', 'Blocked']);
/** The input that holds: a press, a key, typed text. Pointer moves never hold. */
export const HOLD_INPUT = ['pointerdown', 'keydown', 'input'] as const;

/** True while the shell shows a menu and no mode runs in the sim: the only time the 3D frames may wait for the page. */
export function inMenus(core: Pick<UiHoldShell, 'state' | 'mode'>): boolean {
  return MENU_STATES.has(core.state) && core.mode().state === 'Idle';
}

export function wireUiHold(o: { core: UiHoldShell; root: UiHoldRoot; hold: UiHoldTarget }): () => void {
  let shown = o.core.currentPage();
  const off = o.core.subscribe(() => {
    const menus = inMenus(o.core);
    if (!menus) o.hold.release();
    const page = o.core.currentPage();
    if (page === shown) return;
    shown = page;
    if (menus) o.hold.note();
  });
  const onInput = (): void => {
    if (GATE_STATES.has(o.core.state) && inMenus(o.core)) o.hold.note();
  };
  for (const type of HOLD_INPUT) o.root.addEventListener(type, onInput, { capture: true, passive: true });
  return () => {
    off();
    for (const type of HOLD_INPUT) o.root.removeEventListener(type, onInput, { capture: true });
  };
}
