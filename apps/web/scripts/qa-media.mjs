#!/usr/bin/env node
/**
 * QA build step (M01e): fills apps/web/media-local/ with the M01d asset mirror and its catalog pointer, so that the QA build
 * serves packs same-origin under /media-local/ (Q-15: media.<domain> does not exist yet). A production build (no
 * VITE_DV_QA=1) does nothing here and ships no media-local folder.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.VITE_DV_QA !== '1') {
  console.log('media:local skipped (not a QA build)');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const r = spawnSync(
  'pnpm',
  ['run', 'assets:publish', '--', '--env', 'staging', '--target', 'dir:apps/web/media-local', '--pointer-out', 'apps/web/media-local'],
  { cwd: root, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
