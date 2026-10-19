import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Records every module id that ends up in a bundle, for `pnpm check:bundle` (no id may resolve under third_party/;
 * DL-618, DL-649). One instance goes into `plugins` (clears the file at buildStart) and one into `worker.plugins`
 * (Web Worker bundles run only worker.plugins). Both merge into the same file, which is never overwritten by a later
 * build and lives outside dist/, so it is not deployed.
 */
export function moduleIds(webRoot: string, repoRoot: string, clear: boolean): Plugin {
  const file = path.join(webRoot, '.dv-build', 'module-ids.json');
  const read = (): string[] => {
    try {
      const ids = (JSON.parse(readFileSync(file, 'utf8')) as { ids?: unknown }).ids;
      return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [];
    } catch {
      return [];
    }
  };
  const write = (ids: Iterable<string>): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ schema: 'module-ids/1', ids: [...new Set(ids)].sort() }, null, 1)}\n`);
  };
  return {
    name: clear ? 'dv-module-ids' : 'dv-module-ids-worker',
    apply: 'build',
    buildStart() {
      if (clear) write([]);
    },
    generateBundle(_options, bundle) {
      const ids = new Set(read());
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const id of out.moduleIds) {
          const clean = id.replace(/^\0/, '').split('?')[0] as string;
          if (clean.startsWith('/') || /^[A-Za-z]:[\\/]/.test(clean)) {
            const rel = path.relative(repoRoot, clean).split(path.sep).join('/');
            ids.add(rel.startsWith('..') ? clean : rel);
          } else ids.add(clean);
        }
      }
      write(ids);
    },
  };
}
