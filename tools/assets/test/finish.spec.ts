/**
 * M05c4 AC-5 (and the local path of AC-8): `assets:gen prewarm --finish` over stub ffmpeg, stub C2PA reader and an in-memory private bucket.
 * No network, no fal, no real rclone. A second block runs the pinned tools for real when they are installed (ffmpeg 6.1.1-3ubuntu5,
 * openssl and the pinned @contentauth/c2pa-node): the fixture clip through `cut@1` and the re-signer, then `check:c2pa --verify-signatures`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import type { HandoffRecord } from '../../../packages/shared/src/genai/cutscene-offedge.ts';
import { fixtureBytes, fixtureEntry } from '../../../services/pipeline/src/mock/fixtures.ts';
import { MockSignPort } from '../../../services/pipeline/src/mock/MockSignPort.ts';
import { MockTranscodePort } from '../../../services/pipeline/src/mock/MockTranscodePort.ts';
import type { C2paModuleLike } from '../../ci/c2pa-read.ts';
import { main as checkC2pa } from '../../ci/check-c2pa.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { main } from '../gen/cli.ts';
import { C2paNodeSignPort } from '../gen/c2pa-sign-port.ts';
import { FFMPEG_PIN, FfmpegTranscodePort, ffmpegVersionOf, pinProblems, qaVerdict } from '../gen/ffmpeg-port.ts';
import { pendingKeys, privateRcloneEnv } from '../gen/finish.ts';
import type { Runner } from '../src/uploader-rclone.ts';

const tempDir = useTempDirs();
const repoRoot = path.resolve(import.meta.dirname, '../../..');

const KEYS = [sha256Hex('finish-key-one'), sha256Hex('finish-key-two')];
const BUCKET = 'tha-bay-private-staging';
const ENV_OK = { OPS_TOKEN: 'staff', R2_PRIVATE_ACCESS_KEY_ID: 'priv-id', R2_PRIVATE_SECRET_ACCESS_KEY: 'priv-secret', CLOUDFLARE_ACCOUNT_ID: 'acct', C2PA_CERT_CHAIN_PEM: 'cert', C2PA_KEY_PEM: 'key' };

function handoffFor(key: string): HandoffRecord {
  return {
    schema: 'cutscene-handoff/1', key, jobKey: key,
    job: { schema: 'genjob/1', jobKey: key, kind: 'cutscene_shot', endpointKey: 'h3.partner', env: 'previs', subject: { assetRef: `cutscene/cut-${key.slice(0, 16)}` }, params: { cutsceneKey: key }, inputs: [], promptTemplate: 'mock@1', promptSha256: key, budgetUsdMicros: 1_000_000, requestedBy: 'test' },
    plan: [{ shotId: 's1', durationS: 2, prompt: '', startFrame: 0, frames: 48 }], requestId: `mock-${key.slice(0, 8)}`, providerKey: 'h3.partner', endpoint: 'fal-ai/test',
    pinnedUpdatedAt: '2026-10-01', characters: [], licence: { gate: 'ADR-GENAI-01', provider: 'h3.partner', status: 'cleared', termsSnapshotSha256: [] }, subs: { en: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHi.\n' },
    costUsdMicros: 1_000_000, at: 1,
  };
}

interface Call {
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** rclone over a map: lsf, cat and copyto in both directions; every call is recorded with the environment it got. */
function fakeRclone(store: Map<string, Uint8Array>): { run: Runner; calls: Call[]; uploads: string[] } {
  const calls: Call[] = [];
  const uploads: string[] = [];
  const prefix = `r2:${BUCKET}/`;
  const run: Runner = (cmd, args, env) => {
    calls.push({ args, env });
    if (cmd !== 'rclone') return { status: 127, stdout: '', stderr: 'not rclone' };
    const [sub, ...rest] = args;
    if (sub === 'version') return { status: 0, stdout: 'rclone v1.75.2', stderr: '' };
    if (sub === 'lsf') {
      const p = rest[2]!.slice(prefix.length);
      const names = [...store.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
      return names.length === 0 ? { status: 3, stdout: '', stderr: 'directory not found' } : { status: 0, stdout: `${names.join('\n')}\n`, stderr: '' };
    }
    if (sub === 'cat') {
      const bytes = store.get(rest[0]!.slice(prefix.length));
      return bytes === undefined ? { status: 3, stdout: '', stderr: 'object not found' } : { status: 0, stdout: Buffer.from(bytes).toString('utf8'), stderr: '' };
    }
    if (sub === 'copyto') {
      const [from, to] = rest as [string, string];
      if (from.startsWith(prefix)) {
        const bytes = store.get(from.slice(prefix.length));
        if (bytes === undefined) return { status: 4, stdout: '', stderr: 'object not found' };
        writeFileSync(to, bytes);
      } else {
        store.set(to.slice(prefix.length), new Uint8Array(readFileSync(from)));
        uploads.push(to.slice(prefix.length));
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected rclone ${sub}` };
  };
  return { run, calls, uploads };
}

/** Route 27 and 28 of a stub Worker: a key is ready once route 28 has been called for it after its finish.json exists. */
function stubWorker(store: Map<string, Uint8Array>, order: string[]): typeof fetch {
  const ready = new Set<string>();
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/v1/admin/cutscenes/prewarm')) {
      const { keys } = JSON.parse(String(init?.body)) as { keys: string[] };
      for (const key of keys) {
        order.push(`route28:${key}`);
        if (store.has(`cutscenes-orig/${key}/finish.json`)) ready.add(key);
      }
      return Promise.resolve(new Response(JSON.stringify({ keys: keys.map((key) => ({ key, state: 'pending' })) }), { status: 202 }));
    }
    const key = url.split('/api/v1/cutscenes/')[1]!;
    return Promise.resolve(new Response(JSON.stringify(ready.has(key) ? { key, state: 'ready', manifestUrl: `https://media.test/cutscenes/${key}/manifest.json` } : { key, state: 'pending' }), { status: 200 }));
  }) as unknown as typeof fetch;
}

function seededStore(keys: string[] = KEYS): Map<string, Uint8Array> {
  const store = new Map<string, Uint8Array>();
  for (const key of keys) {
    store.set(`cutscenes-orig/${key}/orig.mp4`, fixtureBytes('orig.mp4'));
    store.set(`cutscenes-orig/${key}/handoff.json`, new TextEncoder().encode(JSON.stringify(handoffFor(key))));
  }
  return store;
}

const ARGS = ['prewarm', '--release', 'fixture-act1', '--finish', '--env', 'staging'];
const clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

describe('prewarm --finish over stub tools (AC-5)', () => {
  it('uploads every file under out/<runId>/ before finish.json, finish.json last, then one route 28 call per key; the manifest body is complete', async () => {
    const store = seededStore();
    const rc = fakeRclone(store);
    const order: string[] = [];
    const logs: string[] = [];
    const code = await main(ARGS, { ...ENV_OK, R2_ACCESS_KEY_ID: 'media-id', R2_SECRET_ACCESS_KEY: 'media-secret' }, stubWorker(store, order), (l) => logs.push(l), {
      run: (cmd, args, env) => {
        const r = rc.run(cmd, args, env);
        if (args[0] === 'copyto' && !args[0]?.startsWith('r2:') && args[2]?.startsWith('r2:')) order.push(`put:${args[2].slice(`r2:${BUCKET}/`.length)}`);
        return r;
      },
      makeTranscode: () => new MockTranscodePort(),
      makeSign: () => new MockSignPort(),
      clock,
      pollMs: 1,
    });
    expect(logs.join('\n')).toMatch(/finish: 2 key\(s\) to finish/);
    expect(code).toBe(0);

    for (const key of KEYS) {
      const finishKey = `cutscenes-orig/${key}/finish.json`;
      const finish = JSON.parse(Buffer.from(store.get(finishKey)!).toString('utf8')) as {
        runId: string; files: { file: string; bytes: number; sha256: string }[]; manifest: { renditions: Record<string, { sha256: string }>; provenance: Record<string, unknown>; subs: Record<string, string>; poster: string; last: string };
      };
      const outKeys = ['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt'].map((f) => `cutscenes-orig/${key}/out/${finish.runId}/${f}`);
      for (const k of outKeys) expect(store.has(k), k).toBe(true);
      // order for this key: the five files, then finish.json, then route 28 for the key
      const mine = order.filter((o) => o.includes(key));
      expect(mine.slice(0, 5).sort()).toEqual(outKeys.map((k) => `put:${k}`).sort());
      expect(mine.slice(5)).toEqual([`put:${finishKey}`, `route28:${key}`]);
      // the manifest body names v768 and v540, re-signed, AI-generated, with the SHA-256 of the original
      expect(Object.keys(finish.manifest.renditions).sort()).toEqual(['v540', 'v768']);
      expect(finish.manifest.provenance).toMatchObject({ resigned: true, aiGenerated: true, origSha256: fixtureEntry('orig.mp4').sha256, requestIds: [`mock-${key.slice(0, 8)}`] });
      expect(finish.manifest.poster).toBe('poster.webp');
      expect(finish.manifest.last).toBe('last.webp');
      expect(finish.manifest.subs).toEqual({ en: 'subs.en.vtt' });
      // every uploaded file is described with its true size and hash
      for (const f of finish.files) {
        const bytes = store.get(`cutscenes-orig/${key}/out/${finish.runId}/${f.file}`)!;
        expect({ bytes: bytes.length, sha256: sha256Hex(bytes) }).toEqual({ bytes: f.bytes, sha256: f.sha256 });
      }
    }
    // the first key is finished completely before the second starts
    expect(order.findIndex((o) => o === `route28:${KEYS[0]}`)).toBeLessThan(order.findIndex((o) => o.includes(`put:cutscenes-orig/${KEYS[1]}/out/`)));
  });

  it('hands rclone the private-bucket pair and no media pair, whatever the shell holds', async () => {
    const store = seededStore([KEYS[0]!]);
    const rc = fakeRclone(store);
    await main(ARGS, { ...ENV_OK, R2_ACCESS_KEY_ID: 'media-id', R2_SECRET_ACCESS_KEY: 'media-secret', PATH: process.env['PATH'] }, stubWorker(store, []), () => undefined, {
      run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new MockSignPort(), clock, pollMs: 1,
    });
    expect(rc.calls.length).toBeGreaterThan(3);
    for (const c of rc.calls) {
      expect(c.env['RCLONE_CONFIG_R2_ACCESS_KEY_ID']).toBe('priv-id');
      expect(c.env['RCLONE_CONFIG_R2_SECRET_ACCESS_KEY']).toBe('priv-secret');
      expect(c.env['R2_ACCESS_KEY_ID']).toBe('priv-id');
      expect(c.env['RCLONE_CONFIG_R2_ENDPOINT']).toBe('https://acct.r2.cloudflarestorage.com');
      expect(JSON.stringify(c.env)).not.toMatch(/media-id|media-secret/);
      if (c.args[0] !== 'version') expect(c.args.join(' ')).toContain(`r2:${BUCKET}/`);
    }
    expect(privateRcloneEnv({ R2_ACCESS_KEY_ID: 'media-id', R2_PRIVATE_ACCESS_KEY_ID: 'p' })['R2_ACCESS_KEY_ID']).toBe('p');
  });

  it('--env prod without C2PA_CERT_CHAIN_PEM refuses before any upload (and before any rclone call)', async () => {
    const store = seededStore();
    const rc = fakeRclone(store);
    const logs: string[] = [];
    const { C2PA_CERT_CHAIN_PEM: _drop, ...noChain } = ENV_OK;
    const code = await main(['prewarm', '--release', 'r', '--finish', '--env', 'prod'], noChain, stubWorker(store, []), (l) => logs.push(l), { run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new MockSignPort(), clock });
    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/refused: --finish --env prod needs C2PA_CERT_CHAIN_PEM/);
    expect(rc.calls).toEqual([]);
    expect(rc.uploads).toEqual([]);
  });

  it('a staging run without the signing pair, or without the private pair, prints SKIP and exits 0', async () => {
    const store = seededStore();
    const rc = fakeRclone(store);
    for (const drop of ['C2PA_KEY_PEM', 'R2_PRIVATE_SECRET_ACCESS_KEY', 'OPS_TOKEN']) {
      const env: Record<string, string> = { ...ENV_OK };
      delete env[drop];
      const logs: string[] = [];
      const code = await main(ARGS, env, stubWorker(store, []), (l) => logs.push(l), { run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new MockSignPort(), clock });
      expect(code, drop).toBe(0);
      expect(logs.join('\n'), drop).toContain(`SKIP finish: ${drop} not set`);
    }
    expect(rc.uploads).toEqual([]);
  });

  it('a stub reader that reports a validation code other than signingCredential.untrusted refuses before any upload', async () => {
    const store = seededStore();
    const rc = fakeRclone(store);
    const stub = (codes: string[], ingredient = 'orig.mp4'): C2paModuleLike => ({
      LocalSigner: { newSigner: () => ({}) },
      Builder: {
        newAsync: () => Promise.resolve({ setIntent: () => undefined, addIngredient: () => Promise.resolve(), sign: (_s: unknown, i: { path: string }, o: { path: string }) => void writeFileSync(o.path, readFileSync(i.path)) }),
      },
      Reader: { fromAsset: () => Promise.resolve({ json: () => ({ validation_status: codes.map((code) => ({ code })) }), getActive: () => ({ label: 'urn:c2pa:x', ingredients: [{ title: ingredient }] }) }) },
    });
    const logs: string[] = [];
    const bad = await main(ARGS, ENV_OK, stubWorker(store, []), (l) => logs.push(l), {
      run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new C2paNodeSignPort({ certChainPem: 'c', keyPem: 'k', load: () => Promise.resolve(stub(['signingCredential.untrusted', 'claimSignature.mismatch'])) }), clock,
    });
    expect(bad).toBe(1);
    expect(logs.join('\n')).toMatch(/C2PA read-back of v768\.mp4 failed: validation code\(s\) claimSignature\.mismatch/);
    expect(rc.uploads).toEqual([]);

    // a claim without the orig.mp4 ingredient is refused the same way
    const noIngredient = await main(ARGS, ENV_OK, stubWorker(store, []), () => undefined, {
      run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new C2paNodeSignPort({ certChainPem: 'c', keyPem: 'k', load: () => Promise.resolve(stub(['signingCredential.untrusted'], 'other.mp4')) }), clock,
    });
    expect(noIngredient).toBe(1);
    expect(rc.uploads).toEqual([]);

    // the expected untrusted-root claim passes
    const ok = await main(ARGS, ENV_OK, stubWorker(store, []), () => undefined, {
      run: rc.run, makeTranscode: () => new MockTranscodePort(), makeSign: () => new C2paNodeSignPort({ certChainPem: 'c', keyPem: 'k', load: () => Promise.resolve(stub(['signingCredential.untrusted'])) }), clock, pollMs: 1,
    });
    expect(ok).toBe(0);
    expect(rc.uploads.length).toBeGreaterThan(0);
  });

  it('a key that already has a finish.json, or a ready manifest, is not finished again', () => {
    const k = KEYS[0]!;
    const other = KEYS[1]!;
    expect(pendingKeys([`${k}/handoff.json`, `${k}/orig.mp4`, `${other}/handoff.json`, `${other}/finish.json`, `${other}/out/r1/v768.mp4`, 'config/names-real.json'])).toEqual([k]);
  });

  it('a failed qa-gate uploads nothing for that key', async () => {
    const store = seededStore([KEYS[0]!]);
    const rc = fakeRclone(store);
    const logs: string[] = [];
    const tc = new MockTranscodePort();
    const code = await main(ARGS, ENV_OK, stubWorker(store, []), (l) => logs.push(l), {
      run: rc.run, makeTranscode: () => ({ transcode: async (o: Uint8Array) => ({ ...(await tc.transcode(o)), qa: { frames: 48, durationS: 2, fps: 24, blackS: 1.5, freezeS: 0, hasAudio: false, loudnessLufs: null } }) }), makeSign: () => new MockSignPort(), clock,
    });
    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/qa-gate: 1\.5 s of black in a 2\.0 s clip; nothing was uploaded for it/);
    expect(rc.uploads).toEqual([]);
  });
});

