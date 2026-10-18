// Banned in sim code (C02 rule 1): transcendental Math functions. Use detmath.
export const all = (x: number): number[] => [
  Math.sin(x), Math.cos(x), Math.tan(x), Math.asin(x), Math.acos(x), Math.atan(x), Math.atan2(x, 1),
  Math.sinh(x), Math.cosh(x), Math.tanh(x), Math.exp(x), Math.expm1(x), Math.log(x), Math.log1p(x),
  Math.log2(x), Math.log10(x), Math.pow(x, 2), Math.cbrt(x), Math.hypot(x, 1), Math.sqrt(x),
];
