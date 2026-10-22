import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * QA builds serve the two cutscene fixtures of M04c same-origin under `/media-local/cutscenes/<id>/` (the QA mirror prefix: the
 * provenance gate and the service worker both leave `media-local/` out). In `vite` (dev) a middleware reads
 * `tests/fixtures/cutscenes/`; in `vite build` the folders are copied to `dist/media-local/cutscenes/`. The caller adds the plugin
 * only when `VITE_DV_QA=1`.
 */
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.vtt': 'text/vtt',
};
const IDS = ['fixture-a', 'fixture-b'];

export function cutsceneFixtures(root: string): Plugin {
  const repoRoot = path.resolve(root, '..', '..');
  const src = path.join(repoRoot, 'tests', 'fixtures', 'cutscenes');
  return {
    name: 'dv-cutscene-fixtures',
    configureServer(server) {
      server.middlewares.use('/media-local/cutscenes', (req, res, next) => {
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
      for (const id of IDS) {
        if (existsSync(path.join(src, id))) cpSync(path.join(src, id), path.join(root, 'dist', 'media-local', 'cutscenes', id), { recursive: true });
      }
    },
  };
}
