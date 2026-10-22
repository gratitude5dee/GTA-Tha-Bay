/** Loudness of a time-domain buffer (04-npc.md section 5.7, t1 lip-sync): the root mean square of samples in -1..1. */
export function rms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] as number;
    sum += x * x;
  }
  const mean = sum / n;
  return Number.isFinite(mean) ? Math.sqrt(mean) : 0;
}

/** The part of `AnalyserNode` the envelope reader uses (structural, so tests pass a fake). */
export interface AnalyserLike {
  readonly fftSize: number;
  getFloatTimeDomainData(buffer: Float32Array<ArrayBuffer>): void;
}

/** A function that reads the current RMS of an analyser, reusing one scratch buffer. */
export function envelopeReader(analyser: AnalyserLike): () => number {
  const scratch = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(scratch);
    return rms(scratch);
  };
}
