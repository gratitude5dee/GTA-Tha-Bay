/** `dir:<path>` target: the same key tree on a local disk (QA builds serve it same-origin, M01e). Existing files are kept. */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Uploader } from './uploader-rclone.ts';

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
  };
}
