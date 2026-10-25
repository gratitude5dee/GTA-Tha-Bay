import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';

/**
 * The frame-rate chip (M04b5), shown while `UiPrefs.showFps` is on: top right inside the safe area, above the HUD layer, in menus and
 * in play. One node, updated by `textContent` once a second; hidden from assistive tech and from translators. Never drawn in XR.
 */
export function FpsChip() {
  const { ctx } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const platform = ctx.platform;
  const xr = platform?.deviceClass === 'xr';
  useEffect(() => {
    if (ref.current && !ref.current.textContent) ref.current.textContent = t('hud.empty');
    if (xr || !platform?.onFrameStats) return undefined;
    return platform.onFrameStats((s) => {
      if (ref.current) ref.current.textContent = t('hud.fps.line', { fps: s.fps });
    });
  }, [platform, xr]);
  if (xr) return null;
  return (
    <div ref={ref} class="dv-fpschip" data-testid="fps-chip" aria-hidden="true" data-ui-skip="" translate={false} />
  );
}
