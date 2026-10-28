/** `dir:<path>` target: the same key tree on a local disk (QA builds serve it same-origin, M01e). Existing files are kept. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Uploader } from './uploader-rclone.ts';

/** The files below `dir`, as `/`-separated paths relative to it, sorted. */
function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const d of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...walk(dir, r));
    else if (d.isFile()) out.push(r);
  }
  return out.sort();
}

export function createDirUploader(dest: string): Uploader {
  return {
    put(unit) {
      let copied = 0;
      for (const key of unit.keys) {
        const to = path.join(dest, key);
        if (existsSync(to)) continue;
        mkdirSync(path.dirname(to), { recursive: true });
        copyFileSync(path.join(unit.srcDir, key), to);
        copied++;
      }
      return copied;
    },
    verify(keys) {
      const out: string[] = [];
      for (const k of keys) {
        const p = path.join(dest, k.key);
        if (!existsSync(p)) out.push(`${k.key}: missing in ${dest}`);
        else if (statSync(p).size !== k.bytes) out.push(`${k.key}: size ${statSync(p).size}, expected ${k.bytes}`);
      }
      return out;
    },
    readJson(key) {
      const p = path.join(dest, key);
      if (!existsSync(p) || !statSync(p).isFile()) return null;
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as unknown;
      } catch {
        throw new Error(`${key} is not JSON`);
      }
    },
    list(prefix) {
      const base = path.join(dest, prefix);
      if (!existsSync(base) || !statSync(base).isDirectory()) return [];
      return walk(base);
    },
  };
}
