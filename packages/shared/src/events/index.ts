/**
 * `@dv/shared/events`: the shared random-event engine (M09a2). Pure and deterministic; used by Business Tycoon now and by story
 * businesses later (08-tycoon-events.md section 7).
 */
export * from './types.ts';
export { ctrFloat, ctrU32 } from './rng.ts';
export { distBounds, irwinHall, sampleDist } from './dist.ts';
export { allHold, evalPredicate, inSeason } from './predicate.ts';
export { applyEffects, scheduleFollowUps, strengthAt } from './effects.ts';
export { autoResolve, choiceAllowed, choose, createEventEngine, hazardFactor, hazardP, roll, tickEffects } from './engine.ts';
export { bodyKey, choiceKey, eventKeys, titleKey, validateEvents } from './validate.ts';
export type { EventIssue, EventRule, EventValidation, ValidateOptions } from './validate.ts';
