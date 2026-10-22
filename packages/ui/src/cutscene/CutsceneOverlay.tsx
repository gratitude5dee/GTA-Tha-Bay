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

/** Sends `cutscene.skip` at most once per showing, whichever input comes first. */
export class SkipController {
  private sent = false;
  private padWasDown = true;
  constructor(private readonly send: (cmd: UiCommand) => void) {}

  reset(): void {
    this.sent = false;
    // A B button held while the clip starts does not count as a press.
    this.padWasDown = true;
  }
  skip(): void {
    if (this.sent) return;
    this.sent = true;
    this.send({ t: 'cutscene.skip' });
  }
  key(e: { key: string }): void {
    if (e.key === 'Escape') this.skip();
  }
  /** Feed the pressed state of the pad buttons every frame; the edge of B skips. */
  pad(pressed: ArrayLike<boolean>): void {
    const down = pressed[PAD_B] === true;
    if (down && !this.padWasDown) this.skip();
    this.padWasDown = down;
  }
  tap(): void {
    this.skip();
  }
}

export interface CutsceneOverlayProps { view: OverlayView; onSkip(): void }

export function CutsceneOverlay(props: CutsceneOverlayProps) {
  const { view } = props;
  return (
    <div class="dv-cutscene" data-testid="cutscene-overlay" onPointerUp={() => props.onSkip()}>
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
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => props.onSkip()}
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
export interface KeyLike { key: string; stopPropagation?(): void; preventDefault?(): void }
export interface KeyTarget {
  addEventListener(t: 'keydown', l: (e: KeyLike) => void, capture?: boolean): void;
  removeEventListener(t: 'keydown', l: (e: KeyLike) => void, capture?: boolean): void;
}

export interface OverlayMountOptions {
  sendUi(cmd: UiCommand): void;
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
  const skip = new SkipController(opts.sendUi);
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
    render(<CutsceneOverlay view={view} onSkip={() => skip.tap()} />, root);
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
