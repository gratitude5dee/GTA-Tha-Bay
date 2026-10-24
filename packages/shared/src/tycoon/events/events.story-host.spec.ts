/** AC-5: the ten both-scope events run on a story-business host over 1,000 seeded business-years with no state leak, and replay identically. */
import { describe, expect, it } from 'vitest';
import { newBusiness, storyBusinessHost, UNMAPPED, type BusinessState, type Ignored } from '../../../../../tests/tycoon/fixtures/story-business.host.ts';
import { autoResolve, roll, tickEffects } from '../../events/engine.ts';
import { sha256Hex } from '../../hash.ts';
import { EVENT_FILES, LOCALE } from '../__fixtures__/content.ts';
import { BOTH_SCOPE_IDS, loadCatalog, withScope } from './catalog.ts';

const defs = withScope(loadCatalog(EVENT_FILES, LOCALE), 'business');
const YEARS = 1000;
const WEEKS = 52;
const KEYS = ['seed', 'week', 'till', 'footfall', 'reputation', 'staffMorale', 'staff', 'shopClosed', 'ticketMul', 'costMul', 'outputMul', 'flags', 'until', 'ev'];

interface Run {
  trace: string;
  fired: Record<string, number>;
  ignored: Ignored;
  closedWeeks: number;
  closedWithoutFlag: number;
  extraKeys: string[];
  weeks: number;
}

function simulate(): Run {
  const ignored: Ignored = { stock: 0, round: 0, flagsOther: 0 };
  const host = storyBusinessHost(ignored);
  const fired: Record<string, number> = {};
  let trace = '';
  let closedWeeks = 0;
  let closedWithoutFlag = 0;
  let extraKeys: string[] = [];
  let weeks = 0;
  for (let y = 0; y < YEARS; y++) {
    const s: BusinessState = newBusiness((y + 1) * 7919);
    for (let w = 0; w < WEEKS; w++) {
      s.week = w;
      autoResolve(s, s.ev, defs, host);
      for (const i of roll(s, s.ev, defs, host)) fired[i.defId] = (fired[i.defId] ?? 0) + 1;
      tickEffects(s, s.ev, host);
      if (s.shopClosed) {
        closedWeeks++;
        if (s.flags['officeClosed'] !== true && s.flags['officeClosed'] !== 1) closedWithoutFlag++;
      }
      weeks++;
      trace += `${y}.${w}:${s.till},${s.footfall.toFixed(2)},${s.reputation.toFixed(2)},${s.staffMorale.toFixed(2)},${s.staff},${s.shopClosed ? 1 : 0};`;
    }
    extraKeys = Object.keys(s).filter((k) => !KEYS.includes(k));
  }
  return { trace: sha256Hex(trace), fired, ignored, closedWeeks, closedWithoutFlag, extraKeys, weeks };
}

describe('story-business host (events proof, section 7)', () => {
  const a = simulate();

  it('runs 1,000 business-years of the ten both-scope events', () => {
    expect(defs.map((d) => d.id).sort()).toEqual([...BOTH_SCOPE_IDS].sort());
    expect(a.weeks).toBe(YEARS * WEEKS);
    for (const id of BOTH_SCOPE_IDS) expect(a.fired[id] ?? 0, id).toBeGreaterThan(0);
  });

  it('metrics the business does not model are no-ops: the state gains no field and the host drops them', () => {
    expect(a.extraKeys).toEqual([]);
    expect(a.ignored.stock).toBeGreaterThan(0); // hype +1 from the fog was tried and dropped
    expect(UNMAPPED).toContain('hype');
  });

  it('officeClosed maps to "shop closed" and only while the flag is set', () => {
    expect(a.closedWeeks).toBeGreaterThan(100);
    expect(a.closedWithoutFlag).toBe(0);
  });

  it('two executions give identical traces', () => {
    const b = simulate();
    expect(b.trace).toBe(a.trace);
    expect(b.fired).toEqual(a.fired);
  });
});
