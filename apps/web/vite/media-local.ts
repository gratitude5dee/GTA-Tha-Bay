import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * QA builds serve the M01d `dir:` mirror same-origin under `/media-local/` so that the pack loop runs end to end before
 * `media.<domain>` exists (Q-15). The mirror is `apps/web/media-local/`, filled by `pnpm --filter @dv/web run media:local`
 * (`assets:publish -- --target dir:apps/web/media-local --pointer-out apps/web/media-local`). In `vite` (dev) the folder is
 * served by middleware; in `vite build` it is copied to `dist/media-local/`. The caller adds this plugin only when
 * `VITE_DV_QA=1`, so production builds never carry the folder.
 */
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.pack': 'application/octet-stream',
  '.png': 'image/png',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.opus': 'audio/ogg',
};

export function mediaLocal(root: string): Plugin {
  const src = path.join(root, 'media-local');
  return {
    name: 'dv-media-local',
    configureServer(server) {
      server.middlewares.use('/media-local', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const file = path.join(src, rel);
        if (!file.startsWith(src) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!existsSync(src)) return;
      cpSync(src, path.join(root, 'dist', 'media-local'), { recursive: true });
    },
  };
}
