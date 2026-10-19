/**
 * Builds and signs the mock cutscene fixtures (M05b1). Run by hand when the recipe changes; the outputs are committed.
 *
 *   tsx services/pipeline/fixtures/sign-fixtures.ts
 *
 * Needs ffmpeg and openssl on PATH. The C2PA tool is pinned in c2pa-signer.json and installed into a temporary directory
 * (it is a fixture-time tool, not a workspace dependency). The signing certificate is a throw-away test chain made here
 * and never written to the repository, so the fixture claims are valid but untrusted (`valid-untrusted`).
 *
 * Writes services/pipeline/fixtures/cutscene/{orig.mp4, v768.mp4, v540.mp4, poster.webp, last.webp, subs.en.vtt, meta.json}
 * and services/pipeline/fixtures/cutscene-data.ts (base64 of the same files, for the Worker bundle).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'cutscene');
const signer = JSON.parse(readFileSync(path.join(here, 'c2pa-signer.json'), 'utf8')) as { package: string; version: string };

/** The slice of the pinned tool's API that this script uses. */
interface C2paBuilder {
  setIntent(i: { create: string }): void;
  addIngredient(json: string, asset: { buffer: Buffer; mimeType: string }): Promise<void>;
  sign(signer: unknown, input: { path: string; mimeType: string }, output: { path: string }): unknown;
}
interface C2paReader {
  getActive(): { label?: string; ingredients?: unknown[] } | null;
  json(): unknown;
}
interface C2paModule {
  LocalSigner: { newSigner(cert: Buffer, key: Buffer, alg: string): unknown };
  Builder: { newAsync(): Promise<C2paBuilder> };
  Reader: { fromAsset(a: { path: string; mimeType: string }): Promise<C2paReader> };
}

