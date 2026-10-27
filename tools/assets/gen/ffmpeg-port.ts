/**
 * `TranscodePort` over the pinned `ffmpeg` and `ffprobe` (M05c4, DL-629: separate processes, nothing of theirs ships). Runs
 * `services/pipeline/transcoder/ladder.sh` (recipe `cut@1`, unchanged) on the operator's workstation, either with the Ubuntu 24.04 package
 * on the PATH (`ffmpeg=7:6.1.1-3ubuntu5`) or, with `mode: 'docker'`, inside a local image built from `Dockerfile.ladder`.
 *
 * It refuses to run unless `ffmpeg -version` reports the pin of spec/03-decisions-and-facts.md section 7 and `ffmpeg -hide_banner -encoders`
 * lists `libx264` and `libwebp`. Besides the ladder it measures what the `qa-gate` needs from `ffprobe` and two `ffmpeg` filters: the frame
 * count, black and frozen frames, and the loudness of the original's audio.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TranscodedFile, TranscodePort, TranscodeResult } from '../../../services/pipeline/src/ports.ts';
import { repoRoot } from '../../ci/run.ts';

/** `ffmpeg -version` of the Ubuntu 24.04 archive package ffmpeg=7:6.1.1-3ubuntu5 (spec/03 section 7). */
export const FFMPEG_PIN = '6.1.1-3ubuntu5';
export const LADDER_DIR = 'services/pipeline/transcoder';
export const LADDER_IMAGE = 'dv-ladder:cut1';
/** Frame count tolerance of the qa-gate (05-assets-pipeline.md section 6 step 8). */
export const QA_FRAME_TOLERANCE = 17;

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}
export type Exec = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => ExecResult;

export const spawnExec: Exec = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}), ...(opts.env !== undefined ? { env: opts.env } : {}), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.message };
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};

export interface FfmpegPortOptions {
  mode?: 'native' | 'docker';
  exec?: Exec;
  /** Environment of the child processes; tests put a stub `ffmpeg` first on the PATH. */
  env?: NodeJS.ProcessEnv;
  /** Repository root, for `ladder.sh` and the Dockerfile. */
  root?: string;
  image?: string;
  /** Reads the C2PA state of the original (the pinned `Reader`); absent: `absent`. */
  origC2pa?: (file: string) => Promise<TranscodeResult['origC2pa']>;
}

/** What the qa-gate measured on the original. */
export interface QaMeasures {
  frames: number;
  durationS: number;
  fps: number;
  blackS: number;
  freezeS: number;
  hasAudio: boolean;
  /** Integrated loudness in LUFS, when the original has an audio track and the filter reported it. */
  loudnessLufs: number | null;
}

export interface OffEdgeTranscode extends TranscodeResult {
  qa: QaMeasures;
}

/** Parses the version token of `ffmpeg -version`'s first line. */
export function ffmpegVersionOf(stdout: string): string | null {
  return /^ffmpeg version (\S+)/m.exec(stdout)?.[1] ?? null;
}

/** Problems with the pinned tool; empty when the version is the pin and both encoders are listed. */
export function pinProblems(version: string | null, encoders: string): string[] {
  const out: string[] = [];
  if (version !== FFMPEG_PIN) out.push(`ffmpeg reports version ${version ?? 'unknown'}, the pin is ${FFMPEG_PIN} (spec/03 section 7)`);
  for (const enc of ['libx264', 'libwebp']) if (!new RegExp(`\\b${enc}\\b`).test(encoders)) out.push(`ffmpeg lists no ${enc} encoder`);
  return out;
}