describe('the ladder runner and the pin (AC-5)', () => {
  const ORIG = fixtureBytes('orig.mp4');

  /** A bin directory with a stub ffmpeg and ffprobe that log their arguments and write placeholder outputs. */
  function stubBin(): { env: NodeJS.ProcessEnv; log: () => string[] } {
    const dir = tempDir('dv-stub-ffmpeg-');
    const logFile = path.join(dir, 'ffmpeg.log');
    writeFileSync(logFile, '');
    const ffmpeg = [
      '#!/bin/sh',
      'echo "$*" >> "$STUB_LOG"',
      'if [ "$1" = "-version" ]; then echo "ffmpeg version ${STUB_VERSION:-6.1.1-3ubuntu5} Copyright (c) 2000-2023 the FFmpeg developers"; exit 0; fi',
      'if [ "$1 $2" = "-hide_banner -encoders" ]; then',
      '  echo " V....D libx264              libx264 H.264 / AVC"',
      '  if [ -z "$STUB_NO_WEBP" ]; then echo " V..... libwebp              libwebp WebP image"; fi',
      '  exit 0',
      'fi',
      'for last; do :; done',
      'case "$last" in *.mp4|*.webp|*.m4a) printf "stub-%s" "$last" > "$last";; esac',
      'exit 0',
    ].join('\n');
    const ffprobe = [
      '#!/bin/sh',
      'case "$*" in',
      '  -version*) echo "ffprobe version 6.1.1-3ubuntu5";;',
      '  *stream=height*csv=p=0*) echo 72;;',
      '  *codec_type*) ;;',
      '  *"-of json"*) echo \'{"streams":[{"codec_name":"h264","width":128,"height":72,"r_frame_rate":"24/1","nb_read_frames":"48"}],"format":{"duration":"2.000000"}}\';;',
      'esac',
      'exit 0',
    ].join('\n');
    for (const [name, text] of [['ffmpeg', ffmpeg], ['ffprobe', ffprobe]] as const) {
      writeFileSync(path.join(dir, name), `${text}\n`);
      chmodSync(path.join(dir, name), 0o755);
    }
    return { env: { PATH: `${dir}:${process.env['PATH']}`, STUB_LOG: logFile }, log: () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean) };
  }

  const COMMON = '-c:v libx264 -profile:v high -preset slow -g 24 -keyint_min 24 -sc_threshold 0 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an -movflags +frag_keyframe+empty_moov+default_base_moof+cmaf';
  const HEAD = '-nostdin -hide_banner -loglevel error -y';

  it('hands the stub ffmpeg exactly the cut@1 arguments', async () => {
    const bin = stubBin();
    const port = new FfmpegTranscodePort({ env: bin.env, root: repoRoot });
    const r = await port.transcode(ORIG);
    const ladder = bin.log().filter((l) => l.startsWith(HEAD));
    expect(ladder).toEqual([
      `${HEAD} -i orig.mp4 ${COMMON} -level 4.0 -crf 21 -maxrate 5M -bufsize 10M out/v768.mp4`,
      `${HEAD} -i orig.mp4 -vf scale=-2:540 ${COMMON} -level 3.1 -crf 23 -maxrate 1.8M -bufsize 3.6M out/v540.mp4`,
      `${HEAD} -ss 0 -i orig.mp4 -frames:v 1 -c:v libwebp -quality 80 out/poster.webp`,
      `${HEAD} -sseof -0.1 -i orig.mp4 -frames:v 1 -update 1 -c:v libwebp -quality 80 out/last.webp`,
    ]);
    // the pin was checked first
    expect(bin.log().slice(0, 2)).toEqual(['-version', '-hide_banner -encoders']);
    expect(r.files.map((f) => f.file)).toEqual(['last.webp', 'poster.webp', 'v540.mp4', 'v768.mp4']);
    expect(r.renditions).toEqual({ v540: 'v540.mp4', v768: 'v768.mp4' });
    expect(r).toMatchObject({ recipe: 'cut@1', width: 128, height: 72, frames: 48, speechDetected: false, origC2pa: 'absent' });
    expect(r.files.find((f) => f.file === 'v768.mp4')?.codecs).toBe('avc1.640028');
    expect(r.files.find((f) => f.file === 'v540.mp4')?.codecs).toBe('avc1.64001f');
    expect(r.qa).toMatchObject({ frames: 48, blackS: 0, freezeS: 0, hasAudio: false, loudnessLufs: null });
  });

  it('refuses a stub that reports another version, and one that lists no libwebp encoder', async () => {
    const other = stubBin();
    await expect(new FfmpegTranscodePort({ env: { ...other.env, STUB_VERSION: '7.0.2' }, root: repoRoot }).transcode(ORIG)).rejects.toThrow(/ffmpeg reports version 7\.0\.2, the pin is 6\.1\.1-3ubuntu5/);
    expect(other.log().filter((l) => l.startsWith(HEAD))).toEqual([]); // nothing ran
    const noWebp = stubBin();
    await expect(new FfmpegTranscodePort({ env: { ...noWebp.env, STUB_NO_WEBP: '1' }, root: repoRoot }).transcode(ORIG)).rejects.toThrow(/ffmpeg lists no libwebp encoder/);
    expect(noWebp.log().filter((l) => l.startsWith(HEAD))).toEqual([]);
  });

  it('pins and parses', () => {
    expect(FFMPEG_PIN).toBe('6.1.1-3ubuntu5');
    expect(ffmpegVersionOf('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers\nbuilt with gcc 13')).toBe('6.1.1-3ubuntu5');
    expect(pinProblems('6.1.1-3ubuntu5', ' V....D libx264\n V..... libwebp\n')).toEqual([]);
    expect(pinProblems(null, '')).toHaveLength(3);
  });

  it('the qa-gate: frame count, black, frozen and loudness', () => {
    const ok = { frames: 48, durationS: 2, fps: 24, blackS: 0, freezeS: 0, hasAudio: false, loudnessLufs: null };
    expect(qaVerdict(ok, 48).ok).toBe(true);
    expect(qaVerdict({ ...ok, frames: 48 + 17 }, 48).ok).toBe(true);
    expect(qaVerdict({ ...ok, frames: 48 + 18 }, 48).reasons[0]).toMatch(/frames/);
    expect(qaVerdict({ ...ok, freezeS: 1 }, 48).reasons[0]).toMatch(/frozen/);
    expect(qaVerdict({ ...ok, hasAudio: true, loudnessLufs: -3 }, 48).reasons[0]).toMatch(/loudness/);
    expect(qaVerdict({ ...ok, hasAudio: true, loudnessLufs: -18 }, 48).ok).toBe(true);
  });
});

