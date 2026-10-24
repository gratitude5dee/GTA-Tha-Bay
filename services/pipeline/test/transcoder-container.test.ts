/**
 * M05c3: the Transcoder Container's server (`services/pipeline/transcoder/server.ts`) with real ffmpeg and the pinned C2PA tool,
 * driven by the real adapters of `src/transcode.ts`. The container image itself needs a Docker daemon and is built by the deploy;
 * this test runs the same `node server.ts` from a scratch copy of the image's files, with the tool installed from the image's
 * package-lock.json. It skips with a printed reason when ffmpeg, openssl or the npm install is not available.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContainerSignPort, ContainerTranscodePort, type ContainerFetcher } from '../src/transcode.ts';

const here = import.meta.dirname;
const transcoderDir = path.join(here, '../transcoder');
const fixtureOrig = readFileSync(path.join(here, '../fixtures/cutscene/orig.mp4'));

const have = (cmd: string): boolean => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const toolsOk = have('ffmpeg') && have('ffprobe') && spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not come up`);
}

/** A fetcher that sends the container requests to a local server; the path is what the real Container class forwards. */
function viaHttp(base: string): ContainerFetcher {
  return {
    async fetch(request) {
      const url = base + new URL(request.url).pathname;
      const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
      return fetch(url, { method: request.method, headers: request.headers, ...(body !== undefined ? { body } : {}) });
    },
  };
}

