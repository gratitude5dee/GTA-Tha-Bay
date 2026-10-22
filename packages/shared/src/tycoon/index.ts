/**
 * `@dv/shared/tycoon`: the pure, seeded weekly company simulation of Business Tycoon (M09a1). No IO, no DOM. Content is read by the
 * caller and handed to `buildContent`. Finance (cap table, SAFE, rounds, waterfall, envelope) is in `./finance`.
 */
export * from './types.ts';
export { ContentError, buildContent, hashVersion } from './content.ts';
export type { RawTycoonContent } from './content.ts';
export { ctrFloat, ctrNormal } from './rand.ts';
export { setupFromSeed, newRun } from './setup.ts';
export { stepWeek } from './step.ts';
export { applyCommand, envelopeCompany } from './commands.ts';
export { ReplayError, hashCompany, policyView, replay, verifyRun } from './replay.ts';
export type { PolicyView, ReplayOutcome } from './replay.ts';
export { devPower, headcount, mrrGrowth13, netBurnWeek, runwayWeeks, valuationRef } from './company.ts';
export { finishRun, founderPayout, scoreOf } from './end.ts';
export * as finance from './finance/index.ts';
export { createTycoonHost, hostFor } from './events/host.ts';
export { BOTH_SCOPE_IDS, CatalogError, loadCatalog, withScope } from './events/catalog.ts';
