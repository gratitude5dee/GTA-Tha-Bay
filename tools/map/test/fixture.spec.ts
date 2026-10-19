import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeP0 } from '../../../packages/shared/src/index.ts';
import { diffHashes, grayboxHashes, runFixture } from '../src/cli.ts';
import { GRAYBOX_BAKE_ID, GRAYBOX_FILES, buildGraybox, encodeGraybox } from '../src/fixtures/graybox.ts';
import { sha256Hex } from '../../ci/lib/common.ts';

const dir = fileURLToPath(new URL('../../../tests/fixtures/world/civic-graybox/', import.meta.url));
const committed = (n: string): Buffer => readFileSync(dir + n);

afterEach(() => vi.restoreAllMocks());

describe('graybox fixture', () => {
  it('is deterministic: two builds give identical bytes', () => {
    const a = encodeGraybox();
    const b = encodeGraybox();
    for (const n of Object.values(GRAYBOX_FILES)) expect(Buffer.from(a[n]).equals(Buffer.from(b[n]))).toBe(true);
  });

  it('matches the committed packs and hashes.json', () => {
    const built = encodeGraybox();
    const hashes = JSON.parse(committed('hashes.json').toString('utf8')) as Record<string, string>;
    for (const n of Object.values(GRAYBOX_FILES)) {
      expect(Buffer.from(built[n]).equals(committed(n))).toBe(true);
      expect(hashes[n]).toBe(sha256Hex(committed(n)));
    }
    expect(Object.keys(hashes).sort()).toEqual(['l0-64-64.pack', 'p0-64-64.pack']);
  });

  it('keeps each pack well under the 4 MiB world_pack limit', () => {
    for (const n of Object.values(GRAYBOX_FILES)) expect(committed(n).length).toBeLessThan(4 * 1024 * 1024);
  });

  it('uses the computed bake id', () => {
    expect(buildGraybox().sim.every((c) => c.bakeId === GRAYBOX_BAKE_ID)).toBe(true);
    expect(GRAYBOX_BAKE_ID).toMatch(/^[0-9a-f]{64}$/);
    expect(decodeP0(committed('p0-64-64.pack'))[0]!.bakeId).toBe(GRAYBOX_BAKE_ID);
  });
});

describe('map:fixture graybox --check', () => {
  it('exits 0 against the committed hashes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runFixture(['graybox', '--check'])).toBe(0);
  });

  it('exits 1 and names the file when a hash byte is changed in a temp copy', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'dv-graybox-'));
    const file = path.join(tmp, 'hashes.json');
    const text = committed('hashes.json').toString('utf8');
    const at = text.indexOf('p0-64-64.pack') + 'p0-64-64.pack": "'.length;
    const flipped = text.slice(0, at) + (text[at] === 'a' ? 'b' : 'a') + text.slice(at + 1);
    writeFileSync(file, flipped);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runFixture(['graybox', '--check', '--hashes', file])).toBe(1);
    const said = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('p0-64-64.pack');
    expect(said).not.toContain('l0-64-64.pack differs');
  });

  it('writes the packs and hashes.json into --out, then checks clean against them', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'dv-graybox-out-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runFixture(['graybox', '--out', tmp])).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(['hashes.json', 'l0-64-64.pack', 'p0-64-64.pack']);
    expect(runFixture(['graybox', '--check', '--hashes', path.join(tmp, 'hashes.json')])).toBe(0);
  });

  it('rejects an unknown fixture name', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runFixture(['nope'])).toBe(2);
  });

  it('diffHashes reports missing and changed files', () => {
    expect(diffHashes({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual(['b', 'c']);
    expect(grayboxHashes({ z: new Uint8Array([1]), a: new Uint8Array([2]) })).toEqual({ a: sha256Hex(new Uint8Array([2])), z: sha256Hex(new Uint8Array([1])) });
  });
});
