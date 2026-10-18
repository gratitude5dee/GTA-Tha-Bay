/**
 * assets:seed. Writes the smoke-test checkerboard PNGs (64, 32 and 16 px) with node:zlib, stored (level 0) blocks
 * so the bytes do not depend on the zlib version. `--check` compares the committed files with a fresh render.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

export const SEED_TEXTURES: { file: string; size: number }[] = [
  { file: 'assets/src/texture/asset-smoke/d.png', size: 64 },
  { file: 'assets/src/texture/asset-smoke/m.png', size: 32 },
  { file: 'assets/src/texture/asset-smoke/l.png', size: 16 },
];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** 8 x 8 checkerboard, RGB 8-bit, two fixed colours. */
export function renderCheckerboard(size: number): Buffer {
  const cell = size / 8;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const rgb = dark ? [0x1f, 0x4e, 0x5f] : [0xf2, 0xc1, 0x4e];
      row.set(rgb, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Writes the files, or with `check` returns the paths whose committed bytes differ from a fresh render. */
export function seedTextures(root: string, check: boolean): string[] {
  const diff: string[] = [];
  for (const t of SEED_TEXTURES) {
    const bytes = renderCheckerboard(t.size);
    const abs = path.join(root, t.file);
    if (check) {
      if (!existsSync(abs) || !readFileSync(abs).equals(bytes)) diff.push(t.file);
    } else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }
  }
  return diff;
}
