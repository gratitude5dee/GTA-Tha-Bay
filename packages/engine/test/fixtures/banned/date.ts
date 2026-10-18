// Banned in sim code (C02 rule 1): Date. Time comes from the tick counter.
export const now = (): number => Date.now();
export const stamp = (): Date => new Date(0);
