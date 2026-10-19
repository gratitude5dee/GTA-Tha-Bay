import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * QA builds serve the M01d `dir:` mirror same-origin under `/media-local/` so that the pack loop runs end to end before
 * `media.<domain>` exists (Q-15). The mirror is `apps/web/media-local/`, filled by `pnpm --filter @dv/web run media:local`
 * (`assets:publish -- --target dir:apps/web/media-local --pointer-out apps/web/media-local`). In `vite` (dev) the folder is
 * served by middleware; in `vite build` it is copied to `dist/media-local/`. The caller adds this plugin only when
 * `VITE_DV_QA=1`, so production builds never carry the folder.
 *
 * `DV_WORLD=<bakeId|area>` (M02a1, QA builds only; an area name means that area's latest bake in dist/world): in `buildStart`
 * the plugin runs `pnpm map:pack -- --bake <bakeId> --target dir:apps/web/media-local`, then the media-local publish again with
 * `--fragment dist/world/<bakeId>/catalog.fragment.json`, which writes the merged pointer to apps/web/media-local; either
 * command failing fails the build. In `writeBundle` (before the PWA plugin builds its precache manifest in `closeBundle`)
 * that pointer replaces dist/asset-catalog.json, so `/asset-catalog.json` and `/media-local/asset-catalog.json` hold the
 * same merged pointer and the boot rule of M02b1 finds `data/world-index`. Without DV_WORLD nothing here changes.
 * The hook lives in this plugin, not in an apps/web package script: the root build runs `vite build` directly (DL-665).
 */
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.pack': 'application/octet-stream',
  '.png': 'image/png',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.opus': 'audio/ogg',
};

const BAKE_ID = /^[0-9a-f]{64}$/;

/** The bake id `DV_WORLD` names: a 64-hex id as is, or the latest bake of an area from dist/world/latest-<area>.json. */
export function worldBakeId(spec: string, repoRoot: string): string {
  if (BAKE_ID.test(spec)) return spec;
  const pointer = path.join(repoRoot, 'dist', 'world', `latest-${spec}.json`);
  if (!existsSync(pointer)) throw new Error(`DV_WORLD=${spec}: no bake for that area; run pnpm map:build -- --area ${spec} first`);
  const { bakeId } = JSON.parse(readFileSync(pointer, 'utf8')) as { bakeId?: string };
  if (!bakeId || !BAKE_ID.test(bakeId)) throw new Error(`${pointer} does not name a bake id`);
  return bakeId;
}

function run(repoRoot: string, args: string[]): void {
  const r = spawnSync('pnpm', ['run', ...args], { cwd: repoRoot, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`DV_WORLD: pnpm run ${args[0]} failed with exit ${r.status ?? 'null'}`);
}

export function mediaLocal(root: string): Plugin {
  const src = path.join(root, 'media-local');
  const repoRoot = path.resolve(root, '..', '..');
  const world = (process.env['DV_WORLD'] ?? '').trim();
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
    buildStart() {
      if (!world) return;
      const bakeId = worldBakeId(world, repoRoot);
      this.info(`DV_WORLD: merging bake ${bakeId.slice(0, 12)} into the media-local catalog`);
      run(repoRoot, ['map:pack', '--', '--bake', bakeId, '--target', 'dir:apps/web/media-local']);
      run(repoRoot, [
        'assets:publish', '--', '--env', 'staging', '--target', 'dir:apps/web/media-local', '--pointer-out', 'apps/web/media-local',
        '--fragment', `dist/world/${bakeId}/catalog.fragment.json`,
      ]);
    },
    writeBundle() {
      if (!world) return;
      const merged = path.join(src, 'asset-catalog.json');
      if (!existsSync(merged)) throw new Error('DV_WORLD: apps/web/media-local/asset-catalog.json is missing after the world publish');
      copyFileSync(merged, path.join(root, 'dist', 'asset-catalog.json'));
    },
    closeBundle() {
      if (!existsSync(src)) return;
      cpSync(src, path.join(root, 'dist', 'media-local'), { recursive: true });
    },
  };
}
