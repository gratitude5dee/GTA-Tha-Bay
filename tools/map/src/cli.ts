/**
 * map CLI. M01f ships one command:
 *
 *   tsx tools/map/src/cli.ts fixture graybox [--check] [--out <dir>] [--hashes <file>]
 *
 * Without --check it writes tests/fixtures/world/civic-graybox/{p0-64-64,l0-64-64}.pack and hashes.json.
 * With --check it builds both packs in memory, compares their SHA-256 with the committed hashes.json, prints
 * every differing file and exits 1 on a difference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { args } from '../../ci/run.ts';
import { isMain, sha256Hex, toolsRoot } from '../../ci/lib/common.ts';
import { encodeGraybox } from './fixtures/graybox.ts';

export const GRAYBOX_DIR = path.join(toolsRoot, 'tests', 'fixtures', 'world', 'civic-graybox');

/** Builds the packs and returns {file: sha256}. */
export function grayboxHashes(files: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) out[name] = sha256Hex(files[name] as Uint8Array);
  return out;
}

/** Returns the files whose hash differs from `expected` (or that are missing from it). */
export function diffHashes(actual: Record<string, string>, expected: Record<string, string>): string[] {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...names].sort().filter((n) => actual[n] !== expected[n]);
}

export function runFixture(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { check: { type: 'boolean', default: false }, out: { type: 'string' }, hashes: { type: 'string' } },
  });
  if (positionals[0] !== 'graybox') {
    console.error('usage: map:fixture graybox [--check] [--out <dir>] [--hashes <file>]');
    return 2;
  }
  const files = encodeGraybox();
  const actual = grayboxHashes(files);
  const dir = path.resolve(values.out ?? GRAYBOX_DIR);
  const hashesFile = path.resolve(values.hashes ?? path.join(GRAYBOX_DIR, 'hashes.json'));
  if (!values.check) {
    mkdirSync(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
    writeFileSync(path.join(dir, 'hashes.json'), `${JSON.stringify(actual, null, 2)}\n`);
    for (const [n, h] of Object.entries(actual)) console.log(`map:fixture graybox: wrote ${n} ${h}`);
    return 0;
  }
  if (!existsSync(hashesFile)) {
    console.error(`map:fixture graybox --check: ${hashesFile} does not exist`);
    return 1;
  }
  const expected = JSON.parse(readFileSync(hashesFile, 'utf8')) as Record<string, string>;
  const diff = diffHashes(actual, expected);
  for (const [n, h] of Object.entries(actual)) console.log(`map:fixture graybox: ${n} ${h}${diff.includes(n) ? ' DIFFERS' : ' ok'}`);
  if (diff.length) {
    for (const n of diff) console.error(`map:fixture graybox --check: ${n} differs from ${path.relative(toolsRoot, hashesFile)} (expected ${expected[n] ?? 'missing'}, built ${actual[n] ?? 'missing'})`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = args();
  if (cmd === 'fixture') process.exit(runFixture(rest));
  console.error('usage: map <fixture> ...');
  process.exit(2);
}
