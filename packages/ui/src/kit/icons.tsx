/**
 * The kit's inline SVG icons (10-ui.md "Fonts and icons": icons are inline SVG, not font glyphs). The app ships no font, so a glyph
 * such as U+25AF or U+26D4 falls back to whatever system font the browser finds; macOS, iOS and Quest Browser lack several of them
 * and paint the .notdef box instead (BD-FIX-GLYPH-01). Every HUD icon is therefore a path on a 16 x 16 grid painted in
 * `currentColor`, so the semantic tone still colours it. Icons are decorative (`aria-hidden`); the widget's text carries the name.
 * Pure data plus one tiny component: no DOM access here, so the unit tests render it with plain Preact.
 */

/** One path of an icon: `fill` paints the shape (even-odd, so inner sub-paths cut holes); `stroke` draws a 2-unit round line. */
export interface IconPath { d: string; paint: 'fill' | 'stroke' }

const f = (d: string): IconPath => ({ d, paint: 'fill' });
const s = (d: string): IconPath => ({ d, paint: 'stroke' });
const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

export const ICONS = {
  check: [s('M3 8.5l3.2 3L13 4.5')],
  cross: [s('M4 4l8 8M12 4l-8 8')],
  warning: [f('M8 1.5L15.2 14.5H.8ZM7.1 6h1.8v4.4H7.1ZM7.1 11.4h1.8v1.7H7.1Z')],
  diamond: [f('M8 1l7 7-7 7-7-7Z')],
  dot: [f(circle(8, 8, 4.5))],
  /** Heat clear: a shield with a tick. */
  shield: [s('M8 1.6l5.4 2v4.2c0 3.3-2.3 5.6-5.4 6.6-3.1-1-5.4-3.3-5.4-6.6V3.6Z'), s('M5.4 8.1l1.9 1.9 3.4-3.6')],
  /** Heat wanted: a light bar dome with rays. */
  siren: [f('M4 12.2V8.6a4 4 0 0 1 8 0v3.6Z'), f('M2.5 12.8h11v2h-11Z'), s('M8 1v1.6M2.6 3.4l1.1 1.1M13.4 3.4l-1.1 1.1')],
  search: [s(circle(6.8, 6.8, 4.3)), s('M10.1 10.1L14.2 14.2')],
  cooldown: [s('M13 8.5a5 5 0 1 1-1.6-4.2'), f('M14.3 1.4v5H9.3Z')],
  spark: [f('M8 .6l1.8 5.6 5.6 1.8-5.6 1.8L8 15.4 6.2 9.8.6 8l5.6-1.8Z')],
  heart: [f('M8 14.4S1.4 10.3 1.4 5.7A3.3 3.3 0 0 1 8 4.3a3.3 3.3 0 0 1 6.6 1.4C14.6 10.3 8 14.4 8 14.4Z')],
  signal: [f('M1.8 10.5h2.8v3.7H1.8ZM6.6 6.6h2.8v7.6H6.6ZM11.4 2.6h2.8v11.6h-2.8Z')],
  ellipsis: [f(`${circle(3, 8, 1.6)}${circle(8, 8, 1.6)}${circle(13, 8, 1.6)}`)],
  clock: [s(circle(8, 8, 6.3)), s('M8 4.4V8l2.6 1.6')],
  wrench: [s('M10.4 1.9a3.4 3.4 0 0 0-3.1 4.7L2 11.9 4.1 14l5.3-5.3a3.4 3.4 0 0 0 4.7-3.1l-2.1.6-1.7-1.7Z')],
  blocked: [s(circle(8, 8, 6.3)), s('M3.6 3.6l8.8 8.8')],
  info: [s(circle(8, 8, 6.3)), f('M7.1 3.8h1.8v1.8H7.1ZM7.1 6.9h1.8v5.3H7.1Z')],
  bar: [f('M1.5 5h13v6h-13Z')],
} as const satisfies Record<string, readonly IconPath[]>;

export type IconId = keyof typeof ICONS;
export const ICON_IDS = Object.keys(ICONS) as IconId[];

/** An inline icon in `currentColor`, 1em square, hidden from assistive tech (the widget's own text names the state). */
export function Icon(props: { name: IconId; class?: string; testId?: string }) {
  return (
    <svg
      class={props.class ? `dv-svg-icon ${props.class}` : 'dv-svg-icon'}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      data-icon={props.name}
      data-testid={props.testId}
    >
      {ICONS[props.name].map((p, i) =>
        p.paint === 'fill' ? (
          <path key={i} d={p.d} fill="currentColor" fill-rule="evenodd" />
        ) : (
          <path key={i} d={p.d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        ),
      )}
    </svg>
  );
}

/**
 * One heat bar of the five (10-ui-hud-xr.md: five heat bars, no star glyphs). The bars rise in height like a signal meter so the
 * row reads as a level; an unlit bar is a dim solid bar, never an outlined box, so it cannot be mistaken for a missing glyph.
 */
export function HeatBar(props: { index: number; lit: boolean }) {
  const h = 6 + 2 * Math.max(1, Math.min(5, props.index));
  return (
    <svg class="dv-svg-icon dv-heat-bar" viewBox="0 0 8 16" width="0.5em" height="1em" aria-hidden="true" focusable="false" data-icon="heat-bar" data-lit={props.lit ? '1' : '0'}>
      <rect x="1" y={16 - h} width="6" height={h} rx="1.5" fill="currentColor" />
    </svg>
  );
}
