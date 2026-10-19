import type { SignedFile, SignPort } from '../ports.ts';

/**
 * Marks a rendition `resigned: true`. The fixture renditions were re-signed once with the pinned C2PA tool by
 * fixtures/sign-fixtures.ts (claim trainedAlgorithmicMedia, orig.mp4 as ingredient), so the bytes pass through unchanged;
 * the claim's signing certificate is a throw-away test chain, hence `valid-untrusted`. The live adapter runs where the
 * transcoder runs (M05c3 onward).
 */
export class MockSignPort implements SignPort {
  resign(rendition: { file: string; bytes: Uint8Array; contentType: string }, _orig: Uint8Array): Promise<SignedFile> {
    const isVideo = rendition.contentType.startsWith('video/');
    return Promise.resolve({ bytes: rendition.bytes, c2pa: isVideo ? 'valid-untrusted' : 'absent', resigned: true });
  }
}
