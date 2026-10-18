// Banned in sim code (C02 rule 1): Intl and toLocaleString.
export const fmt = (n: number): string => new Intl.NumberFormat('en').format(n);
export const loc = (n: number): string => n.toLocaleString();
