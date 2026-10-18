import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(web, 'dist');
const pointer = path.join(web, 'public', 'asset-catalog.json');

// Needs `pnpm build` first (the CI build job runs it); without a build there is nothing to read.
describe.skipIf(!existsSync(path.join(dist, 'sw.js')))('service worker precache (DL-042)', () => {
  it('dist/asset-catalog.json equals the committed pointer', () => {
    expect(readFileSync(path.join(dist, 'asset-catalog.json'), 'utf8')).toBe(readFileSync(pointer, 'utf8'));
  });

  it('the injected precache manifest lists asset-catalog.json with a revision', () => {
    const sw = readFileSync(path.join(dist, 'sw.js'), 'utf8');
    const m = /\{"revision":"([0-9a-f]{32})","url":"asset-catalog\.json"\}/.exec(sw);
    expect(m, 'asset-catalog.json missing from the precache manifest').not.toBeNull();
  });
});
