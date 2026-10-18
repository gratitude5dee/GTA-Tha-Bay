/**
 * detmath: portable elementary functions for sim code (C02 determinism rules 1 and 2).
 *
 * Only + - * / (correctly rounded by IEEE 754), Math.abs/min/max/floor/ceil/round/trunc/sign/fround/imul/clz32 and
 * integer bit operations are used, so the same inputs give the same bits in every engine. The algorithms are ports of
 * the FreeBSD msun/fdlibm kernels (public domain, Sun Microsystems 1993): __kernel_sin, __kernel_cos, the
 * Cody-Waite reduction of __ieee754_rem_pio2, atan, atan2, exp and log. Error bounds against Math.* are in the spec
 * (M01a1 Notes) and checked by packages/shared/test/detmath.vectors.spec.ts.
 *
 * dsqrt never delegates to Math.sqrt (U-ENG-1): Newton iteration plus one exact residual correction.
 * Inputs beyond the documented range (|x| > 1e9 for dsin/dcos) give a deterministic value in [-1, 1] whose
 * accuracy is not guaranteed.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

// Float64 <-> two u32 words. Little endian: word 1 is the high word.
const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
F[0] = 1;
if (U[1] !== 0x3ff00000 || U[0] !== 0) {
  throw new Error('@dv/shared detmath: little-endian platform required');
}

/** Unbiased binary exponent of a normal double (-1023 for zero and subnormals). */
function expo(x: number): number {
  F[0] = x;
  return (((U[1] as number) >>> 20) & 0x7ff) - 1023;
}

/** 2^n for n in [-1022, 1023], exact. */
function pow2(n: number): number {
  U[1] = (n + 1023) << 20;
  U[0] = 0;
  return F[0] as number;
}

const P2_1023 = pow2(1023);
const P2_M1022 = pow2(-1022);
const TWO54 = 18014398509481984; // 2^54

/** x * 2^n with a single final rounding (also for subnormal results). */
function ldexp(x: number, n: number): number {
  if (x === 0 || x !== x || x === Infinity || x === -Infinity) return x;
  if (n > 2200) n = 2200;
  else if (n < -2200) n = -2200;
  while (n > 1023) {
    x *= P2_1023;
    n -= 1023;
  }
  while (n < -1022) {
    x *= P2_M1022;
    n += 1022;
  }
  return x * pow2(n);
}

// ---------------------------------------------------------------- sqrt

/** Square root. Newton iteration plus an exact-residual correction, so the result is within 1 ulp of Math.sqrt. */
export function dsqrt(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0 || x === Infinity) return x;
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= TWO54;
    e = -54;
  }
  F[0] = x;
  let E = (((U[1] as number) >>> 20) & 0x7ff) - 1023 + e;
  U[1] = ((U[1] as number) & 0x000fffff) | 0x3ff00000;
  let m = F[0] as number; // [1, 2)
  if ((E & 1) !== 0) {
    m *= 2; // exact; m in [2, 4)
    E -= 1;
  }
  let y = (m + 1) * 0.5;
  for (let i = 0; i < 7; i++) y = 0.5 * (y + m / y);
  // y*y = p + err exactly (Veltkamp split), so r = m - y*y is nearly exact.
  const c = 134217729 * y;
  const yh = c - (c - y);
  const yl = y - yh;
  const p = y * y;
  const err = ((yh * yh - p) + 2 * yh * yl) + yl * yl;
  const r = (m - p) - err;
  y = y + r / (2 * y);
  return y * pow2(E >> 1);
}

