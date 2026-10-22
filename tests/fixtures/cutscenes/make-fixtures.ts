/**
 * Generates the two original cutscene fixtures (M04c) and the two unlock clips.
 *
 *   tsx tests/fixtures/cutscenes/make-fixtures.ts [--fmp4]
 *
 * The animation is abstract shapes and colour fields (no text, no logos), drawn on a canvas by a pure function of time and recorded
 * with Playwright Chromium's MediaRecorder (VP9 WebM, the CI rendition). `--fmp4` needs ffmpeg on PATH: it makes the H.264 video-only
 * CMAF fMP4 `v768.mp4` of each fixture and `apps/web/public/media/blank.mp4` with the one `cut@1` recipe of
 * research/gap-cutscene-delivery-playback.md section 2.4 (its COMMON flags and its v768 line, codecs avc1.640028). Without ffmpeg the
 * manifests list only the WebM and `blank.webm` is recorded in the browser.
 *
 * MediaRecorder output has no duration header, so `frames` in the manifest comes from the recording plan (frames = seconds x 24). When
 * ffmpeg exists the WebM is remuxed once (`-c copy`) so that the element reports a finite duration; the video bytes are unchanged.
 * Rerunning rewrites the media, the manifests and the provenance records.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const FMP4 = process.argv.includes('--fmp4');
const FPS = 24;
const W = 1344;
const H = 768;

interface Fixture { id: 'fixture-a' | 'fixture-b'; seconds: number; hue: number; cues: { start: number; end: number; text: string }[] }
const FIXTURES: Fixture[] = [
  { id: 'fixture-a', seconds: 8, hue: 210, cues: [{ start: 0.5, end: 3.5, text: 'Fixture A, first cue.' }, { start: 4, end: 7.5, text: 'Fixture A, second cue.' }] },
  { id: 'fixture-b', seconds: 6, hue: 20, cues: [{ start: 0.5, end: 2.8, text: 'Fixture B, first cue.' }, { start: 3, end: 5.5, text: 'Fixture B, second cue.' }] },
];

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
}

// research/gap-cutscene-delivery-playback.md section 2.4: COMMON flags and the v768 line (video only, CMAF fMP4).
const COMMON = ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
  '-an', '-movflags', '+frag_keyframe+empty_moov+default_base_moof+cmaf'];
const V768 = ['-r', '24', '-level', '4.0', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M'];

/** The drawing function runs inside the page; it is a pure function of (t, seconds, hue). */
const DRAW = `
(function(){
  return function draw(ctx, w, h, t, seconds, hue){
    const p = t / seconds;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'hsl(' + ((hue + 60 * p) % 360) + ',55%,18%)');
    g.addColorStop(1, 'hsl(' + ((hue + 140 + 60 * p) % 360) + ',60%,32%)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      const a = t * (0.6 + i * 0.17) + i * 1.3;
      const x = w * (0.5 + 0.38 * Math.cos(a)), y = h * (0.5 + 0.34 * Math.sin(a * 1.2 + i));
      const r = h * (0.07 + 0.03 * Math.sin(a * 2 + i));
      ctx.fillStyle = 'hsla(' + ((hue + i * 38 + 90 * p) % 360) + ',80%,62%,0.85)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, h * 0.94, w * p, h * 0.02);
  };
})()
`;

// The in-page recorder is a string so that tsx does not inject its `__name` helper into the evaluated function.
const RECORD_IN_PAGE = `async ({ draw, w, h, fps, seconds, hue }) => {
  const drawFn = (0, eval)(draw);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, w, h, 0, seconds, hue);
  const poster = canvas.toDataURL('image/webp', 0.8);
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 500000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = () => res(); });
  rec.start(250);
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawFn(ctx, w, h, Math.min(t, seconds), seconds, hue);
      if (t >= seconds) res();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  drawFn(ctx, w, h, seconds, seconds, hue);
  const last = canvas.toDataURL('image/webp', 0.8);
  await new Promise((r) => setTimeout(r, 100));
  rec.stop();
  await done;
  const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { webm: btoa(bin), poster, last };
}`;

async function record(page: import('@playwright/test').Page, f: Fixture): Promise<{ webm: Buffer; poster: Buffer; last: Buffer }> {
  const args = { draw: DRAW, w: W, h: H, fps: FPS, seconds: f.seconds, hue: f.hue };
  const out = (await page.evaluate(`(${RECORD_IN_PAGE})(${JSON.stringify(args)})`)) as { webm: string; poster: string; last: string };
  const dataUrl = (s: string): Buffer => Buffer.from(s.split(',')[1] ?? '', 'base64');
  return { webm: Buffer.from(out.webm, 'base64'), poster: dataUrl(out.poster), last: dataUrl(out.last) };
}

