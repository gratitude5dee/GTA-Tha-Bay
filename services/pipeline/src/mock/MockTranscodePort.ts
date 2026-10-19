import type { TranscodePort, TranscodeResult } from '../ports.ts';
import { fixtureBytes, fixtureEntry } from './fixtures.ts';

/** Returns the committed fixture renditions, poster and last frame (already carrying our C2PA claim). */
export class MockTranscodePort implements TranscodePort {
  transcode(_orig: Uint8Array): Promise<TranscodeResult> {
    const durationS = 2;
    const rendition = (file: string): { file: string; bytes: Uint8Array; contentType: string; codecs: string; kbps: number } => {
      const e = fixtureEntry(file);
      return { file, bytes: fixtureBytes(file), contentType: 'video/mp4', codecs: e.codecs ?? 'avc1.42c00a', kbps: Math.round((e.bytes * 8) / durationS / 1000) };
    };
    const v768 = fixtureEntry('v768.mp4');
    return Promise.resolve({
      recipe: 'cut@1',
      files: [
        rendition('v768.mp4'),
        rendition('v540.mp4'),
        { file: 'poster.webp', bytes: fixtureBytes('poster.webp'), contentType: 'image/webp' },
        { file: 'last.webp', bytes: fixtureBytes('last.webp'), contentType: 'image/webp' },
      ],
      width: v768.width ?? 128,
      height: v768.height ?? 72,
      frames: v768.frames ?? 48,
      renditions: { v768: 'v768.mp4', v540: 'v540.mp4' },
      speechDetected: false,
      origC2pa: 'absent',
    });
  }
}
