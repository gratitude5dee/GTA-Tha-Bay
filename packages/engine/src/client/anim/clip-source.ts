/**
 * Where a character's clips come from (M10d4, 05-assets-pipeline.md section 4): the baked `anim/<slug>.moves` file when the asset exists,
 * else the placeholder clips built in code. The choice is per state, so a file that lacks a state (the Universal Animation Library lists
 * no walk or idle explicitly, BD-M10d4-06) still plays the placeholder clip for it. Pure: no loader, no network.
 */
import type { AnimationClip } from 'three';
import type { PlaceholderClip } from './graph.ts';

export interface ClipSource {
  /** One clip per requested state. */
  clips: Map<PlaceholderClip, AnimationClip>;
  /** `file` when every state came from the file, `placeholder` when none did, `mixed` otherwise. */
  source: 'file' | 'placeholder' | 'mixed';
  /** The states the file supplied. */
  fromFile: PlaceholderClip[];
}

/**
 * @param placeholders the code-built clips (`buildPlaceholderClips()`); every requested state must be in it
 * @param file         the clips of the baked file by clip name (= state name), or null when the asset is absent
 */
export function pickClips(
  placeholders: ReadonlyMap<PlaceholderClip, AnimationClip>,
  file: ReadonlyMap<string, AnimationClip> | null,
  states: readonly PlaceholderClip[] = [...placeholders.keys()],
): ClipSource {
  const clips = new Map<PlaceholderClip, AnimationClip>();
  const fromFile: PlaceholderClip[] = [];
  for (const state of states) {
    const baked = file?.get(state);
    if (baked !== undefined) {
      clips.set(state, baked);
      fromFile.push(state);
      continue;
    }
    const fallback = placeholders.get(state);
    if (fallback === undefined) throw new Error(`clip-source: no placeholder clip for state "${state}"`);
    clips.set(state, fallback);
  }
  const source = fromFile.length === 0 ? 'placeholder' : fromFile.length === states.length ? 'file' : 'mixed';
  return { clips, source, fromFile };
}