const vttTime = (s: number): string => {
  const ms = Math.round(s * 1000);
  const pad = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

interface Rendition { file: string; bytes: number; sha256: string; codecs: string; kbps: number }
function rendition(dir: string, file: string, codecs: string, seconds: number): Rendition {
  const b = readFileSync(path.join(dir, file));
  return { file, bytes: b.length, sha256: sha256(b), codecs, kbps: Math.round((b.length * 8) / seconds / 1000) };
}

function writeProvenance(files: { rel: string; sha: string }[]): void {
  for (const { rel, sha } of files) {
    const dir = path.join(root, 'assets/provenance', sha.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    const rec = {
      schema: 'provenance/1.0', sha256: sha, paths: [rel], kind: 'cutscene', origin: 'authored', license: 'LicenseRef-DeeVerse-Owned',
      authors: ['studio:dee-verse'], derived_from: [],
      tool: { name: 'tests/fixtures/cutscenes/make-fixtures.ts', version: '1.0.0', args_sha256: sha256(Buffer.from(FMP4 ? '--fmp4' : '')) },
      review: [], ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' }, ai_generated: false, status: 'active', created_at: '2026-10-22T00:00:00Z',
    };
    writeFileSync(path.join(dir, `${sha}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  }
}

async function main(): Promise<void> {
  if (FMP4 && !hasFfmpeg) throw new Error('--fmp4 needs ffmpeg on PATH');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  const recorded: { rel: string; sha: string }[] = [];
  for (const f of FIXTURES) {
    const dir = path.join(here, f.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const r = await record(page, f);
    const rawWebm = path.join(dir, 'raw.webm');
    writeFileSync(rawWebm, r.webm);
    const webm = path.join(dir, 'v768.webm');
    if (hasFfmpeg) ffmpeg(['-i', rawWebm, '-c', 'copy', webm]);
    else writeFileSync(webm, r.webm);
    rmSync(rawWebm);
    if (FMP4) ffmpeg(['-i', webm, ...COMMON, ...V768, path.join(dir, 'v768.mp4')]);
    writeFileSync(path.join(dir, 'poster.webp'), r.poster);
    writeFileSync(path.join(dir, 'last.webp'), r.last);
    writeFileSync(
      path.join(dir, 'subs.en.vtt'),
      `WEBVTT\n\n${f.cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n')}`,
    );
    // The manifest has one slot per ladder step. The device rendition (H.264 fMP4) takes v768 when it exists; the VP9 WebM, which is
    // the CI rendition, takes v768 when it is alone and v540 otherwise (BD-M04c-02). The file names stay v768.webm and v768.mp4.
    const renditions: Record<string, Rendition> = {};
    if (FMP4) {
      renditions.v768 = rendition(dir, 'v768.mp4', 'avc1.640028', f.seconds);
      renditions.v540 = rendition(dir, 'v768.webm', 'vp09.00.40.08', f.seconds);
    } else renditions.v768 = rendition(dir, 'v768.webm', 'vp09.00.40.08', f.seconds);
    const frames = f.seconds * FPS;
    const manifest = {
      schema: 'cutscene-asset/1', key: sha256(Buffer.from(`fixture:${f.id}`)), recipe: 'cut@1', fps: 24, frames, width: W, height: H,
      renditions, poster: 'poster.webp', last: 'last.webp', subs: { en: 'subs.en.vtt' },
      shots: [{ shotId: 's1', startFrame: 0, frames }], characters: [],
      licence: { gate: 'ADR-GENAI-01', provider: 'fixture', status: 'pending', termsSnapshotSha256: [] },
      provenance: { endpoint: 'tests/fixtures/cutscenes/make-fixtures.ts', pinnedUpdatedAt: '2026-10-22', requestIds: [], origSha256: sha256(r.webm), c2pa: 'absent', resigned: false, aiGenerated: true },
    };
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const files = ['v768.webm', 'poster.webp', 'last.webp', ...(FMP4 ? ['v768.mp4'] : [])];
    for (const name of files) recorded.push({ rel: `tests/fixtures/cutscenes/${f.id}/${name}`, sha: sha256(readFileSync(path.join(dir, name))) });
  }

  // The unlock clips: 0.1 s black, same origin. blank.webm is the CI clip; blank.mp4 is the production clip.
  const media = path.join(root, 'apps/web/public/media');
  mkdirSync(media, { recursive: true });
  if (hasFfmpeg) {
    const src = ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=0.1'];
    ffmpeg([...src, '-c:v', 'libvpx-vp9', '-b:v', '50k', '-pix_fmt', 'yuv420p', '-an', path.join(media, 'blank.webm')]);
    if (FMP4) ffmpeg([...src, ...COMMON, '-level', '4.0', '-crf', '28', path.join(media, 'blank.mp4')]);
  } else {
    const r = await record(page, { id: 'fixture-a', seconds: 0.2, hue: 0, cues: [] });
    writeFileSync(path.join(media, 'blank.webm'), r.webm);
  }
  for (const name of ['blank.webm', 'blank.mp4']) {
    if (existsSync(path.join(media, name))) recorded.push({ rel: `apps/web/public/media/${name}`, sha: sha256(readFileSync(path.join(media, name))) });
  }
  writeProvenance(recorded);
  await browser.close();
  console.log(`wrote ${recorded.length} files (ffmpeg ${hasFfmpeg ? 'yes' : 'no'}, fmp4 ${FMP4 ? 'yes' : 'no'})`);
}

void main();
