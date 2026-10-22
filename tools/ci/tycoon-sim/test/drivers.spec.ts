/** The four policies are registered as BotDrivers `tycoon.<policy>` and play the same run as the harness does. */
import { describe, expect, it } from 'vitest';
import { getBot, registeredBots, type BotContext } from '../../../../packages/engine/src/qa/bots.ts';
import { createTycoonBotDriver, registerTycoonBots, tycoonDriverId, type TycoonBotDriver } from '../drivers.ts';
import { CtrRng, POLICY_IDS, type Policy } from '../policies.ts';
import { buildPolicies, loadContent, runSeed, seedOf } from '../run.ts';

describe('tycoon bot drivers', () => {
  it('registers tycoon.median, tycoon.aggressive, tycoon.frugal and tycoon.random once', () => {
    const ids = registerTycoonBots();
    expect(ids).toEqual(['tycoon.median', 'tycoon.aggressive', 'tycoon.frugal', 'tycoon.random']);
    expect(registerTycoonBots()).toEqual(ids); // a second call is a no-op, not a throw
    for (const p of POLICY_IDS) expect(registeredBots()).toContain(tycoonDriverId(p));
  });

  it('a driver from the registry plays a run to the same hash as the harness policy', () => {
    registerTycoonBots();
    const content = loadContent();
    const set = buildPolicies(content);
    const seed = seedOf(1, 3);
    const direct = runSeed(content, set.policies['median']!.policy, seed, 3);

    const driver = getBot('tycoon.median') as TycoonBotDriver;
    const draws = new CtrRng(seed, 'bot:median');
    const ctx: BotContext = { observe: () => ({}), rng: () => () => draws.next() };
    driver.init(ctx);
    const viaDriver: Policy = { id: 'median', decide: (view) => driver.decide(view) };
    const again = runSeed(content, viaDriver, seed, 3);
    expect(again.hash).toBe(direct.hash);
    expect(again.kind).toBe(direct.kind);
    expect(driver.done()).toEqual({ done: false }); // no view seen by the driver after the end is not reported as done
    expect(driver.frame(5).buttons).toBe(0);
  });

  it('done() reports the end once the driver has seen an ended company; an unknown policy fails at init', () => {
    const d = createTycoonBotDriver('median');
    const ctx: BotContext = { observe: () => ({}), rng: () => () => 0.5 };
    d.init(ctx);
    expect(d.done().done).toBe(false);
    const content = loadContent();
    const set = buildPolicies(content);
    expect(set.policies['median']).toBeDefined();
    expect(() => createTycoonBotDriver('nope').init(ctx)).toThrow(/unknown policy/);
  });
});
