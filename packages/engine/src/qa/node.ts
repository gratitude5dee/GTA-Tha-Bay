/**
 * Node-side inputs of the canonical runner (M04d): the gray-box fixture bytes, read from the repository and checked against
 * `hashes.json`. The determinism page gets the same bytes through a Vite `?url` import (`apps/web/src/qa/determinism.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifyFixturePack } from './scenarios.ts';

export function repoRoot(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), '../../../..');
}

/** `{ p0 }` of the civic-graybox fixture, hash-checked. */
export function readFixturePacks(root: string = repoRoot()): { p0: Uint8Array } {
  const dir = resolve(root, 'tests', 'fixtures', 'world', 'civic-graybox');
  const hashes = JSON.parse(readFileSync(resolve(dir, 'hashes.json'), 'utf8')) as Record<string, string>;
  const bytes = new Uint8Array(readFileSync(resolve(dir, 'p0-64-64.pack')));
  verifyFixturePack('p0-64-64.pack', bytes, hashes);
  return { p0: bytes };
}
