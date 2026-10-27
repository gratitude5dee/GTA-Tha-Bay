/**
 * Lit windows by the hour (M02g1). `look.json` `windows.litFrac` is a cyclic table of `[hour, min, max]` rows: the share of a lit
 * building's windows that are lit, which the façade shader used to take as a fixed 55 to 85 %. At dawn the rows give a few lit windows
 * (a night owl here and there), at 22:00 the old 55 to 85 %. Pure, so the tests run in Node and the shader's uniforms are written from
 * the same numbers the report shows. Whether a building is lit at all stays with the sky's night rule (`buildingLit`).
 */
import { LOOK, type LookFile } from './config.ts';

export interface LitRange {
  min: number;
  max: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** The range of lit shares at a game hour (0..24, wrapped): rows are blended with a smoothstep, the table is cyclic. */
export function litRange(hour: number, look: LookFile = LOOK): LitRange {
  const rows = look.windows.litFrac;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return { min: 0.55, max: 0.85 };
  const h = ((hour % 24) + 24) % 24;
  let a = last;
  let b = first;
  let span = first[0] + 24 - last[0];
  let into = h >= last[0] ? h - last[0] : h + 24 - last[0];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = rows[i + 1];
    if (r && n && h >= r[0] && h < n[0]) {
      a = r;
      b = n;
      span = n[0] - r[0];
      into = h - r[0];
      break;
    }
  }
  const t = span > 0 ? smooth(Math.max(0, Math.min(1, into / span))) : 0;
  return { min: a[1] + (b[1] - a[1]) * t, max: a[2] + (b[2] - a[2]) * t };
}

/** The mean share of lit windows at an hour (the middle of the range). */
export function windowLitFraction(hour: number, look: LookFile = LOOK): number {
  const r = litRange(hour, look);
  return (r.min + r.max) / 2;
}

/** The old fixed range, used where the layer is off (the `legacy` profile and a switched-off `windows` layer). */
export const LIT_RANGE_FIXED: Readonly<LitRange> = Object.freeze({ min: 0.55, max: 0.85 });
