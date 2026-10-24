/**
 * M05c3: the real TranscodePort and SignPort map requests and responses correctly against a stub container, and the cutscene job
 * refuses before it spends when the container or the signer is missing. `transcoder-container.test.ts` runs the same adapters
 * against the real server and ffmpeg.
 */
import { describe, expect, it } from 'vitest';
import { ContainerSignPort, ContainerTranscodePort, containerPorts, fromBase64, ladderToResult, toBase64, type ContainerFetcher, type LadderWire } from '../src/transcode.ts';

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);

const wire = (over: Partial<LadderWire> = {}): LadderWire => ({
  recipe: 'cut@1', width: 1344, height: 768, frames: 168, fps: 24, durationS: 7, hasAudio: true, origC2pa: 'valid-untrusted',
  renditions: { v768: 'v768.mp4', v540: 'v540.mp4' },
  files: [
    { file: 'v768.mp4', contentType: 'video/mp4', codecs: 'avc1.640028', kbps: 4100, bytes: toBase64(bytes(1, 2, 3)) },
    { file: 'v540.mp4', contentType: 'video/mp4', codecs: 'avc1.64001f', kbps: 1500, bytes: toBase64(bytes(4, 5)) },
    { file: 'poster.webp', contentType: 'image/webp', bytes: toBase64(bytes(9)) },
    { file: 'last.webp', contentType: 'image/webp', bytes: toBase64(bytes(8)) },
  ],
  ...over,
});

interface Seen {
  method: string;
  path: string;
  type: string | null;
  body: Uint8Array;
}

function stub(handler: (path: string, req: Request) => Response | Promise<Response>): { container: ContainerFetcher; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    container: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        seen.push({ method: request.method, path, type: request.headers.get('Content-Type'), body: new Uint8Array(await request.clone().arrayBuffer()) });
        return handler(path, request);
      },
    },
  };
}

const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

describe('base64 helpers', () => {
  it('round-trip bytes, including a buffer larger than one chunk', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(toBase64(bytes())).toBe('');
  });
});

describe('ContainerTranscodePort', () => {
  it('posts the original to /ladder and maps the answer to a TranscodeResult', async () => {
    const { container, seen } = stub(() => json(wire()));
    const orig = bytes(7, 7, 7, 7);
    const r = await new ContainerTranscodePort(container).transcode(orig);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/ladder', type: 'video/mp4' });
    expect(seen[0]!.body).toEqual(orig);
    expect(r).toMatchObject({ recipe: 'cut@1', width: 1344, height: 768, frames: 168, speechDetected: false, origC2pa: 'valid-untrusted', renditions: { v768: 'v768.mp4', v540: 'v540.mp4' } });
    expect(r.files.map((f) => f.file)).toEqual(['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp']);
    expect(r.files[0]).toMatchObject({ contentType: 'video/mp4', codecs: 'avc1.640028', kbps: 4100 });
    expect(r.files[0]!.bytes).toEqual(bytes(1, 2, 3));
    expect(r.files[2]!.codecs).toBeUndefined();
  });

  it('throws with the status and the container message on a non-2xx answer (the Workflow step retries)', async () => {
    const { container } = stub(() => json({ error: 'unsupported_fps:30' }, 422));
    await expect(new ContainerTranscodePort(container).transcode(bytes(1))).rejects.toThrow(/HTTP 422.*unsupported_fps:30/);
  });

  it('rejects a response with an unknown shape or a rendition that names a missing file', () => {
    expect(() => ladderToResult({ hello: 'world' })).toThrow(/unknown shape/);
    expect(() => ladderToResult(wire({ renditions: { v768: 'v768.mp4', v540: 'gone.mp4' } }))).toThrow(/gone\.mp4/);
    expect(() => ladderToResult(wire({ renditions: { v540: 'v540.mp4' } }))).toThrow(/no v768 or v1080/);
    expect(() => ladderToResult(wire({ origC2pa: 'bogus' as never }))).toThrow(/unknown shape/);
  });

  it('ready() is null when /health answers ok and the reason otherwise', async () => {
    expect(await new ContainerTranscodePort(stub(() => json({ ok: true, signer: false })).container).ready()).toBeNull();
    expect(await new ContainerTranscodePort(stub(() => json({ ok: false, signer: false })).container).ready()).toMatch(/not ok/);
    expect(await new ContainerTranscodePort(stub(() => new Response('x', { status: 503 })).container).ready()).toMatch(/HTTP 503/);
    const down: ContainerFetcher = { fetch: () => Promise.reject(new Error('no instance')) };
    expect(await new ContainerTranscodePort(down).ready()).toMatch(/did not answer.*no instance/);
  });
});

describe('ContainerSignPort', () => {
  const rendition = { file: 'v768.mp4', bytes: bytes(1, 2, 3), contentType: 'video/mp4' };

  it('posts the rendition and the original as base64 and returns the signed bytes', async () => {
    const { container, seen } = stub(() => json({ bytes: toBase64(bytes(9, 9)), c2pa: 'valid-untrusted' }));
    const out = await new ContainerSignPort(container).resign(rendition, bytes(5, 5));
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/resign', type: 'application/json' });
    expect(JSON.parse(new TextDecoder().decode(seen[0]!.body))).toEqual({ file: 'v768.mp4', contentType: 'video/mp4', rendition: toBase64(bytes(1, 2, 3)), orig: toBase64(bytes(5, 5)) });
    expect(out).toEqual({ bytes: bytes(9, 9), c2pa: 'valid-untrusted', resigned: true });
  });

  it('never returns a claim that reads back absent or invalid', async () => {
    for (const c2pa of ['absent', 'invalid']) {
      const { container } = stub(() => json({ bytes: toBase64(bytes(9)), c2pa }));
      await expect(new ContainerSignPort(container).resign(rendition, bytes(5))).rejects.toThrow(new RegExp(`reads back as c2pa ${c2pa}`));
    }
  });

  it('surfaces a missing signer (503) and an unknown shape', async () => {
    await expect(new ContainerSignPort(stub(() => json({ error: 'c2pa_signer_not_configured' }, 503)).container).resign(rendition, bytes(5))).rejects.toThrow(/HTTP 503.*c2pa_signer_not_configured/);
    await expect(new ContainerSignPort(stub(() => json({ nope: 1 })).container).resign(rendition, bytes(5))).rejects.toThrow(/unknown shape/);
  });

  it('ready() needs the container to report a signer', async () => {
    expect(await new ContainerSignPort(stub(() => json({ ok: true, signer: true })).container).ready()).toBeNull();
    expect(await new ContainerSignPort(stub(() => json({ ok: true, signer: false })).container).ready()).toMatch(/no C2PA signing key/);
  });
});

describe('containerPorts', () => {
  it('returns null without a binding and ports on one stub per key with it', () => {
    expect(containerPorts(undefined, 'a'.repeat(64))).toBeNull();
    const names: string[] = [];
    const p = containerPorts({ getByName: (n) => (names.push(n), stub(() => json(wire())).container) }, 'k'.repeat(64));
    expect(names).toEqual(['k'.repeat(64)]);
    expect(p?.transcode).toBeInstanceOf(ContainerTranscodePort);
    expect(p?.sign).toBeInstanceOf(ContainerSignPort);
  });
});
