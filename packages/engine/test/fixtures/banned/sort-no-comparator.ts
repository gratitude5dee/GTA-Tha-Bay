// Banned in sim code (C01 rule 4): sort() without a comparator.
export const order = (a: number[]): number[] => a.sort();
export const copy = (a: number[]): number[] => a.toSorted();
