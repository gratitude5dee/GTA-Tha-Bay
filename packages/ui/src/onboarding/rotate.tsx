/**
 * The rotate overlay (10-ui-hud-xr.md 2.11 rule 4): on touch devices in portrait while a mode is playing, a card covers the HUD, the sim
 * pauses and the overlay clears on the orientation change. Menus work in portrait (2.13 rule 15), so it never shows in the menu.
 */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';

export function isPortrait(w: number, h: number): boolean {
  return h > w;
}

/** True on a touch device: a coarse primary pointer, the last used device, or the QA flag. */
export function touchDevice(args: { coarse: boolean; active: string; forced: boolean }): boolean {
  return args.forced || args.coarse || args.active === 'touch';
}

/** Shows the overlay and pauses the sim while it is up. Rendered only in the playing state. */
export function RotateOverlay() {
  const { ctx } = useShell();
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && isPortrait(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = (): void => setPortrait(isPortrait(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    on();
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touch = touchDevice({ coarse, active: ctx.engine?.activeDevice() ?? 'kbm', forced: ctx.props.forceTouch === true });
  const on = portrait && touch;
  // The sim waits while the card is up and runs again when it clears.
  useEffect(() => {
    if (!on) return undefined;
    ctx.props.hooks.setPaused(true);
    return () => ctx.props.hooks.setPaused(false);
  }, [on]);
  if (!on) return null;
  return (
    <div class="dv-rotate" role="alertdialog" aria-label={t('rotate.title')} data-testid="rotate-overlay">
      <div class="dv-rotate-icon" aria-hidden="true">{'↻'}</div>
      <strong>{t('rotate.title')}</strong>
      <p>{t('rotate.body')}</p>
    </div>
  );
}
