/**
 * M05c3 AC-1, AC-3, AC-4, AC-7, AC-9: the prewarm gates, the plan and the `--live` refusals over fake ports (no network, no fal).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { main } from '../gen/cli.ts';
import { DEFAULT_CAP_MICROS } from '../gen/estimate.ts';
import { NO_PROVIDER_LINE, NO_TRANSCODER_LINE, parseSheetsLock, providerGate } from '../gen/gates.ts';
import { runPrewarm, type LedgerPort, type PrewarmOptions, type PrewarmPorts } from '../gen/prewarm.ts';

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
  /** Every network-shaped call the ports saw: `head:<key>`, `status:<key>`, `ledger`. */
  calls: string[];
}

function harness(o: { ready?: readonly string[]; pending?: readonly string[]; ledger?: { cap: number; spent: number } | null; resign?: boolean | null } = {}): Harness {
  const h: Harness = { ports: undefined as unknown as PrewarmPorts, logs: [], files: new Map(), calls: [] };
  const ready = new Set(o.ready ?? []);
  const pending = new Set(o.pending ?? []);
  const ledger: LedgerPort | null =
    o.ledger === null
      ? null
      : {
          capMicros: () => Promise.resolve(void h.calls.push('ledger')).then(() => (o.ledger ?? { cap: 100_000_000 }).cap),
          spentMicros: () => Promise.resolve((o.ledger ?? { spent: 0 }).spent),
        };
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
    isReady: (k) => {
      h.calls.push(`head:${k}`);
      return Promise.resolve(ready.has(k));
    },
    status: (key) => {
      h.calls.push(`status:${key}`);
      return Promise.resolve({ key, state: pending.has(key) ? 'pending' : 'absent' } as CutsceneStatus);
    },
    ledger,
    resign: { resignOn: () => Promise.resolve(o.resign === undefined ? true : o.resign) },
    defaults: { requests: (r) => `.private/releases/${r}/cutscene-requests.json`, registry: 'config/genai-endpoints.json', sheets: '.private/sheets.lock.json', reportFile: (r) => `docs/releases/${r}/cutscenes.md` },
  };
  return h;
}

const failFetch = (): ReturnType<typeof vi.fn> => vi.fn(() => Promise.reject(new Error('the prewarm must not touch the network here')));

describe('provider gate (AC-1)', () => {
  it('no cleared provider: blocked line, 0 fetch calls, exit 0, also with --live', async () => {
    const fetchSpy = failFetch();
    const logs: string[] = [];
    const code = await main(
      ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-none.json'), '--live'],
      { OPS_TOKEN: 'staff-token-for-test' },
      fetchSpy as unknown as typeof fetch,
      (l) => logs.push(l),
    );
    expect(code).toBe(0);
    expect(logs).toEqual([NO_PROVIDER_LINE]);
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
    expect(h.calls).toEqual([]);
    const md = h.files.get('docs/releases/fixture-act1/cutscenes.md')!;
    expect(md).toContain('Generated clips: 0 of 9');
    expect(md.match(/\| in-engine \|/g)).toHaveLength(9);
  });
});

describe('sheet gate and cache check (AC-3)', () => {
  it('missing sheets are sheet_missing at $0, the ready key is ready, the pending key is pending, the rest is planned', async () => {
    const readyKey = keyOf('cut.story.m.a1.03.raid');
    const pendingKey = keyOf('cut.story.m.a1.05.ring');
    const h = harness({ ready: [readyKey], pending: [pendingKey] });
    const r = await runPrewarm(base, h.ports);
    expect(r.code).toBe(0);
    const by = Object.fromEntries(r.plan!.rows.map((x) => [x.ref, x]));
    // corwin_hale and dana_voss have no approved crops in the fixture lock
    expect(by['cut.story.m.a1.04.keynote']).toMatchObject({ status: 'sheet_missing', estimateMicros: 0 });
    expect(by['cut.story.m.a1.12.lot-one']).toMatchObject({ status: 'sheet_missing', estimateMicros: 0 });
    expect(by['cut.story.m.a1.03.raid']).toMatchObject({ status: 'ready', estimateMicros: 0 });
    expect(by['cut.story.m.a1.05.ring']).toMatchObject({ status: 'pending', estimateMicros: 0 });
    for (const ref of ['cut.story.m.a1.01.dawn', 'cut.story.m.a1.06.antenna', 'cut.story.m.a1.08.scanner', 'cut.story.m.a1.10.steps', 'cut.story.m.a1.12.arrival']) {
      expect(by[ref]!.status).toBe('planned');
    }
    // route 27 is asked only on a miss: never for the ready key
    expect(h.calls).not.toContain(`status:${readyKey}`);
    expect(h.calls).toContain(`status:${pendingKey}`);
    const table = h.logs.filter((l) => l.startsWith('cut.story.m.a1.'));
    expect(table.find((l) => l.includes('m.a1.05.ring'))).toContain('skip: pending');
    expect(table.find((l) => l.includes('m.a1.03.raid'))).toContain('skip: ready');
    const planned = r.plan!.rows.filter((x) => x.status === 'planned');
    expect(planned).toHaveLength(5);
    expect(r.plan!.totalMicros).toBe(planned.reduce((n, x) => n + x.estimateMicros, 0));
  });

  it('a ready key is never re-planned even when its sheet is missing', async () => {
    const h = harness({ ready: [keyOf('cut.story.m.a1.04.keynote')] });
    const r = await runPrewarm(base, h.ports);
    expect(r.plan!.rows.find((x) => x.ref === 'cut.story.m.a1.04.keynote')!.status).toBe('ready');
  });

  it('the report lists a ready key as a clip and the others as in-engine with the reason', async () => {
    const h = harness({ ready: [keyOf('cut.story.m.a1.03.raid')], pending: [keyOf('cut.story.m.a1.05.ring')] });
    await runPrewarm({ ...base, report: true }, h.ports);
    const md = h.files.get('docs/releases/fixture-act1/cutscenes.md')!;
    expect(md).toContain('Generated clips: 1 of 9');
    expect(md).toContain('sheet missing: corwin_hale');
    expect(md).toMatch(/m\.a1\.05\.ring \| [0-9a-f]{12} \| in-engine \| pending/);
  });

  it('the headroom line reads the ledger when it is reachable', async () => {
    const h = harness({ ledger: { cap: 100_000_000, spent: 40_000_000 } });
    await runPrewarm(base, h.ports);
    expect(h.logs).toContain('headroom: 60000000 micros ($60.00) left in the fal programme');
    const noLedger = harness({ ledger: null });
    await runPrewarm(base, noLedger.ports);
    expect(noLedger.logs.join('\n')).toContain('headroom: unknown');
  });

  it('parseSheetsLock rejects a file with the wrong schema', () => {
    expect(() => parseSheetsLock('{"schema":"x","sheets":{}}')).toThrow(/sheets-lock\/1/);
    expect(parseSheetsLock(readFileSync(fx('sheets-lock.json'), 'utf8')).sheets['tavi_okafor']!.approved).toBe(true);
  });
});

