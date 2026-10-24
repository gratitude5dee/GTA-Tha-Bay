/**
 * `a * b / c` with BigInt for products that pass 2^53 (finance section 2, rule 2). Inputs are non-negative safe integers; both
 * functions throw on `c <= 0` and on a result above `Number.MAX_SAFE_INTEGER`.
 */
function check(a: number, b: number, c: number): void {
  if (!(c > 0)) throw new RangeError('mulDiv: divisor must be positive');
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) throw new RangeError('mulDiv: operands must be integers');
}

function back(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('mulDiv: result exceeds 2^53');
  return Number(v);
}

export function mulDivFloor(a: number, b: number, c: number): number {
  check(a, b, c);
  const p = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  let q = p / d;
  if (p % d !== 0n && p < 0n) q -= 1n;
  return back(q);
}

export function mulDivCeil(a: number, b: number, c: number): number {
  check(a, b, c);
  const p = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  let q = p / d;
  if (p % d !== 0n && p > 0n) q += 1n;
  return back(q);
}
