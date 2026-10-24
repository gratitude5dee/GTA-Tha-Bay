/**
 * M05c3 AC-1, AC-3, AC-4, AC-7: the prewarm gates, the plan and the live path over fake ports (no network, no fal).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { main } from '../gen/cli.ts';
import { NO_PROVIDER_LINE, parseSheetsLock, providerGate } from '../gen/gates.ts';
import { DEFAULT_CAP_MICROS } from '../gen/estimate.ts';
import { runPrewarm, type LedgerPort, type PrewarmOptions, type PrewarmPorts, type WorkerPort } from '../gen/prewarm.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';

const fx = (f: string): string => path.join(import.meta.dirname, 'fixtures', f);
const requests = (JSON.parse(readFileSync(fx('act1-requests.json'), 'utf8')) as { requests: CutsceneRequest[] }).requests.filter((r) => /^cut\.story\.m\.a1\./.test(r.ref));
const keyOf = (ref: string): string => requests.find((r) => r.ref === ref)!.key;

const base: PrewarmOptions = {
  release: 'fixture-act1', priority: 1, capMicros: DEFAULT_CAP_MICROS, live: false, env: 'staging', report: false, offline: false,
  requestsFile: fx('act1-requests.json'), registryFile: fx('registry-cleared.json'), sheetsFile: fx('sheets-lock.json'),
};

interface Harness {
  ports: PrewarmPorts;
  logs: string[];
  files: Map<string, string>;
  submitted: string[][];
  polls: string[];
  rebuilds: string[];
  fetchCalls: number;
}

function harness(o: { ready?: readonly string[]; worker?: boolean; ledger?: { cap: number; spent: number } | null; resign?: boolean | null; finalState?: CutsceneStatus['state'] } = {}): Harness {
  const h: Harness = { ports: undefined as unknown as PrewarmPorts, logs: [], files: new Map(), submitted: [], polls: [], rebuilds: [], fetchCalls: 0 };
  const ready = new Set(o.ready ?? []);
  const state = new Map<string, CutsceneStatus['state']>();
  const worker: WorkerPort = {
    prewarm: (keys) => {
      h.submitted.push(keys);
      for (const k of keys) state.set(k, 'pending');
      return Promise.resolve(keys.map((key) => ({ key, state: 'pending' as const })));
    },
    status: (key) => {
      h.polls.push(key);
      const done = o.finalState ?? 'ready';
      state.set(key, done);
      if (done === 'ready') ready.add(key);
      return Promise.resolve({ key, state: done });
    },
  };
  const ledger: LedgerPort | null =
    o.ledger === null ? null : { capMicros: () => Promise.resolve((o.ledger ?? { cap: 100_000_000 }).cap), spentMicros: (_v, f) => Promise.resolve(f?.kind === 'cutscene' ? 9_000_000 : (o.ledger ?? { spent: 0 }).spent) };
  let t = 1_000;
  h.ports = {
    log: (l) => h.logs.push(l),
    readText: (f) => {
      if (h.files.has(f)) return h.files.get(f)!;
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return null;
      }
    },
    writeText: (f, text) => void h.files.set(f, text),
    isReady: (k) => Promise.resolve(ready.has(k)),
    ledger,
    resign: { resignOn: () => Promise.resolve(o.resign === undefined ? true : o.resign) },
    worker: o.worker === false ? null : worker,
    rebuildIndex: (r) => Promise.resolve(void h.rebuilds.push(r)).then(() => 0),
    sleep: () => Promise.resolve(void (t += 15_000)),
    now: () => t,
    defaults: { requests: (r) => `.private/releases/${r}/cutscene-requests.json`, registry: 'config/genai-endpoints.json', sheets: '.private/sheets.lock.json', reportFile: (r) => `docs/releases/${r}/cutscenes.md` },
  };
  return h;
}

describe('provider gate (AC-1)', () => {
  it('no cleared provider: blocked line, 0 fetch calls, exit 0, also with --live', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('the prewarm must not touch the network without a cleared provider')));
    const logs: string[] = [];
    const code = await main(
      ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-none.json'), '--live'],
      { OPS_TOKEN: 'staff-token-for-test' },
      fetchSpy as unknown as typeof fetch,
      (l) => logs.push(l),
    );
    expect(code).toBe(0);
    expect(logs).toContain(NO_PROVIDER_LINE);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('a pending or blocked provider never passes; a cleared default does', () => {
    const none = JSON.parse(readFileSync(fx('registry-none.json'), 'utf8')) as GenAiRegistry;
    const cleared = JSON.parse(readFileSync(fx('registry-cleared.json'), 'utf8')) as GenAiRegistry;
    expect(providerGate(none)).toEqual({ ok: false, line: NO_PROVIDER_LINE });
    const g = providerGate(cleared);
    expect(g.ok && g.key).toBe('h3.partner');
    // a cleared provider that is not the default is still found through the fallback order
    const swapped: GenAiRegistry = JSON.parse(JSON.stringify(cleared)) as GenAiRegistry;
    swapped.videoProviders['h3.partner']!.licence.status = 'pending';
    swapped.videoProviders['ltx25.fast']!.licence.status = 'cleared';
    const f = providerGate(swapped);
    expect(f.ok && f.key).toBe('ltx25.fast');
    // blocked is delisted even when it is the only one
    swapped.videoProviders['ltx25.fast']!.licence.status = 'blocked';
    expect(providerGate(swapped).ok).toBe(false);
  });

  it('with --report and no cleared provider, the report lists all nine refs as in-engine', async () => {
    const h = harness();
    const r = await runPrewarm({ ...base, registryFile: fx('registry-none.json'), report: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.logs[0]).toBe(NO_PROVIDER_LINE);
    const md = h.files.get('docs/releases/fixture-act1/cutscenes.md')!;
    expect(md).toContain('Generated clips: 0 of 9');
    expect(md.match(/\| in-engine \|/g)).toHaveLength(9);
  });
});

describe('sheet gate and cache check (AC-3)', () => {
  it('missing sheets are sheet_missing at $0, the ready key is ready at $0, the rest is planned', async () => {
    const readyKey = keyOf('cut.story.m.a1.03.raid');
    const h = harness({ ready: [readyKey] });
    const r = await runPrewarm(base, h.ports);
    expect(r.code).toBe(0);
    const by = Object.fromEntries(r.plan!.rows.map((x) => [x.ref, x]));
    // corwin_hale and dana_voss have no approved crops in the fixture lock
    expect(by['cut.story.m.a1.04.keynote']).toMatchObject({ status: 'sheet_missing', estimateMicros: 0 });
    expect(by['cut.story.m.a1.12.lot-one']).toMatchObject({ status: 'sheet_missing', estimateMicros: 0 });
    expect(by['cut.story.m.a1.03.raid']).toMatchObject({ status: 'ready', estimateMicros: 0 });
    for (const ref of ['cut.story.m.a1.01.dawn', 'cut.story.m.a1.05.ring', 'cut.story.m.a1.06.antenna', 'cut.story.m.a1.08.scanner', 'cut.story.m.a1.10.steps', 'cut.story.m.a1.12.arrival']) {
      expect(by[ref]!.status).toBe('planned');
    }
    // 4 one-shot refs and 2 two-shot refs
    expect(r.plan!.totalMicros).toBe(4 * 779_400 + 2 * 1_378_800);
  });

  it('a ready key is never re-planned even when its sheet is missing', async () => {
    const h = harness({ ready: [keyOf('cut.story.m.a1.04.keynote')] });
    const r = await runPrewarm(base, h.ports);
    expect(r.plan!.rows.find((x) => x.ref === 'cut.story.m.a1.04.keynote')!.status).toBe('ready');
  });

  it('parseSheetsLock rejects a file with the wrong schema', () => {
    expect(() => parseSheetsLock('{"schema":"x","sheets":{}}')).toThrow(/sheets-lock\/1/);
    expect(parseSheetsLock(readFileSync(fx('sheets-lock.json'), 'utf8')).sheets['tavi_okafor']!.approved).toBe(true);
  });
});

describe('offline plan (AC-4)', () => {
  it('prints the plan table with a total under the line and makes no network call', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    const logs: string[] = [];
    const code = await main(
      ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-cleared.json'), '--offline'],
      {},
      fetchSpy as unknown as typeof fetch,
      (l) => logs.push(l),
    );
    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    const table = logs.filter((l) => l.startsWith('cut.story.m.a1.'));
    expect(table).toHaveLength(9);
    const total = Number(/total planned: (\d+) micros/.exec(logs.join('\n'))![1]);
    expect(total).toBeLessThanOrEqual(16_000_000);
  });

  it('--offline with --live is refused before anything else', async () => {
    const h = harness();
    const r = await runPrewarm({ ...base, offline: true, live: true }, h.ports);
    expect(r.code).toBe(1);
    expect(h.logs[0]).toMatch(/--offline cannot be combined with --live/);
    expect(h.submitted).toHaveLength(0);
  });

  it('the other subcommands are pending', async () => {
    for (const sub of ['plan', 'run', 'gate']) {
      const logs: string[] = [];
      expect(await main([sub], {}, fetch, (l) => logs.push(l))).toBe(0);
      expect(logs).toEqual(['pending: lands in M10a1']);
    }
  });
});

describe('C2PA guard (AC-7)', () => {
  it('prod --live refuses before any submission when the Worker build has C2PA_RESIGN off', async () => {
    for (const resign of [false, null]) {
      const h = harness({ resign, ledger: { cap: 100_000_000, spent: 0 } });
      const r = await runPrewarm({ ...base, env: 'prod', live: true }, h.ports);
      expect(r.code).toBe(1);
      expect(h.logs.join('\n')).toMatch(/refused: C2PA_RESIGN is (off|not set) in the prod Worker build/);
      expect(h.submitted).toHaveLength(0);
      expect(h.polls).toHaveLength(0);
    }
  });

  it('staging --live is not guarded by it', async () => {
    const h = harness({ resign: false, ledger: { cap: 100_000_000, spent: 0 } });
    const r = await runPrewarm({ ...base, env: 'staging', live: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.submitted.length).toBeGreaterThan(0);
  });
});

describe('live path over fake ports', () => {
  it('submits only the planned keys, polls to ready, rebuilds the index and writes the report', async () => {
    const h = harness({ ledger: { cap: 100_000_000, spent: 40_000_000 } });
    const r = await runPrewarm({ ...base, env: 'prod', live: true, report: true }, h.ports);
    expect(r.code).toBe(0);
    const planned = r.plan!.rows.filter((x) => x.status === 'planned').map((x) => x.key);
    expect(planned).toHaveLength(7);
    expect(h.submitted).toEqual([planned]);
    expect(h.polls.length).toBeGreaterThanOrEqual(planned.length);
    expect(h.rebuilds).toEqual(['fixture-act1']);
    const md = h.files.get('docs/releases/fixture-act1/cutscenes.md')!;
    expect(md).toContain('Generated clips: 7 of 9');
    expect(md).toContain('sheet missing: corwin_hale');
    expect(md).toContain('Ledger delta of the last live run (kind cutscene): 9000000 micros');
  });

  it('a second run finds every key ready and submits nothing', async () => {
    const all = requests.filter((r) => r.characters.every((c) => !['corwin_hale', 'dana_voss'].includes(c.id))).map((r) => r.key);
    const h = harness({ ready: all, ledger: { cap: 100_000_000, spent: 0 } });
    const r = await runPrewarm({ ...base, live: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.submitted).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('nothing to submit');
  });

  it('a failed key makes the run exit 1 and the report lists it as in-engine', async () => {
    const h = harness({ ledger: { cap: 100_000_000, spent: 0 }, finalState: 'failed' });
    const r = await runPrewarm({ ...base, live: true, report: true }, h.ports);
    expect(r.code).toBe(1);
    expect(h.files.get('docs/releases/fixture-act1/cutscenes.md')).toContain('Generated clips: 0 of 9');
  });

  it('refuses when the plan is larger than the programme headroom', async () => {
    const h = harness({ ledger: { cap: 100_000_000, spent: 95_000_000 } });
    const r = await runPrewarm({ ...base, live: true }, h.ports);
    expect(r.code).toBe(1);
    expect(h.logs.join('\n')).toMatch(/larger than the programme headroom/);
    expect(h.submitted).toHaveLength(0);
  });

  it('refuses when the headroom cannot be read, and skips without OPS_TOKEN', async () => {
    const noLedger = harness({ ledger: null });
    expect((await runPrewarm({ ...base, live: true }, noLedger.ports)).code).toBe(1);
    expect(noLedger.submitted).toHaveLength(0);
    const noToken = harness({ worker: false, ledger: { cap: 100_000_000, spent: 0 } });
    const r = await runPrewarm({ ...base, live: true }, noToken.ports);
    expect(r.code).toBe(0);
    expect(noToken.logs.join('\n')).toContain('SKIP prewarm --live: OPS_TOKEN not set');
  });

  it('priorities other than 1 are pending until M10b', async () => {
    const h = harness();
    const r = await runPrewarm({ ...base, priority: 2 }, h.ports);
    expect(r.code).toBe(0);
    expect(h.logs[0]).toMatch(/land in M10b/);
  });
});