function makeChain(dir: string): { chain: string; key: string } {
  const sh = (cmd: string, argv: string[]): void => {
    const r = spawnSync(cmd, argv, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')}: ${r.stderr}`);
  };
  sh('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key']);
  sh('openssl', ['req', '-new', '-x509', '-key', 'root.key', '-sha256', '-days', '30', '-subj', '/CN=Test Root/O=Tha Bay Test', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', 'root.pem']);
  sh('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.sec1.key']);
  sh('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', 'leaf.sec1.key', '-out', 'leaf.key']);
  sh('openssl', ['req', '-new', '-key', 'leaf.key', '-subj', '/CN=Test Signer/O=Tha Bay Test', '-out', 'leaf.csr']);
  writeFileSync(path.join(dir, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
  sh('openssl', ['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem']);
  return { chain: readFileSync(path.join(dir, 'leaf.pem'), 'utf8') + readFileSync(path.join(dir, 'root.pem'), 'utf8'), key: readFileSync(path.join(dir, 'leaf.key'), 'utf8') };
}

let tmp = '';
let withSigner: { child: ChildProcess; base: string } | null = null;
let withoutSigner: { child: ChildProcess; base: string } | null = null;
let skipReason: string | null = toolsOk ? null : 'ffmpeg, ffprobe or openssl is not installed';

async function start(env: Record<string, string>): Promise<{ child: ChildProcess; base: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.ts'], { cwd: path.join(tmp, 'app'), env: { PATH: process.env['PATH'] ?? '', PORT: String(port), ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/ping`);
  return { child, base };
}

beforeAll(async () => {
  if (skipReason !== null) return;
  tmp = mkdtempSync(path.join(os.tmpdir(), 'dv-transcoder-'));
  const app = path.join(tmp, 'app');
  mkdirSync(app);
  for (const f of ['server.ts', 'ladder.sh', 'package.json', 'package-lock.json']) copyFileSync(path.join(transcoderDir, f), path.join(app, f));
  // The image's own install step: npm ci from the lock file, no scripts.
  const install = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8', timeout: 180_000 });
  if (install.status !== 0) {
    skipReason = `npm ci of the pinned C2PA tool failed (${(install.stderr || install.stdout).slice(-160).trim()})`;
    return;
  }
  const { chain, key } = makeChain(tmp);
  withSigner = await start({ C2PA_CERT_CHAIN_PEM: chain, C2PA_KEY_PEM: key });
  withoutSigner = await start({});
}, 240_000);

afterAll(() => {
  withSigner?.child.kill();
  withoutSigner?.child.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const run = (name: string, fn: () => Promise<void>, ms = 120_000): void => {
  it(name, async (ctx) => {
    if (skipReason !== null || withSigner === null || withoutSigner === null) {
      console.log(`SKIP transcoder-container: ${skipReason ?? 'server did not start'}`);
      ctx.skip();
      return;
    }
    await fn();
  }, ms);
};

describe('Transcoder Container server over real ffmpeg', () => {
  run('/ladder turns the original into the cut@1 ladder and TranscodePort maps it', async () => {
    const port = new ContainerTranscodePort(viaHttp(withSigner!.base));
    expect(await port.ready()).toBeNull();
    const r = await port.transcode(new Uint8Array(fixtureOrig));
    expect(r).toMatchObject({ recipe: 'cut@1', width: 128, height: 72, frames: 48, speechDetected: false, origC2pa: 'absent' });
    expect(r.renditions).toEqual({ v540: 'v540.mp4', v768: 'v768.mp4' });
    expect(r.files.map((f) => f.file).sort()).toEqual(['last.webp', 'poster.webp', 'v540.mp4', 'v768.mp4']);
    const v768 = r.files.find((f) => f.file === 'v768.mp4')!;
    const v540 = r.files.find((f) => f.file === 'v540.mp4')!;
    expect(v768.codecs).toBe('avc1.640028'); // High, level 4.0
    expect(v540.codecs).toBe('avc1.64001f'); // High, level 3.1
    expect(v768.bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(v768.bytes.subarray(4, 8))).toBe('ftyp');
    expect(new TextDecoder().decode(r.files.find((f) => f.file === 'poster.webp')!.bytes.subarray(8, 12))).toBe('WEBP');
    // video-only renditions
    const dir = mkdtempSync(path.join(tmp, 'probe-'));
    writeFileSync(path.join(dir, 'v.mp4'), v768.bytes);
    const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(dir, 'v.mp4')], { encoding: 'utf8' }).stdout.trim();
    expect(streams).toBe('video');
  });

  run('/ladder refuses a source that is not 24 fps', async () => {
    const dir = mkdtempSync(path.join(tmp, 'fps-'));
    const f = path.join(dir, 'thirty.mp4');
    const mk = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    expect(mk.status).toBe(0);
    const port = new ContainerTranscodePort(viaHttp(withSigner!.base));
    await expect(port.transcode(new Uint8Array(readFileSync(f)))).rejects.toThrow(/HTTP 422.*unsupported_fps/);
  });

  run('/resign signs a rendition with orig.mp4 as the ingredient and SignPort accepts the readback', async () => {
    const container = viaHttp(withSigner!.base);
    const sign = new ContainerSignPort(container);
    expect(await sign.ready()).toBeNull();
    const ladder = await new ContainerTranscodePort(container).transcode(new Uint8Array(fixtureOrig));
    const v768 = ladder.files.find((f) => f.file === 'v768.mp4')!;
    const signed = await sign.resign({ file: 'v768.mp4', bytes: v768.bytes, contentType: 'video/mp4' }, new Uint8Array(fixtureOrig));
    expect(signed).toMatchObject({ c2pa: 'valid-untrusted', resigned: true });
    expect(signed.bytes.length).toBeGreaterThan(v768.bytes.length); // the claim adds a manifest box
    expect(Buffer.from(signed.bytes).includes('jumb')).toBe(true);
  });

  run('without a signing key the container says so and /resign answers 503', async () => {
    const container = viaHttp(withoutSigner!.base);
    const sign = new ContainerSignPort(container);
    expect(await sign.ready()).toMatch(/no C2PA signing key/);
    await expect(sign.resign({ file: 'v768.mp4', bytes: new Uint8Array([1]), contentType: 'video/mp4' }, new Uint8Array([2]))).rejects.toThrow(/HTTP 503.*c2pa_signer_not_configured/);
    // transcoding still works: the original stays private and unsigned
    const r = await new ContainerTranscodePort(container).transcode(new Uint8Array(fixtureOrig));
    expect(r.frames).toBe(48);
  });
});
