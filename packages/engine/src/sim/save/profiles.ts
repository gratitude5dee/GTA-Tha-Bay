import { SAVE_LIMITS, type ProfileId, type ProfileMeta } from '@dv/shared';

/** 16 random bytes as 32 lowercase hex (C05 rule 7). `crypto.getRandomValues` is allowed outside sim code. */
export function randomHex32(random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  let s = '';
  for (const b of random(16)) s += b.toString(16).padStart(2, '0');
  return s;
}

/** NFC, trimmed, whitespace runs collapsed; null when the length is outside 1 to 80 characters. */
export function normalizeName(raw: string): string | null {
  const n = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const len = [...n].length;
  return len >= SAVE_LIMITS.nameMin && len <= SAVE_LIMITS.nameMax ? n : null;
}

/** Case-insensitive identity of a name. */
export const nameKey = (name: string): string => name.normalize('NFC').toLowerCase();

export function nameTaken(profiles: readonly ProfileMeta[], name: string, except?: ProfileId): boolean {
  const k = nameKey(name);
  return profiles.some((p) => p.id !== except && nameKey(p.name) === k);
}

/** `Name`, `Name (2)`, `Name (3)` ... the first not taken and within the length limit. */
export function uniqueName(profiles: readonly ProfileMeta[], base: string): string {
  if (!nameTaken(profiles, base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const room = SAVE_LIMITS.nameMax - [...suffix].length;
    const cand = `${[...base].slice(0, room).join('')}${suffix}`;
    if (!nameTaken(profiles, cand)) return cand;
  }
  return base;
}

export function newProfile(id: ProfileId, name: string, deviceId: string, now: number): ProfileMeta {
  return { id, name, createdAt: now, updatedAt: now, playtimeSec: 0, lastSave: null, deviceId };
}
