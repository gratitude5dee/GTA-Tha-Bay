/** pickClips: file clips where the baked asset has them, placeholder clips elsewhere (M10d4). */
import { AnimationClip } from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlaceholderClips } from '../src/client/anim/placeholder-rig.ts';
import { pickClips } from '../src/client/anim/clip-source.ts';

describe('pickClips', () => {
  const placeholders = buildPlaceholderClips();
  it('uses the placeholders when the asset is absent', () => {
    const r = pickClips(placeholders, null, ['idle', 'walk']);
    expect(r.source).toBe('placeholder');
    expect(r.fromFile).toEqual([]);
    expect(r.clips.get('walk')).toBe(placeholders.get('walk'));
  });
  it('takes a state from the file and keeps the placeholder for a state the file lacks', () => {
    const walk = new AnimationClip('walk', 1, []);
    const r = pickClips(placeholders, new Map([['walk', walk]]), ['idle', 'walk']);
    expect(r.source).toBe('mixed');
    expect(r.fromFile).toEqual(['walk']);
    expect(r.clips.get('walk')).toBe(walk);
    expect(r.clips.get('idle')).toBe(placeholders.get('idle'));
  });
  it('reports file when every state came from it, and ignores clips for states nobody asked for', () => {
    const file = new Map([['idle', new AnimationClip('idle', 1, [])], ['walk', new AnimationClip('walk', 1, [])], ['dance', new AnimationClip('dance', 1, [])]]);
    const r = pickClips(placeholders, file, ['idle', 'walk']);
    expect(r.source).toBe('file');
    expect([...r.clips.keys()]).toEqual(['idle', 'walk']);
  });
  it('throws for a state without a placeholder', () => {
    expect(() => pickClips(placeholders, null, ['nope' as never])).toThrow(/no placeholder clip/);
  });
});
