// Banned in sim code (C02 rule 1): for...in (key order must be explicit).
export function count(o: Record<string, number>): number {
  let n = 0;
  for (const k in o) n += o[k] ?? 0;
  return n;
}