/** AC-8 for real, on this machine: the pinned ffmpeg, openssl and the pinned c2pa-node. Skipped where they are not installed. */
const realTools = ((): boolean => {
  const v = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return v.status === 0 && ffmpegVersionOf(v.stdout) === FFMPEG_PIN && spawnSync('openssl', ['version']).status === 0;
})();

describe.skipIf(!realTools)('prewarm --finish --local over the real tools (AC-8)', () => {
  it('the fixture clip becomes v768 High L4.0 and v540 540 lines with a keyframe every 24 frames, re-signed, and check:c2pa --verify-signatures passes', async () => {
    const dir = tempDir('dv-finish-real-');
    const pki = path.join(dir, 'pki');
    mkdirSync(pki);
    const sh = (cmd: string, args: string[], cwd: string): void => {
      const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
    };
    sh('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key'], pki);
    sh('openssl', ['req', '-new', '-x509', '-key', 'root.key', '-sha256', '-days', '30', '-subj', '/CN=Tha Bay Test Root/O=Tha Bay Test', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', 'root.pem'], pki);
    sh('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.sec1.key'], pki);
    sh('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', 'leaf.sec1.key', '-out', 'leaf.key'], pki);
    sh('openssl', ['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Tha Bay Test Signer/O=Tha Bay Test', '-out', 'leaf.csr'], pki);
    writeFileSync(path.join(pki, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
    sh('openssl', ['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem'], pki);
    const chain = Buffer.concat([readFileSync(path.join(pki, 'leaf.pem')), readFileSync(path.join(pki, 'root.pem'))]).toString('utf8');
    const out = path.join(dir, 'cut1-fixture');
    const logs: string[] = [];
    const orig = path.join(repoRoot, 'services/pipeline/fixtures/cutscene/orig.mp4');
    const code = await main(['prewarm', '--finish', '--local', orig, '--out', out], { PATH: process.env['PATH'], C2PA_CERT_CHAIN_PEM: chain, C2PA_KEY_PEM: readFileSync(path.join(pki, 'leaf.key'), 'utf8') }, fetch, (l) => logs.push(l));
    expect(logs.join('\n')).toMatch(/finish --local ok/);
    expect(code).toBe(0);

    const key = sha256Hex(new Uint8Array(readFileSync(orig)));
    const probe = (file: string): { profile: string; level: number; height: number; keyframes: number[] } => {
      const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=profile,level,height', '-show_entries', 'packet=pts_time,flags', '-of', 'json', file], { encoding: 'utf8' });
      const j = JSON.parse(r.stdout) as { streams: { profile: string; level: number; height: number }[]; packets: { flags: string }[] };
      const kf = j.packets.flatMap((p, i) => (p.flags.startsWith('K') ? [i] : []));
      return { ...j.streams[0]!, keyframes: kf };
    };
    const v768 = probe(path.join(out, key, 'v768.mp4'));
    const v540 = probe(path.join(out, key, 'v540.mp4'));
    expect(v768).toMatchObject({ profile: 'High', level: 40 });
    expect(v540.height).toBe(540);
    for (const p of [v768, v540]) expect(p.keyframes.every((k, i) => k === i * 24)).toBe(true);

    expect(existsSync(path.join(out, 'cutscene-index.json'))).toBe(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const verify = await checkC2pa(['--index', path.join(out, 'cutscene-index.json'), '--manifests', out, '--verify-signatures']);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    const errors = err.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    expect(errors).toBe('');
    expect(printed).toContain('check:c2pa ok: 1 shipped cutscene(s)');
    expect(verify).toBe(0);
  }, 120_000);
});
