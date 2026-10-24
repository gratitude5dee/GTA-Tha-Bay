/**
 * CutsceneOverlay (10-ui-hud-xr.md section 2 item 3, M04c): the DOM layer above a covering clip. A skip button (Escape, gamepad B and
 * a tap or click all send `UiCommand {t: 'cutscene.skip'}`, exactly once per showing), subtitles with the minimum cue time, and the
 * AI-generated chip for the whole clip when the manifest says so. A cue-only in-engine sequence has no manifest and shows no chip.
 * The HUD is hidden by the host (`data-dv-cutscene` on the document element).
 */
import { render } from 'preact';
import type { UiCommand } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { activeCue, type Cue } from './subtitles.ts';

export interface OverlayShow {
  /** True when the clip's manifest has `provenance.aiGenerated`; false or absent for an in-engine sequence (no manifest). */
  aiGenerated: boolean;
  /** `licence.uiCredit` when the manifest carries one. */
  credit?: string;
  cues: readonly Cue[];
}

export interface OverlayView { chip: boolean; credit: string | null; cue: string | null }

/** What is on screen at `timeMs`. */
export function overlayView(s: OverlayShow, timeMs: number): OverlayView {
  return { chip: s.aiGenerated, credit: s.aiGenerated && s.credit ? s.credit : null, cue: activeCue(s.cues, timeMs)?.text ?? null };
}

/** The standard gamepad mapping's B button. */
export const PAD_B = 1;

/** Which input asked for a skip (logged by the page; BD-FU-B03). */
export interface SkipSource {
  input: 'key' | 'pad' | 'tap' | 'button';
  /** The DOM event behind it (`keydown`, `pointerup`, `click`); absent for the pad. */
  event?: string;
  pointerType?: string;
  trusted?: boolean;
  /** `PointerEvent.pointerId` of a tap. */
  pointerId?: number;
}

/**
 * Sends `cutscene.skip` at most once per showing, whichever deliberate input comes first (R-ENG-04: key, button or tap; BD-FU-B03):
 * an Escape press that is not a key repeat, the edge of gamepad B, a click on the skip button, or a tap: a press that began on the
 * overlay while it showed and is let go there. The release of a press that began before the overlay came up (a finger kept on the
 * touch stick, a mouse drag, the click that started the game) is not a skip, and neither is an untrusted (script-made) event.
 */
export class SkipController {
  private sent = false;
  private padWasDown = true;
  /** The pointer whose press began on the overlay during this showing. */
  private pressed: number | null = null;
  constructor(
    private readonly send: (cmd: UiCommand) => void,
    private readonly onSkip?: (s: SkipSource) => void,
  ) {}

  reset(): void {
    this.sent = false;
    // A B button held while the clip starts does not count as a press, nor does a pointer pressed before it.
    this.padWasDown = true;
    this.pressed = null;
  }
  skip(source: SkipSource): void {
    if (this.sent) return;
    this.sent = true;
    this.onSkip?.(source);
    this.send({ t: 'cutscene.skip' });
  }
  key(e: { key: string; isTrusted?: boolean; repeat?: boolean }): void {
    if (e.key !== 'Escape' || e.repeat === true || e.isTrusted === false) return;
    this.skip({ input: 'key', event: 'keydown', ...(e.isTrusted !== undefined ? { trusted: e.isTrusted } : {}) });
  }
  /** Feed the pressed state of the pad buttons every frame; the edge of B skips. */
  pad(pressed: ArrayLike<boolean>): void {
    const down = pressed[PAD_B] === true;
    if (down && !this.padWasDown) this.skip({ input: 'pad' });
    this.padWasDown = down;
  }
  /** A whole tap (press and release on the overlay). */
  tap(source: Omit<SkipSource, 'input'> = {}): void {
    this.skip({ input: 'tap', ...source });
  }
  /** `pointerdown` on the overlay: the primary button of a mouse, or a touch or pen contact. */
  pointerDown(e: PointerLike): void {
    if (e.isTrusted === false || (e.button !== undefined && e.button !== 0)) return;
    this.pressed = e.pointerId ?? 0;
  }
  /** `pointerup` on the overlay: a tap only when the same pointer's press began here during this showing. */
  pointerUp(e: PointerLike): void {
    const id = e.pointerId ?? 0;
    if (this.pressed === null || this.pressed !== id || e.isTrusted === false) return;
    this.pressed = null;
    this.tap(describe(e));
  }
  pointerCancel(e: PointerLike): void {
    if (this.pressed === (e.pointerId ?? 0)) this.pressed = null;
  }
  button(source: Omit<SkipSource, 'input'> = {}): void {
    this.skip({ input: 'button', ...source });
  }
}

