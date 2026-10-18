// Banned in sim code (C02 rule 1): the ** and **= operators.
export const square = (x: number): number => x ** 2;
export function cube(x: number): number {
  let y = x;
  y **= 3;
  return y;
}