describe('offline plan (AC-4)', () => {
  it('prints the plan table with a total under the line and makes no network call', async () => {
    const fetchSpy = failFetch();
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
    expect(logs.join('\n')).not.toContain('headroom');
  });

  it('--offline with --live is refused before anything else', async () => {
    const h = harness();
    const r = await runPrewarm({ ...base, offline: true, live: true }, h.ports);
    expect(r.code).toBe(1);
    expect(h.logs[0]).toMatch(/--offline cannot be combined with --live/);
    expect(h.calls).toEqual([]);
  });

  it('the other subcommands are pending', async () => {
    for (const sub of ['plan', 'run', 'gate']) {
      const logs: string[] = [];
      expect(await main([sub], {}, fetch, (l) => logs.push(l))).toBe(0);
      expect(logs).toEqual(['pending: lands in M10a1']);
    }
  });

  it('priorities other than 1 are pending until M10b', async () => {
    const h = harness();
    const r = await runPrewarm({ ...base, priority: 2 }, h.ports);
    expect(r.code).toBe(0);
    expect(h.logs[0]).toMatch(/land in M10b/);
  });
});

describe('C2PA guard (AC-7)', () => {
  it('prod --live refuses before any network call and before the transcoder refusal when the build has C2PA_RESIGN off', async () => {
    for (const resign of [false, null]) {
      const h = harness({ resign });
      const r = await runPrewarm({ ...base, env: 'prod', live: true }, h.ports);
      expect(r.code).toBe(1);
      expect(h.logs.join('\n')).toMatch(/refused: C2PA_RESIGN is (off|not set) in the prod Worker build/);
      expect(h.logs).not.toContain(NO_TRANSCODER_LINE);
      expect(h.calls).toEqual([]);
    }
  });

  it('through the CLI with a Worker build fixture whose production C2PA_RESIGN is "0": C2PA message, 0 fetch calls, exit 1', async () => {
    const fetchSpy = failFetch();
    const logs: string[] = [];
    const code = await main(
      ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-cleared.json'), '--sheets', fx('sheets-lock.json'), '--env', 'prod', '--live', '--wrangler', fx('wrangler-resign-off.jsonc')],
      {},
      fetchSpy as unknown as typeof fetch,
      (l) => logs.push(l),
    );
    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/refused: C2PA_RESIGN is off in the prod Worker build/);
    expect(logs).not.toContain(NO_TRANSCODER_LINE);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('staging --live is not guarded by it', async () => {
    const h = harness({ resign: false });
    const r = await runPrewarm({ ...base, env: 'staging', live: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.logs).toEqual([NO_TRANSCODER_LINE]);
  });
});

describe('--live on Workers Free (AC-9)', () => {
  it.each(['staging', 'prod'] as const)('%s: cleared provider, sheets present, C2PA_RESIGN on: the transcoder refusal, 0 network calls, exit 0', async (env) => {
    const h = harness({ resign: true });
    const r = await runPrewarm({ ...base, env, live: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.logs).toEqual([NO_TRANSCODER_LINE]);
    expect(h.calls).toEqual([]);
    expect(NO_TRANSCODER_LINE).toBe('blocked: no transcoder on Workers Free; lands in M05c4');
  });

  it.each(['staging', 'prod'] as const)('%s through the CLI and the repository Worker configuration: 0 fetch calls, exit 0', async (env) => {
    const fetchSpy = failFetch();
    const logs: string[] = [];
    const code = await main(
      ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-cleared.json'), '--sheets', fx('sheets-lock.json'), '--env', env, '--live'],
      { OPS_TOKEN: 'staff-token-for-test', FAL_KEY: 'must-never-be-read' },
      fetchSpy as unknown as typeof fetch,
      (l) => logs.push(l),
    );
    // staging runs with C2PA_RESIGN "0", which the guard ignores; prod has "1" in services/edge/wrangler.jsonc
    expect(logs).toEqual([NO_TRANSCODER_LINE]);
    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
