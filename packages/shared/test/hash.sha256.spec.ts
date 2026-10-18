import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Rng, sha256Hex } from '../src/index.ts';

const ref = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 examples', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('equals node:crypto on 1,000 random inputs, the empty input and a 1 MiB input', () => {
    const rng = new Rng(0x5a256);
    for (let i = 0; i < 1000; i++) {
      const len = i < 200 ? i : rng.nextU32() % 4097; // covers every padding boundary 0..199
      const b = new Uint8Array(len);
      for (let j = 0; j < len; j++) b[j] = rng.nextU32() & 0xff;
      expect(sha256Hex(b), `case ${i} (${len} bytes)`).toBe(ref(b));
    }
    expect(sha256Hex(new Uint8Array(0))).toBe(ref(new Uint8Array(0)));
    const mib = new Uint8Array(1024 * 1024);
    for (let j = 0; j < mib.length; j++) mib[j] = (rng.nextU32() >>> 8) & 0xff;
    expect(sha256Hex(mib)).toBe(ref(mib));
  });

  it('hashes strings as UTF-8', () => {
    for (const s of ['café', '\u{1f309} Tha Bay', 'x'.repeat(1000)]) expect(sha256Hex(s)).toBe(ref(s));
  });
});