// ---------------------------------------------------------------- sin, cos

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4] with tail y (x + y is the reduced argument). */
function kernelSin(x: number, y: number): number {
  if (Math.abs(x) < 7.450580596923828e-9) return x; // 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos on [-pi/4, pi/4] with tail y. */
function kernelCos(x: number, y: number): number {
  const ax = Math.abs(x);
  if (ax < 7.450580596923828e-9) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ax < 0.3) return 1 - (0.5 * z - (z * r - x * y));
  let qx: number;
  if (ax > 0.78125) {
    qx = 0.28125;
  } else {
    // x / 4 with the low word cleared, as in fdlibm.
    F[0] = ax;
    U[1] = (U[1] as number) - 0x00200000;
    U[0] = 0;
    qx = F[0] as number;
  }
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const QUARTER_PI = 7.853981633974483e-01;
const CODY_WAITE_MAX = 1647099; // 2^20 * pi/2: n * PIO2_1 stays exact below this

let ry0 = 0;
let ry1 = 0;

/** t mod TWO_PI by exact binary long division with the double constant TWO_PI (t finite, > 0). */
function fmodTwoPi(t: number): number {
  const et = expo(t);
  const ep = expo(TWO_PI);
  for (let e = et - ep; e >= 0; e--) {
    const m = ldexp(TWO_PI, e);
    if (t >= m) t -= m;
  }
  return t;
}

/** Reduce x to y0 + y1 in [-pi/4, pi/4]; returns n with x = n * pi/2 + (y0 + y1) mod 2 pi. Writes ry0 and ry1. */
function reducePio2(x: number): number {
  const neg = x < 0;
  let t = neg ? -x : x;
  if (t <= QUARTER_PI) {
    ry0 = x;
    ry1 = 0;
    return 0;
  }
  if (t >= CODY_WAITE_MAX) t = fmodTwoPi(t);
  const n = Math.floor(t * INV_PIO2 + 0.5);
  let r = t - n * PIO2_1;
  let w = n * PIO2_1T;
  const j = expo(t);
  let y0 = r - w;
  let i = j - expo(y0);
  if (i > 16) {
    t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - ((t - r) - w);
    y0 = r - w;
    i = j - expo(y0);
    if (i > 49) {
      t = r;
      w = n * PIO2_3;
      r = t - w;
      w = n * PIO2_3T - ((t - r) - w);
      y0 = r - w;
    }
  }
  const y1 = (r - y0) - w;
  if (neg) {
    ry0 = -y0;
    ry1 = -y1;
    return -n;
  }
  ry0 = y0;
  ry1 = y1;
  return n;
}

export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = reducePio2(x);
  switch (n & 3) {
    case 0: return kernelSin(ry0, ry1);
    case 1: return kernelCos(ry0, ry1);
    case 2: return -kernelSin(ry0, ry1);
    default: return -kernelCos(ry0, ry1);
  }
}

export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const n = reducePio2(x);
  switch (n & 3) {
    case 0: return kernelCos(ry0, ry1);
    case 1: return -kernelSin(ry0, ry1);
    case 2: return -kernelCos(ry0, ry1);
    default: return kernelSin(ry0, ry1);
  }
}

// ---------------------------------------------------------------- atan, atan2

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
] as const;

