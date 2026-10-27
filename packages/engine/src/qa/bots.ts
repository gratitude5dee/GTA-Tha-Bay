/**
 * The `BotDriver` registry (M04d; 13-qa.md 3.2). QA builds and Node only: a bot reads what the host observes and acts only
 * through `BotInput`, so a bot run goes through the real input path. Mode owners register their drivers in their own milestones
 * (`story.autoplayer`, `racing.line`, `fighter.cpu`, `tycoon.<policy>`); this milestone ships `lines`.
 */
import type { BotInput, InputFrame } from '@dv/shared';

export interface BotContext {
  /** What the host exposes to a bot: the tick and the scenario's own facts. Read only. */
  observe(): Readonly<Record<string, unknown>>;
  /** The seeded stream of the run, `[0, 1)`. Only the `bot` stream exists. */
  rng(stream: 'bot'): () => number;
}

export interface BotDriver extends BotInput {
  readonly id: string;
  init(ctx: BotContext, params?: Record<string, unknown>): void;
  frame(tick: number): InputFrame;
  done(): { done: boolean; outcome?: string };
}

export type BotFactory = () => BotDriver;

const registry = new Map<string, BotFactory>();

/** Registers a driver by id. A second registration of the same id throws. */
export function registerBot(id: string, factory: BotFactory): void {
  if (registry.has(id)) throw new Error(`registerBot: bot driver '${id}' is already registered`);
  registry.set(id, factory);
}

/** A fresh driver for `id`. An unknown id throws with the registered ids. */
export function getBot(id: string): BotDriver {
  const f = registry.get(id);
  if (!f) throw new Error(`BotDriver registry: unknown bot driver '${id}'; registered: ${registeredBots().join(', ') || '(none)'}`);
  return f();
}

export function registeredBots(): string[] {
  return [...registry.keys()].sort();
}

/** Test support: removes a driver (the registry has no other way to forget one). */
export function unregisterBot(id: string): void {
  registry.delete(id);
}

/**
 * Child-mode bots (M07a2): the bot that plays a mode the story started as a child (`ModeContext.startChild`) while the story
 * autoplayer is on the controls. A mode registers one factory for its id (QA entries only); the autoplayer asks for it when a mission
 * hook runs the real mode (`hooks: 'bot'`), hands it the hook's `defId`, and uses its frames for as long as the child runs. The child
 * bot reads its own mode's state (it is given no observation by the story), so the story package imports nothing of the mode.
 */
export type ChildBotFactory = (defId: string | null) => BotDriver;

const childRegistry = new Map<string, ChildBotFactory>();

/** Registers the child bot of a mode id; a second registration of the same id is ignored (QA entry points call this once per process). */
export function registerChildBot(modeId: string, factory: ChildBotFactory): void {
  if (!childRegistry.has(modeId)) childRegistry.set(modeId, factory);
}

/** The child bot of a mode, or null when the mode registered none. */
export function getChildBot(modeId: string, defId: string | null): BotDriver | null {
  const f = childRegistry.get(modeId);
  return f ? f(defId) : null;
}
