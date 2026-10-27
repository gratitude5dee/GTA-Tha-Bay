/**
 * Saved ghosts, the leaderboard payloads of route 21 and the base64 the slice and the wire use (06-racing-data.md 4.3; M07a2).
 * Pure; no DOM and no Buffer, so it runs the same in the sim worker, the page and Node. Sim code under the C02 lint.
 */
import { ReplayFormatError } from './replay.ts';
import type { RaceId } from './race-def.ts';

/** A saved best run of one event: the track always, the inputs when they fit the cap. */
export interface GhostEntry {
  vehicleDef: string;
  ms: number;
  profile: 'local' | 'canonical';
  buildId: string;
  worldBake: string;
  inputsB64: string | null;
  trackB64: string;
  savedAt: number;
}

/** Route 21 (C12) request; semantics owned by S06 (the validator arrives in M12e), transport by S09 (M12c). */
export interface ScoreSubmit {
  board: string;
  value: number;
  raceId: RaceId;
  raceVersion: number;
  worldBake: string;
  buildId: string;
  vehicleDef: string;
  handlingRev: number;
  gateTicks: number[];
  replayB64: string;
  replaySha256: string;
}
export interface ScoreRow { rank: number; name: string; value: number; verified: boolean; vehicleDef: string }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const x = ((b[i] as number) << 16) | ((i + 1 < b.length ? (b[i + 1] as number) : 0) << 8) | (i + 2 < b.length ? (b[i + 2] as number) : 0);
    s += B64.charAt((x >>> 18) & 63) + B64.charAt((x >>> 12) & 63) + (i + 1 < b.length ? B64.charAt((x >>> 6) & 63) : '=') + (i + 2 < b.length ? B64.charAt(x & 63) : '=');
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean.charAt(i + k)) : 0));
    if (c.some((v) => v < 0)) throw new ReplayFormatError('bad base64');
    const x = ((c[0] as number) << 18) | ((c[1] as number) << 12) | ((c[2] as number) << 6) | (c[3] as number);
    if (o < out.length) out[o++] = (x >>> 16) & 255;
    if (o < out.length) out[o++] = (x >>> 8) & 255;
    if (o < out.length) out[o++] = x & 255;
  }
  return out;
}