/** atan(x) for any double (fdlibm s_atan.c). */
function atan(x: number): number {
  const neg = x < 0 || (x === 0 && 1 / x < 0);
  const ax = neg ? -x : x;
  if (ax !== ax) return x;
  if (ax >= 7.378697629483821e19) { // 2^66
    const r = (ATAN_HI[3] as number) + (ATAN_LO[3] as number);
    return neg ? -r : r;
  }
  let id: number;
  let t = ax;
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x;
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      t = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      t = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    t = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    t = -1 / ax;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * ((AT[0]) + w * ((AT[2]) + w * ((AT[4]) + w * ((AT[6]) + w * ((AT[8]) + w * (AT[10]))))));
  const s2 = w * ((AT[1]) + w * ((AT[3]) + w * ((AT[5]) + w * ((AT[7]) + w * (AT[9])))));
  if (id < 0) {
    const r = t - t * (s1 + s2);
    return neg ? -r : r;
  }
  const r = (ATAN_HI[id] as number) - ((t * (s1 + s2) - (ATAN_LO[id] as number)) - t);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16;

/** atan2(y, x) with the same special cases as Math.atan2 (fdlibm e_atan2.c). */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  F[0] = x;
  const hx = U[1] as number;
  const lx = U[0] as number;
  const ix = hx & 0x7fffffff;
  F[0] = y;
  const hy = U[1] as number;
  const ly = U[0] as number;
  const iy = hy & 0x7fffffff;
  if (x === 1) return atan(y);
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2 * sign(x) + sign(y)
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1: return y;
      case 2: return PI;
      default: return -PI;
    }
  }
  if ((ix | lx) === 0) return hy >>> 31 !== 0 ? -HALF_PI : HALF_PI;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return QUARTER_PI;
        case 1: return -QUARTER_PI;
        case 2: return 3 * QUARTER_PI;
        default: return -3 * QUARTER_PI;
      }
    }
    switch (m) {
      case 0: return 0;
      case 1: return -0;
      case 2: return PI;
      default: return -PI;
    }
  }
  if (iy === 0x7ff00000) return hy >>> 31 !== 0 ? -HALF_PI : HALF_PI;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = HALF_PI + 0.5 * PI_LO;
    m &= 1;
  } else if (hx >>> 31 !== 0 && k < -60) {
    z = 0;
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---------------------------------------------------------------- exp, log

const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const EP1 = 1.66666666666666019037e-01;
const EP2 = -2.77777777770155933842e-03;
const EP3 = 6.61375632143793436117e-05;
const EP4 = -1.65339022054652515390e-06;
const EP5 = 4.13813679705723846039e-08;
const EXP_OVERFLOW = 7.09782712893383973096e+02;
const EXP_UNDERFLOW = -7.45133219101941108420e+02;

export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > EXP_OVERFLOW) return Infinity;
  if (x < EXP_UNDERFLOW) return 0;
  let hi = 0;
  let lo = 0;
  let k = 0;
  const ax = Math.abs(x);
  if (ax > 0.34657359027997264) {
    if (ax < 1.0397207708399179) {
      if (x > 0) {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      } else {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      }
    } else {
      k = Math.trunc(INV_LN2 * x + (x > 0 ? 0.5 : -0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (EP1 + t * (EP2 + t * (EP3 + t * (EP4 + t * EP5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  return ldexp(y, k);
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

export function dlog(x: number): number {
  if (x !== x) return NaN;
  F[0] = x;
  let hx = (U[1] as number) | 0;
  const lx = U[0] as number;
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    F[0] = x;
    hx = (U[1] as number) | 0;
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  U[1] = hx | (i0 ^ 0x3ff00000);
  x = F[0] as number;
  k += i0 >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  let i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

// ---------------------------------------------------------------- pow, hypot, angles

function isIntegral(y: number): boolean {
  return Math.floor(y) === y;
}

function isOddInteger(y: number): boolean {
  return isIntegral(y) && Math.abs(y) < 9007199254740992 && y % 2 !== 0;
}

/** base^n for integer n >= 0 by repeated squaring (exact multiplications, each rounded once). */
function powInt(base: number, n: number): number {
  let result = 1;
  let b = base;
  while (n > 0) {
    if (n % 2 === 1) result *= b;
    n = Math.floor(n / 2);
    if (n > 0) b *= b;
  }
  return result;
}

/**
 * x^y with the special cases of Math.pow. Integer exponents use repeated squaring (relative error about
 * |y| * 1.1e-16). Other exponents use exp(y * log x), so the relative error is about |y * ln x| * 2.2e-16.
 */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  const ay = Math.abs(y);
  if (ay === Infinity) {
    const ax = Math.abs(x);
    if (ax === 1) return NaN;
    return (ax > 1) === (y > 0) ? Infinity : 0;
  }
  const odd = isOddInteger(y);
  if (x === Infinity) return y > 0 ? Infinity : 0;
  if (x === -Infinity) {
    if (y > 0) return odd ? -Infinity : Infinity;
    return odd ? -0 : 0;
  }
  if (x === 0) {
    const negZero = 1 / x < 0;
    if (y > 0) return odd && negZero ? -0 : 0;
    return odd && negZero ? -Infinity : Infinity;
  }
  if (x < 0 && !isIntegral(y)) return NaN;
  const ax = x < 0 ? -x : x;
  let r: number;
  if (isIntegral(y) && ay <= 1073741824) {
    r = powInt(ax, ay);
    if (y < 0) {
      r = r !== Infinity && r !== 0 ? 1 / r : powInt(1 / ax, ay);
    }
  } else {
    r = dexp(y * dlog(ax));
  }
  return x < 0 && odd ? -r : r;
}

/** sqrt(x*x + y*y) without intermediate overflow. */
export function dhypot(x: number, y: number): number {
  const a = Math.abs(x);
  const b = Math.abs(y);
  if (a === Infinity || b === Infinity) return Infinity;
  if (a !== a || b !== b) return NaN;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 0) return 0;
  const r = lo / hi;
  return hi * dsqrt(1 + r * r);
}

/** Wrap an angle to [-pi, pi). Non-finite input is returned unchanged. */
export function normalizeAngle(a: number): number {
  if (a !== a || a === Infinity || a === -Infinity) return a;
  if (a >= -PI && a < PI) return a;
  const r = a - TWO_PI * Math.floor((a + PI) / TWO_PI);
  return r >= PI ? r - TWO_PI : r;
}

/** Interpolate from angle a to angle b along the short arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

/** The C02 rule 2 names. Sim code calls these instead of Math.sqrt, Math.sin, and so on. */
export const detmath = Object.freeze({
  sqrt: dsqrt,
  sin: dsin,
  cos: dcos,
  atan2: datan2,
  exp: dexp,
  log: dlog,
  pow: dpow,
  hypot: dhypot,
  lerpAngle,
  normalizeAngle,
});
