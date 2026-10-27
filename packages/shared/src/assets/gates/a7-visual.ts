/** Gate A7 (spec/domains/05-assets-pipeline.md section 2, S05 values): turntable SSIM of mid and lo against hi, and no black or empty frame. Pure. */
import { finding, type GateFinding } from './types.ts';

export const A7_SSIM_MID = 0.93;
export const A7_SSIM_LO = 0.88;
/** A frame whose mean luminance is below this (0..255) is black. */
export const A7_BLACK_MEAN = 3;
/** A frame whose luminance standard deviation is below this is empty (one flat colour). */
export const A7_EMPTY_STD = 2;

export interface FrameStats {
  meanLuma: number;
  stdLuma: number;
}

export interface VisualStats {
  ssimMid: number;
  ssimLo: number;
  frames: readonly FrameStats[];
}

export function frameStats(luma: ArrayLike<number>): FrameStats {
  const n = luma.length;
  if (n === 0) return { meanLuma: 0, stdLuma: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += luma[i] as number;
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = (luma[i] as number) - mean;
    v += d * d;
  }
  return { meanLuma: mean, stdLuma: Math.sqrt(v / n) };
}

/**
 * Mean SSIM over non-overlapping 8x8 windows of two 8-bit luminance images of the same size (C1 = 6.5025, C2 = 58.5225).
 * Identical images give 1.
 */
export function ssim(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number): number {
  const C1 = 6.5025;
  const C2 = 58.5225;
  const win = 8;
  const n = win * win;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= height; y += win) {
    for (let x = 0; x + win <= width; x += win) {
      let sa = 0;
      let sb = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const k = (y + j) * width + x + i;
          sa += a[k] as number;
          sb += b[k] as number;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const k = (y + j) * width + x + i;
          const da = (a[k] as number) - ma;
          const db = (b[k] as number) - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n - 1;
      vb /= n - 1;
      cov /= n - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count += 1;
    }
  }
  return count === 0 ? 1 : total / count;
}

export function checkA7Visual(file: string, s: VisualStats): GateFinding[] {
  const out: GateFinding[] = [];
  if (s.ssimMid < A7_SSIM_MID) out.push(finding('A7', file, 'ssim-mid', `SSIM mid vs hi ${s.ssimMid.toFixed(3)} is below ${A7_SSIM_MID}`));
  if (s.ssimLo < A7_SSIM_LO) out.push(finding('A7', file, 'ssim-lo', `SSIM lo vs hi ${s.ssimLo.toFixed(3)} is below ${A7_SSIM_LO}`));
  s.frames.forEach((fr, i) => {
    if (fr.meanLuma < A7_BLACK_MEAN) out.push(finding('A7', file, 'frame-black', `turntable frame ${i} is black`));
    else if (fr.stdLuma < A7_EMPTY_STD) out.push(finding('A7', file, 'frame-empty', `turntable frame ${i} is empty`));
  });
  return out;
}
