// Banned in sim code (C02 rule 1): crypto.getRandomValues.
export const fill = (a: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> => crypto.getRandomValues(a);
