/**
 * Prewarm cost estimate (spec/domains/03-story-cutscenes.md section D9.1).
 *
 *   estimate = round(seconds x provider micros per second x 1.5) + (recipe K only) round(shots x 1.5 x 39,600)
 *
 * Every figure is an integer count of USD micros. The 1.5 is the retake allowance of section D8; recipe K keyframes are Sunburst
 * stills at 1920x1080 high ($0.0396, 05-assets.md section 4.5); recipe R (reference to video) carries no keyframe.
 * Pure: no IO, no clock.
 */
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { VideoProviderEntry } from '../../../packages/shared/src/genai/registry.ts';

/** Sunburst 1920x1080 high, USD micros per keyframe. */
export const KEYFRAME_MICROS = 39_600;
/** Retake allowance applied to video seconds and keyframes. */
export const RETAKE_FACTOR = 1.5;
/** The M05c3 line inside the USD 100 fal programme (DN-S13-02, DL-209): USD 16. */
export const DEFAULT_CAP_MICROS = 16_000_000;

export type Recipe = 'K' | 'R';

export interface Estimate {
  recipe: Recipe;
  seconds: number;
  shots: number;
  videoMicros: number;
  keyframeMicros: number;
  totalMicros: number;
}

/** Recipe R keys name a `reference-to-video` endpoint; every other video endpoint is recipe K (image to video with keyframes). */
export function recipeOf(request: Pick<CutsceneRequest, 'keyInput'>): Recipe {
  return request.keyInput.endpoint.includes('reference-to-video') ? 'R' : 'K';
}

/** USD per second of a registry price row as integer micros. */
export function microsPerSecond(provider: Pick<VideoProviderEntry, 'price'>): number {
  return Math.round(provider.price.usdPerS * 1_000_000);
}

export function estimateRequest(request: Pick<CutsceneRequest, 'shots' | 'keyInput'>, provider: Pick<VideoProviderEntry, 'price'>): Estimate {
  const recipe = recipeOf(request);
  const shots = request.shots.length;
  const seconds = request.shots.reduce((n, s) => n + s.durationS, 0);
  const videoMicros = Math.round(seconds * microsPerSecond(provider) * RETAKE_FACTOR);
  const keyframeMicros = recipe === 'K' ? Math.round(shots * RETAKE_FACTOR * KEYFRAME_MICROS) : 0;
  return { recipe, seconds, shots, videoMicros, keyframeMicros, totalMicros: videoMicros + keyframeMicros };
}

/** `$10.01` from 10,011,600 micros (rounded to the cent for display only). */
export function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}
