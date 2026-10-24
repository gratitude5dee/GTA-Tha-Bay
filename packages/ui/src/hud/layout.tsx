/**
 * The HUD grid (10-ui-hud-xr.md 2.10): one DOM layer with six regions. Padding is `max(safe-area, hudSafeMarginPct)`, `hudScale` and
 * `hudOpacity` come from `UiPrefs`, the palette variables from `ProfileSettings.accessibility.hudPalette`. Pointer events pass through to
 * the game; only the regions that hold controls would opt back in.
 */
import type { ComponentChildren } from 'preact';
import { useShell } from '../shell/context.tsx';
import { paletteVars } from './model.ts';

export type HudRegion = 'tl' | 'tr' | 'bl' | 'br' | 'bc' | 'c';
export const HUD_REGIONS: readonly HudRegion[] = ['tl', 'tr', 'bl', 'br', 'bc', 'c'];

export function HudGrid(props: { regions: Partial<Record<HudRegion, ComponentChildren>>; hidden?: Partial<Record<HudRegion, boolean>>; palette?: string; scale: number; opacity: number; marginPct: number }) {
  const style: Record<string, string> = {
    '--dv-hud-scale': String(props.scale),
    '--dv-hud-opacity': String(props.opacity),
    '--dv-hud-margin': `${props.marginPct}vmin`,
    ...paletteVars(props.palette),
  };
  return (
    <div class="dv-hud" data-testid="hud" data-palette={props.palette ?? 'default'} style={style}>
      {HUD_REGIONS.map((r) => (
        <div key={r} class={`dv-hud-region dv-hud-${r}`} data-region={r} {...(props.hidden?.[r] ? { 'data-hidden': 'true', 'aria-hidden': 'true' } : {})}>
          {props.regions[r]}
        </div>
      ))}
    </div>
  );
}

/** Reads the HUD preferences from the shell context. */
export function useHudPrefs(): { scale: number; opacity: number; marginPct: number; palette: string } {
  const { ctx } = useShell();
  const p = ctx.props.prefs.get();
  return { scale: p.hudScale, opacity: p.hudOpacity, marginPct: p.hudSafeMarginPct, palette: ctx.settings?.accessibility.hudPalette ?? 'default' };
}
