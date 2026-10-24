/**
 * The minimap in HUD slot `bl` (M02c2; 10-ui-hud-xr.md 2.10, 02-world-maps.md section 2). The world's `MapLayer` finds the canvas by its
 * id (`dv-minimap-canvas`, also when the HUD remounts) and draws into it at 30 Hz (20 Hz on `mobile-low`). The slot has no attribution
 * label by design (the OSM and DataSF line is in the boot splash, the full-map corner and the credits). A press on the circle toggles
 * heading-up and north-up (Q-MAP-01); the canvas keeps its place whether or not a world runs.
 */
import { useState } from 'preact/hooks';
import { t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';

export const MINIMAP_CANVAS_ID = 'dv-minimap-canvas';

export function MinimapSlot() {
  const { ctx } = useShell();
  const [north, setNorth] = useState<boolean>(() => ctx.props.map?.()?.northUp() ?? false);
  const toggle = (): void => {
    const port = ctx.props.map?.();
    if (!port) return;
    const next = !port.northUp();
    port.setNorthUp(next);
    setNorth(next);
  };
  return (
    <div class="dv-minimap" data-testid="hud-minimap" data-north-up={north ? '1' : '0'} role="img" aria-label={t('hud.minimap.label')}>
      <canvas id={MINIMAP_CANVAS_ID} width={160} height={160} />
      <button type="button" class="dv-minimap-toggle" data-testid="hud-minimap-toggle" aria-pressed={north ? 'true' : 'false'} aria-label={t('hud.minimap.toggle')} onClick={toggle} />
    </div>
  );
}
