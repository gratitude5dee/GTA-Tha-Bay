/**
 * The page's own UI goes before the next 3D frame (BD-FIX-MENU-BOOT-01).
 *
 * A frame of the tier benchmark or of the world behind the menus is one main-thread task as long as the GPU takes to draw it: on a
 * software renderer (the CI runners, Linux WebKit) 0.3 to 2 s, the first world frames with their program links several seconds, and on a
 * slow phone tens to hundreds of ms. Each `requestAnimationFrame` callback of the render loop starts the next such frame, so a page that
 * the shell has just put up (the age screen after Title, the main menu after the Terms) waited behind one or more of them before it was
 * laid out, painted and could take the next tap. The shell notes its work here (a new page, the player's input on the gates), and the
 * benchmark and the host's render loop skip their frame callbacks while the hold lasts: the browser's own frames then carry only the DOM,
 * so the page paints at the next display frame and input runs between frames, and the 3D work goes on when the hold ends. The benchmark
 * leaves out of its measurement the interval that spans a hold (`runSyntheticBenchmark`), so its frame times, and the tier decision, are
 * those of uninterrupted rendering, as 11-platform.md section 5.3 measures them.
 */

/** How long one note holds the 3D frames, ms: enough for the new page to lay out and paint and for the next input to come in. */
export const UI_HOLD_MS = 400;

/** What the benchmark and the render loop read: true while the page's UI goes first. `at` is on the `performance.now()` clock, as rAF times are. */
export interface UiHoldGate {
  held(at: number): boolean;
}

export class UiHold implements UiHoldGate {
  private until = Number.NEGATIVE_INFINITY;
  /** Notes made so far (QA bridge and tests). */
  notes = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly ms: number = UI_HOLD_MS,
  ) {}

  /** The shell put up a page or the player gave it input: the next `ms` belong to the page. */
  note(): void {
    this.notes += 1;
    this.until = Math.max(this.until, this.now() + this.ms);
  }

  held(at: number): boolean {
    return at < this.until;
  }
}
