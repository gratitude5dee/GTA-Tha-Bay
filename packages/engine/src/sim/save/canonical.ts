import { CanonicalizeError, canonicalize, fnv64Hex, utf8Bytes } from '@dv/shared';
import type { SaveRecord } from '@dv/shared';

/** Canonical JSON of a slice (C05 rule 1a): its UTF-8 byte length and fnv1a64 checksum. */
export interface Canonical {
  json: string;
  bytes: number;
  checksum: string;
}

export class SaveInvalidData extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveInvalidData';
  }
}

/** Sorted keys, finite numbers, no `undefined`. Throws SaveInvalidData with the offending path otherwise. */
export function canonicalData(data: unknown): Canonical {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new SaveInvalidData('slot data must be a JSON object');
  let json: string;
  try {
    json = canonicalize(data);
  } catch (e) {
    if (e instanceof CanonicalizeError) throw new SaveInvalidData(e.message);
    throw e;
  }
  const raw = utf8Bytes(json);
  return { json, bytes: raw.length, checksum: fnv64Hex(raw) };
}

/** True when the stored record's `bytes` and `checksum` match its data (C05 rule 1d and rule 2). */
export function recordIsIntact(rec: SaveRecord): boolean {
  try {
    const c = canonicalData(rec.data);
    return c.checksum === rec.checksum && c.bytes === rec.bytes;
  } catch {
    return false;
  }
}
