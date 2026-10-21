import { describe, expect, it } from 'vitest';
import { isMediaKey } from '../src/assets/media-key.ts';

const H64 = 'a'.repeat(64);
const H12 = '0123456789ab';

describe('isMediaKey', () => {
  it('accepts one key of each of the six shapes', () => {
    for (const k of [
      `assets/vehicle/sedan-01/q2.${H12}.glb`,
      `characters/dee/head/default.${H12}.ktx2`,
      `audio/barks/${H64}.opus`,
      `cutscenes/${H64}/manifest.json`,
      `cutscenes/${H64}/subs.en.vtt`,
      `manifests/assets-${H64}.json`,
      `odbl/${H64}/index.json`,
      `odbl/${H64}/bake-scripts.tar.gz`,
    ]) expect(isMediaKey(k), k).toBe(true);
  });

  it('rejects traversal, encodings, empty segments, uppercase hashes and wrong shapes', () => {
    for (const k of [
      '',
      '..',
      '.',
      `assets/../x/y/q2.${H12}.glb`,
      `assets/./x/y.${H12}.glb`,
      `assets//x/q2.${H12}.glb`,
      `assets/vehicle/%2Fx/q2.${H12}.glb`,
      `assets/vehicle/%2e%2e/q2.${H12}.glb`,
      `assets\\vehicle\\x\\q2.${H12}.glb`,
      `assets/vehicle/x/q2.${H12}.glb/`,
      `cutscenes/${'A'.repeat(64)}/manifest.json`,
      `cutscenes/${H64}/../manifest.json`,
      `cutscenes/${H64}/manifest.json/extra`,
      `cutscenes/${H64}`,
      `private/x/y/q2.${H12}.glb`,
      `assets/vehicle/q2.${H12}.glb`,
      `assets/a/b/c/q2.${H12}.glb`,
      `assets/vehicle/x/q2.${H12.toUpperCase()}.glb`,
      `manifests/assets-${'F'.repeat(64)}.json`,
      `audio/barks/${H64.slice(1)}.opus`,
      `audio/other/${H64}.opus`,
    ]) expect(isMediaKey(k), k).toBe(false);
  });
});