function run(cmd: string, argv: string[], cwd?: string): void {
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed:\n${res.stdout}${res.stderr}`);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** RFC 6381 codec string from the avcC box (version, profile, compatibility, level). */
function avcCodec(mp4: Buffer): string {
  const at = mp4.indexOf('avcC');
  if (at < 0) throw new Error('no avcC box');
  return `avc1.${[...mp4.subarray(at + 5, at + 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function probe(file: string): { width: number; height: number; frames: number } {
  const res = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,nb_read_frames', '-of', 'json', file], { encoding: 'utf8' });
  const s = (JSON.parse(res.stdout) as { streams: { width: number; height: number; nb_read_frames: string }[] }).streams[0]!;
  return { width: s.width, height: s.height, frames: Number(s.nb_read_frames) };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dv-fixtures-'));
  mkdirSync(outDir, { recursive: true });

  // 1. media: a 2 s, 24 fps, 128x72 test pattern stands in for the fal output (orig.mp4); renditions are scaled copies.
  const base = path.join(tmp, 'base');
  mkdirSync(base);
  const enc = ['-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '24', '-crf', '30', '-movflags', '+faststart', '-an'];
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=24:duration=2', ...enc, path.join(base, 'orig.mp4')]);
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(base, 'orig.mp4'), '-vf', 'scale=128:72', ...enc, path.join(base, 'v768.mp4')]);
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(base, 'orig.mp4'), '-vf', 'scale=96:54', ...enc, path.join(base, 'v540.mp4')]);
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(base, 'orig.mp4'), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '40', path.join(outDir, 'poster.webp')]);
  run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.1', '-i', path.join(base, 'orig.mp4'), '-frames:v', '1', '-update', '1', '-c:v', 'libwebp', '-quality', '40', path.join(outDir, 'last.webp')]);
  writeFileSync(path.join(outDir, 'subs.en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nMock cutscene fixture.\n');

  // 2. throw-away signing chain (root CA + end-entity with the C2PA key usage and extended key usage).
  const pki = path.join(tmp, 'pki');
  mkdirSync(pki);
  run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key'], pki);
  run('openssl', ['req', '-new', '-x509', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=Tha Bay Fixture Root/O=Tha Bay Test', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', 'root.pem'], pki);
  run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.sec1.key'], pki);
  run('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', 'leaf.sec1.key', '-out', 'leaf.key'], pki);
  run('openssl', ['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Tha Bay Fixture Signer/O=Tha Bay Test', '-out', 'leaf.csr'], pki);
  writeFileSync(path.join(pki, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
  run('openssl', ['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '3650', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem'], pki);
  const chain = Buffer.concat([readFileSync(path.join(pki, 'leaf.pem')), readFileSync(path.join(pki, 'root.pem'))]);
  const key = readFileSync(path.join(pki, 'leaf.key'));

  // 3. the pinned signer.
  const toolDir = path.join(tmp, 'tool');
  mkdirSync(toolDir);
  writeFileSync(path.join(toolDir, 'package.json'), '{"name":"dv-fixture-signer","private":true}');
  run('npm', ['install', `${signer.package}@${signer.version}`, '--ignore-scripts', '--no-audit', '--no-fund'], toolDir);
  const c2pa = createRequire(path.join(toolDir, 'x.js'))(signer.package) as C2paModule;
  const localSigner = c2pa.LocalSigner.newSigner(chain, key, 'es256');

  const origBytes = readFileSync(path.join(base, 'orig.mp4'));
  const trained = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
  for (const name of ['v768.mp4', 'v540.mp4']) {
    const builder = await c2pa.Builder.newAsync();
    builder.setIntent({ create: trained });
    await builder.addIngredient(
      JSON.stringify({ title: 'orig.mp4', format: 'video/mp4', instance_id: `orig-${sha256(origBytes).slice(0, 12)}`, relationship: 'componentOf' }),
      { buffer: origBytes, mimeType: 'video/mp4' },
    );
    const out = path.join(outDir, name);
    builder.sign(localSigner, { path: path.join(base, name), mimeType: 'video/mp4' }, { path: out });
  }
  writeFileSync(path.join(outDir, 'orig.mp4'), origBytes);

  // 4. read the claims back, then write metadata and the bundled copy.
  const meta: Record<string, unknown> = { signer, claim: 'trainedAlgorithmicMedia', ingredient: 'orig.mp4' };
  const files = ['orig.mp4', 'v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt'];
  const entries: Record<string, { bytes: number; sha256: string; base64: string; width?: number; height?: number; frames?: number; codecs?: string }> = {};
  for (const f of files) {
    const buf = readFileSync(path.join(outDir, f));
    const entry: (typeof entries)[string] = { bytes: buf.length, sha256: sha256(buf), base64: buf.toString('base64') };
    if (f.endsWith('.mp4')) Object.assign(entry, { ...probe(path.join(outDir, f)), codecs: avcCodec(buf) });
    entries[f] = entry;
  }
  for (const name of ['v768.mp4', 'v540.mp4']) {
    const reader = await c2pa.Reader.fromAsset({ path: path.join(outDir, name), mimeType: 'video/mp4' });
    const active = reader.getActive();
    const status = (reader.json() as { validation_status?: { code: string }[] }).validation_status ?? [];
    meta[name] = { activeLabel: active?.label ?? null, ingredients: active?.ingredients?.length ?? 0, validation: status.map((s) => s.code) };
  }
  meta['files'] = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 }]));
  writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  const ts = [
    '// Generated by fixtures/sign-fixtures.ts. Do not edit. Base64 of the committed files in ./cutscene/.',
    'export interface FixtureFile { bytes: number; sha256: string; base64: string; width?: number; height?: number; frames?: number; codecs?: string }',
    `export const CUTSCENE_FIXTURES: Readonly<Record<string, FixtureFile>> = ${JSON.stringify(entries, null, 2)};`,
    '',
  ].join('\n');
  writeFileSync(path.join(here, 'cutscene-data.ts'), ts);
  console.log(`wrote ${files.length} fixture files to ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
