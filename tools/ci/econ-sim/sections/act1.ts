/**
 * Section `act1` (M05c1): the first half of Act 1, missions m.a1.01 to m.a1.06, one mission per game week. Income is read from the
 * compiled missions (`assets/src/data/mission.<id>/mission.json`, what `pnpm missions:build` wrote): each mission's `rewards.cashCents`
 * in the week it is passed, plus the $1,000 `give` of the m.a1.05 win when the draw says the player won (a coin flip). Sinks are the
 * policies' weekly share of the balance, which is what a shop spend is at this level (the shop table itself is proven in
 * `packages/modes/story/test/shops.test.ts`).
 *
 * The exact probes pin the numbers the spec states: 870,000 cents without the win, 970,000 with it, Street Cred 90, Tech Clout 30, a
 * mission reward credited once across a retry (the key `mis:<id>:reward`), and no policy ever below zero.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../../lib/common.ts';
import { Ledger, type ModelDeps } from '../model.ts';
import { POLICIES, weeklySpend } from '../policies.ts';
import type { EconSection } from './base.ts';

interface MissionRewards {
  id: string;
  cashCents: number;
  streetCred: number;
  techClout: number;
  /** Cents of `give` ops in the mission, by idempotency key. */
  gives: Record<string, number>;
}

const DATA = path.join(toolsRoot, 'assets', 'src', 'data');
const ACT1 = ['m.a1.01', 'm.a1.02', 'm.a1.03', 'm.a1.04', 'm.a1.05', 'm.a1.06'] as const;

function collectGives(node: unknown, into: Record<string, number>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectGives(n, into);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o['op'] === 'give' && typeof o['idem'] === 'string' && typeof o['cashCents'] === 'number') into[o['idem']] = o['cashCents'];
    for (const v of Object.values(o)) collectGives(v, into);
  }
}

let cache: MissionRewards[] | null = null;
export function act1Rewards(): MissionRewards[] {
  if (cache) return cache;
  const dirs = new Set(readdirSync(DATA));
  cache = ACT1.map((id) => {
    const dir = `mission.${id}`;
    if (!dirs.has(dir)) throw new Error(`econ act1: ${dir} is not in assets/src/data (run pnpm missions:build)`);
    const ir = JSON.parse(readFileSync(path.join(DATA, dir, 'mission.json'), 'utf8')) as { rewards?: { cashCents?: number; streetCred?: number; techClout?: number }; stages?: unknown };
    const gives: Record<string, number> = {};
    collectGives(ir.stages, gives);
    return { id, cashCents: ir.rewards?.cashCents ?? 0, streetCred: ir.rewards?.streetCred ?? 0, techClout: ir.rewards?.techClout ?? 0, gives };
  });
  return cache;
}

const winBonus = (): number => Object.values(act1Rewards().find((m) => m.id === 'm.a1.05')?.gives ?? {}).reduce((a, b) => a + b, 0);

export const ACT1_SECTION: EconSection = {
  id: 'act1',
  weeks: ACT1.length,
  // week n pays mission n; the m.a1.05 week adds its win bonus on half of the draws
  grossDividend: (u, _v, week = 1) => {
    const m = act1Rewards()[week - 1];
    if (!m) return 0;
    return m.cashCents + (m.id === 'm.a1.05' && u < 0.5 ? winBonus() : 0);
  },
  probes: {
    missionCashCents: () => act1Rewards().reduce((s, m) => s + m.cashCents, 0),
    missionCashCentsWithWin: () => act1Rewards().reduce((s, m) => s + m.cashCents, 0) + winBonus(),
    streetCred: () => act1Rewards().reduce((s, m) => s + m.streetCred, 0),
    techClout: () => act1Rewards().reduce((s, m) => s + m.techClout, 0),
    // the first mission passed twice (a retry after the pass) credits its reward once
    retryCreditOnce: (deps: ModelDeps) => {
      const l = new Ledger(deps);
      const first = act1Rewards()[0]?.cashCents ?? 0;
      l.credit('mis:m.a1.01:reward', first);
      l.credit('mis:m.a1.01:reward', first);
      return l.balance;
    },
    // no policy goes below zero over the six weeks, whatever the draws
    lowestBalance: (deps: ModelDeps) => {
      let lowest = 0;
      for (const p of POLICIES) {
        const l = new Ledger(deps);
        for (let week = 1; week <= ACT1.length; week++) {
          l.credit(`pay:${week}`, act1Rewards()[week - 1]?.cashCents ?? 0);
          const spend = weeklySpend(p, l.balance);
          if (spend > 0) l.debit(`sink:${week}`, spend);
          lowest = Math.min(lowest, l.balance);
        }
      }
      return lowest;
    },
  },
};
