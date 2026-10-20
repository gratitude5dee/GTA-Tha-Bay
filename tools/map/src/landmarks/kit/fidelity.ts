/**
 * Fidelity rules (M02d1): `hi`, `mid` and `lo` of one landmark come from ONE parameter set. A recipe asks the rules how many
 * segments a round part gets, how many of a repeated element (bays, cables, windows bands) it draws and whether a detail layer is
 * on; the silhouette and the extents stay the same, only the counts fall. `lo` merges the glass class into the matte class, so a
 * `lo` model has at most two render objects (matte and metal).
 */
import { FIDELITY_VARIANT, type Fidelity } from '../../../../../packages/shared/src/assets/fidelity.ts';
import type { MatClass } from './palette.ts';

export type { Fidelity };
export const FIDELITIES: readonly Fidelity[] = ['hi', 'mid', 'lo'];
/** The variant id (and file stem) of a fidelity: hi desktop, mid mobile, lo mobile-low. */
export const variantOf = (f: Fidelity): 'desktop' | 'mobile' | 'mobile-low' => FIDELITY_VARIANT[f] as 'desktop' | 'mobile' | 'mobile-low';

export interface Rules {
  readonly f: Fidelity;
  /** Segments of a round part whose `hi` count is `n` (at least 3). */
  segs(n: number): number;
  /** Count of a repeated element whose `hi` count is `n` (at least `min`, default 1). */
  count(n: number, min?: number): number;
  /** 2 at `hi`, 1 at `mid`, 0 at `lo`: gates ornament layers. */
  readonly detail: 0 | 1 | 2;
  /** Material class a part ends up in at this fidelity (`lo` has no glass class). */
  cls(c: MatClass): MatClass;
  /** Render objects allowed by the budget (3 at hi and mid, 2 at lo). */
  readonly maxObjects: 2 | 3;
}

const SEG_FACTOR: Record<Fidelity, number> = { hi: 1, mid: 0.6, lo: 0.375 };
const COUNT_DIV: Record<Fidelity, number> = { hi: 1, mid: 2, lo: 4 };

export function rulesOf(f: Fidelity): Rules {
  return {
    f,
    segs: (n) => Math.max(3, Math.round(n * SEG_FACTOR[f])),
    count: (n, min = 1) => Math.max(min, Math.ceil(n / COUNT_DIV[f])),
    detail: f === 'hi' ? 2 : f === 'mid' ? 1 : 0,
    cls: (c) => (f === 'lo' && c === 'glass' ? 'matte' : c),
    maxObjects: f === 'lo' ? 2 : 3,
  };
}