export type PointerLike = { type: string; pointerType?: string; isTrusted?: boolean; pointerId?: number; button?: number };
const describe = (e: PointerLike): Omit<SkipSource, 'input'> => ({
  event: e.type,
  ...(e.pointerType !== undefined ? { pointerType: e.pointerType } : {}),
  ...(e.isTrusted !== undefined ? { trusted: e.isTrusted } : {}),
  ...(e.pointerId !== undefined ? { pointerId: e.pointerId } : {}),
});

export interface CutsceneOverlayProps {
  view: OverlayView;
  onPointerDown(e: PointerLike): void;
  onPointerUp(e: PointerLike): void;
  onPointerCancel(e: PointerLike): void;
  onButton(s: Omit<SkipSource, 'input'>): void;
}

export function CutsceneOverlay(props: CutsceneOverlayProps) {
  const { view } = props;
  return (
    <div
      class="dv-cutscene"
      data-testid="cutscene-overlay"
      onPointerDown={(e) => props.onPointerDown(e)}
      onPointerUp={(e) => props.onPointerUp(e)}
      onPointerCancel={(e) => props.onPointerCancel(e)}
    >
      {view.chip ? (
        <div class="dv-cutscene-chip" data-testid="cutscene-ai-chip">
          <span>{t('cutscene.ai')}</span>
          {view.credit ? <small>{view.credit}</small> : null}
        </div>
      ) : null}
      <button
        type="button"
        class="dv-btn dv-btn-secondary dv-cutscene-skip"
        data-testid="cutscene-skip"
        data-fid="cutscene.skip"
        aria-label={t('cutscene.skip')}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => props.onButton(describe(e))}
      >
        {t('cutscene.skip')}
      </button>
      <p class="dv-cutscene-sub" data-testid="cutscene-subtitle" role="status" aria-live="polite">
        {view.cue ?? ''}
      </p>
    </div>
  );
}

export interface PadSource { (): readonly ({ buttons: ArrayLike<{ pressed: boolean }> } | null)[] }
export interface KeyLike { key: string; isTrusted?: boolean; repeat?: boolean; stopPropagation?(): void; preventDefault?(): void }
export interface KeyTarget {
  addEventListener(t: 'keydown', l: (e: KeyLike) => void, capture?: boolean): void;
  removeEventListener(t: 'keydown', l: (e: KeyLike) => void, capture?: boolean): void;
}

export interface OverlayMountOptions {
  sendUi(cmd: UiCommand): void;
  /** Told which input skipped, just before `cutscene.skip` is sent (the page logs it; BD-FU-B03). */
  onSkip?(s: SkipSource): void;
  keys?: KeyTarget;
  pads?: PadSource;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}

export interface OverlayHandle {
  show(s: OverlayShow): void;
  setTime(ms: number): void;
  hide(): void;
  readonly visible: boolean;
}

/** Mounts the overlay into `root` (the host's `overlayRoot`). Rendering happens only when the visible text or chip changes. */
export function mountCutsceneOverlay(root: Element, opts: OverlayMountOptions): OverlayHandle {
  const keys = opts.keys ?? (globalThis as unknown as { window: KeyTarget }).window;
  const pads: PadSource = opts.pads ?? (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
  const raf = opts.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));
  const skip = new SkipController(opts.sendUi, opts.onSkip);
  let current: OverlayShow | null = null;
  let timeMs = 0;
  let last = '';
  let rafId = 0;
  // Capture phase: Escape ends the clip and must not also reach the game's Pause binding underneath.
  const onKey = (e: KeyLike): void => {
    if (e.key === 'Escape') {
      e.stopPropagation?.();
      e.preventDefault?.();
    }
    skip.key(e);
  };

  const paint = (): void => {
    if (current === null) return;
    const view = overlayView(current, timeMs);
    const sig = `${view.chip}|${view.credit}|${view.cue}`;
    if (sig === last) return;
    last = sig;
    render(
      <CutsceneOverlay
        view={view}
        onPointerDown={(e) => skip.pointerDown(e)}
        onPointerUp={(e) => skip.pointerUp(e)}
        onPointerCancel={(e) => skip.pointerCancel(e)}
        onButton={(d) => skip.button(d)}
      />,
      root,
    );
  };
  const poll = (): void => {
    for (const p of pads()) {
      if (p) {
        skip.pad(Array.from({ length: Math.max(p.buttons.length, PAD_B + 1) }, (_, i) => p.buttons[i]?.pressed === true));
        break;
      }
    }
    rafId = raf(poll);
  };

  return {
    show(s) {
      current = s;
      timeMs = 0;
      last = '';
      skip.reset();
      keys.addEventListener('keydown', onKey, true);
      rafId = raf(poll);
      paint();
    },
    setTime(ms) {
      timeMs = ms;
      paint();
    },
    hide() {
      if (current === null) return;
      current = null;
      keys.removeEventListener('keydown', onKey, true);
      caf(rafId);
      render(null, root);
    },
    get visible() {
      return current !== null;
    },
  };
}
