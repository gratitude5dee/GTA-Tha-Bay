/**
 * The instance matrices of the furniture pools (M02h6): a record's foot at world (x, y, z), turned by its yaw about +Y (the look shots'
 * convention: 0 faces north, -Z), and for a trolley wire span stretched along local -Z by the span's length (`arg`). Column-major like
 * three's `Matrix4.elements`.
 */
import { FurnitureKind } from '../chunks/mesh-types.ts';

/** Writes the matrix of one record into `out` at `o` (16 floats). `arg` is the record's last float (the wire span's length). */
export function writeFurnitureMatrix(out: Float32Array, o: number, kind: number, x: number, y: number, z: number, yaw: number, arg: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sz = kind === FurnitureKind.wire ? Math.max(0.01, arg) : 1;
  out[o] = c;
  out[o + 1] = 0;
  out[o + 2] = -s;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = 1;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * sz;
  out[o + 9] = 0;
  out[o + 10] = c * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** A freed slot: a zero-scale matrix (C08 1.1 rule 12 pools keep their slots stable; nothing is drawn there). */
export function clearFurnitureMatrix(out: Float32Array, o: number): void {
  out.fill(0, o, o + 16);
}
