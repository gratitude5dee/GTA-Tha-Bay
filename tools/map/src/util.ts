import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** JSON with object keys sorted recursively and a trailing newline: byte-stable output for reports and indexes. */
export function stableJson(value: unknown, indent = 2): string {
  return `${JSON.stringify(sortKeys(value), null, indent)}\n`;
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

export function writeEnsured(file: string, data: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const MIB = 1024 * 1024;
