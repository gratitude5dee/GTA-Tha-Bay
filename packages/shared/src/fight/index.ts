// packages/shared/src/fight/index.ts — the Culture Wars fight core (M08a1): pure, deterministic, no renderer or engine.
export * from './types.ts';
export * from './input.ts';
export * from './buffer.ts';
export * from './states.ts';
export * from './pack.ts';
export * from './motion.ts';
export { FightCore, createFightSim } from './step.ts';
export { hashBuffer, hashHex, rngNext, rngSeed } from './hash.ts';
export { decodeInputs, decodeReplay, encodeInputs, encodeReplay, recordReplay, verifyReplay } from './replay.ts';
export type { DvFightReplay, VerifyResult } from './replay.ts';
export { capsulesOverlap, segDistSq } from './hit.ts';
export * from './fame.ts';
export { MODE_FIGHT, MODE_NONE, MODE_REACT } from './rounds.ts';
