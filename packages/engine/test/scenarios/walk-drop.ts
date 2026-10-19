// The scenario lives in src/sim/scenarios because the live page and the QA determinism page run it too; tests import it from here.
export * from '../../src/sim/scenarios/walk-drop.ts';
// The seeded bot script is QA-only code and is imported from its own file, never from the sim bundle.
export { walkDropBot, walkDropBotScript } from '../../src/sim/scenarios/walk-drop-bot.ts';