/** RFC 6381 codec string from the avcC box (version, profile, compatibility, level). */
export function avcCodec(mp4: Uint8Array): string | undefined {
  const at = Buffer.from(mp4).indexOf('avcC');
  if (at < 0) return undefined;
  return `avc1.${[...mp4.subarray(at + 5, at + 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface QaVerdict {
  ok: boolean;
  reasons: string[];
}

/** The qa-gate (05-assets-pipeline.md section 6 step 8): frames within 17 of the plan, no mostly black or frozen clip, sane loudness. */
export function qaVerdict(q: QaMeasures, expectedFrames: number): QaVerdict {
  const reasons: string[] = [];
  if (!(q.frames > 0) || Math.abs(q.frames - expectedFrames) > QA_FRAME_TOLERANCE) reasons.push(`${q.frames} frames, expected ${expectedFrames} +-${QA_FRAME_TOLERANCE}`);
  if (q.durationS > 0 && q.blackS >= q.durationS * 0.5) reasons.push(`${q.blackS.toFixed(1)} s of black in a ${q.durationS.toFixed(1)} s clip`);
  if (q.durationS > 0 && q.freezeS >= q.durationS * 0.5) reasons.push(`${q.freezeS.toFixed(1)} s of frozen frames in a ${q.durationS.toFixed(1)} s clip`);
  if (q.hasAudio && q.loudnessLufs !== null && (q.loudnessLufs > -9 || q.loudnessLufs < -40)) reasons.push(`integrated loudness ${q.loudnessLufs.toFixed(1)} LUFS is outside -40..-9`);
  return { ok: reasons.length === 0, reasons };
}

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webp': 'image/webp', '.m4a': 'audio/mp4' };
const RENDITION_IDS: Record<string, string> = { 'v768.mp4': 'v768', 'v540.mp4': 'v540', 'v1080.mp4': 'v1080' };

export class FfmpegTranscodePort implements TranscodePort {
  private readonly mode: 'native' | 'docker';
  private readonly exec: Exec;
  private readonly env: NodeJS.ProcessEnv;
  private readonly root: string;
  private readonly image: string;
  private checked = false;

  constructor(private readonly o: FfmpegPortOptions = {}) {
    this.mode = o.mode ?? 'native';
    this.exec = o.exec ?? spawnExec;
    this.env = o.env ?? process.env;
    this.root = o.root ?? repoRoot;
    this.image = o.image ?? LADDER_IMAGE;
  }

  /** Runs a tool where it lives: on the PATH, or in the local image with `dir` mounted at /work and the ladder script at /ladder. */
  private tool(cmd: string, args: string[], dir: string): ExecResult {
    if (this.mode === 'native') return this.exec(cmd, args, { cwd: dir, env: this.env });
    const ladder = path.join(this.root, LADDER_DIR);
    return this.exec('docker', ['run', '--rm', '-v', `${dir}:/work`, '-v', `${ladder}:/ladder:ro`, '-w', '/work', this.image, cmd, ...args], { env: this.env });
  }

  /** The pin check. Throws a refusal naming every problem; docker mode builds the image first when it is missing. */
  async preflight(): Promise<void> {
    if (this.checked) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-ffcheck-'));
    try {
      if (this.mode === 'docker') {
        const have = this.exec('docker', ['image', 'inspect', this.image], { env: this.env });
        if (have.status !== 0) {
          const build = this.exec('docker', ['build', '-t', this.image, '-f', path.join(this.root, LADDER_DIR, 'Dockerfile.ladder'), path.join(this.root, LADDER_DIR)], { env: this.env });
          if (build.status !== 0) throw new Error(`docker build of ${this.image} failed: ${build.stderr.split('\n').slice(-3).join(' ').trim()}`);
        }
      }
      const v = this.tool('ffmpeg', ['-version'], dir);
      const e = this.tool('ffmpeg', ['-hide_banner', '-encoders'], dir);
      const p = this.tool('ffprobe', ['-version'], dir);
      if (v.status === 127 || p.status === 127) throw new Error('ffmpeg and ffprobe were not found; install ffmpeg=7:6.1.1-3ubuntu5 (Ubuntu 24.04) or pass --ffmpeg docker');
      const problems = pinProblems(v.status === 0 ? ffmpegVersionOf(v.stdout) : null, e.status === 0 ? e.stdout : '');
      if (p.status !== 0) problems.push('ffprobe did not run');
      if (problems.length > 0) throw new Error(`refused: ${problems.join('; ')}`);
      this.checked = true;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private probe(dir: string, file: string): { width: number; height: number; frames: number; fps: number; durationS: number; codec: string; hasAudio: boolean } {
    const v = this.tool('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file], dir);
    if (v.status !== 0) throw new Error(`ffprobe cannot read the original: ${v.stderr.trim().slice(-200)}`);
    const j = JSON.parse(v.stdout) as { streams?: { codec_name: string; width: number; height: number; r_frame_rate: string; nb_read_frames: string }[]; format?: { duration?: string } };
    const s = j.streams?.[0];
    if (s === undefined) throw new Error('the original has no video stream');
    const [num, den] = s.r_frame_rate.split('/').map(Number) as [number, number];
    const a = this.tool('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], dir);
    return { width: s.width, height: s.height, frames: Number(s.nb_read_frames), fps: den > 0 ? num / den : 0, durationS: Number(j.format?.duration ?? 0), codec: s.codec_name, hasAudio: a.stdout.trim().length > 0 };
  }

  private measure(dir: string, file: string, p: { frames: number; durationS: number; fps: number; hasAudio: boolean }): QaMeasures {
    const det = this.tool('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-an', '-vf', 'blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2', '-f', 'null', '-'], dir);
    const text = `${det.stdout}\n${det.stderr}`;
    const sum = (re: RegExp): number => [...text.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0);
    let loudnessLufs: number | null = null;
    if (p.hasAudio) {
      const l = this.tool('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], dir);
      const m = /Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?) LUFS/.exec(`${l.stdout}\n${l.stderr}`);
      loudnessLufs = m ? Number(m[1]) : null;
    }
    return { frames: p.frames, durationS: p.durationS, fps: p.fps, blackS: sum(/black_duration:\s*(\d+(?:\.\d+)?)/g), freezeS: sum(/freeze_duration:\s*(\d+(?:\.\d+)?)/g), hasAudio: p.hasAudio, loudnessLufs };
  }

  async transcode(orig: Uint8Array): Promise<OffEdgeTranscode> {
    await this.preflight();
    if (orig.length === 0) throw new Error('the original is empty');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-ladder-'));
    try {
      writeFileSync(path.join(dir, 'orig.mp4'), orig);
      const p = this.probe(dir, 'orig.mp4');
      // The H3 family writes H.264 at 24 fps; anything else means the model or the recipe changed (05-assets-pipeline.md section 6 step 8).
      if (p.codec !== 'h264') throw new Error(`unsupported codec ${p.codec} in the original`);
      if (Math.abs(p.fps - 24) > 0.01) throw new Error(`unsupported frame rate ${p.fps} in the original`);
      mkdirSync(path.join(dir, 'out'));
      const script = this.mode === 'docker' ? '/ladder/ladder.sh' : path.join(this.root, LADDER_DIR, 'ladder.sh');
      const r = this.tool('bash', [script, 'orig.mp4', 'out'], dir);
      if (r.status !== 0) throw new Error(`ladder.sh failed: ${r.stderr.trim().slice(-400)}`);
      const files: TranscodedFile[] = [];
      const renditions: Record<string, string> = {};
      for (const name of readdirSync(path.join(dir, 'out')).sort()) {
        if (name === 'a.m4a') continue; // engine audio (C09 allows a manifest without it); captions are not run off-edge
        const bytes = new Uint8Array(readFileSync(path.join(dir, 'out', name)));
        const f: TranscodedFile = { file: name, bytes, contentType: CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream' };
        const id = RENDITION_IDS[name];
        if (id !== undefined) {
          f.codecs = avcCodec(bytes) ?? (id === 'v540' ? 'avc1.64001f' : 'avc1.640028');
          f.kbps = Math.round((bytes.length * 8) / Math.max(p.durationS, 0.001) / 1000);
          renditions[id] = name;
        }
        files.push(f);
      }
      const qa = this.measure(dir, 'orig.mp4', p);
      const origC2pa = this.o.origC2pa !== undefined ? await this.o.origC2pa(path.join(dir, 'orig.mp4')) : 'absent';
      return { recipe: 'cut@1', files, width: p.width, height: p.height, frames: p.frames, renditions, speechDetected: false, origC2pa, qa };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
