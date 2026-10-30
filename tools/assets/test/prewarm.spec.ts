/**
 * M05c3 AC-1, AC-3, AC-4, AC-7 and M05c4 AC-4: the prewarm gates, the plan, the `--live` refusals and the live submission over fake ports
 * (no network, no fal).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CutsceneStatus } from '../../../packages/shared/src/api/v1.ts';
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { main } from '../gen/cli.ts';
import { DEFAULT_CAP_MICROS } from '../gen/estimate.ts';
import { NO_PROVIDER_LINE, parseSheetsLock, providerGate } from '../gen/gates.ts';
import type { Runner } from '../src/uploader-rclone.ts';
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

interface HarnessOptions {
  ready?: readonly string[];
  pending?: readonly string[];
  ledger?: { cap: number; spent: number } | null;
  resign?: boolean | null;
  /** Keys that have a `handoff.json` (the private-bucket check is wired when this is set, even empty). */
  handoff?: readonly string[];
  /** Route 28 is wired (OPS_TOKEN set). After it, route 27 answers the state given here for each submitted key. */
  submit?: { after: 'ready' | 'pending' | 'failed' };
  /** After the submission every submitted key has a handoff.json (the Worker handed it off). */
  handoffAfterSubmit?: boolean;
}

function harness(o: HarnessOptions = {}): Harness & { submitted: string[][]; sleeps: number[] } {
  const h = { ports: undefined as unknown as PrewarmPorts, logs: [] as string[], files: new Map<string, string>(), calls: [] as string[], submitted: [] as string[][], sleeps: [] as number[] };
  let submittedYet = false;
  let now = 1_000_000;
  const ready = new Set(o.ready ?? []);
  const pending = new Set(o.pending ?? []);
  const ledger: LedgerPort | null =
    o.ledger === null
      ? null
      : {
          capMicros: () => Promise.resolve(void h.calls.push('ledger')).then(() => (o.ledger ?? { cap: 100_000_000 }).cap),
          spentMicros: (_v: string, kind?: string) => Promise.resolve(((o.ledger ?? { spent: 0 }) as { spent: number }).spent + (kind === 'cutscene' && submittedYet ? 14_700_000 : 0)),
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
      const after = submittedYet && h.submitted.flat().includes(key) ? o.submit?.after : undefined;
      return Promise.resolve({ key, state: after ?? (pending.has(key) ? 'pending' : 'absent') } as CutsceneStatus);
    },
    ledger,
    ...(o.submit !== undefined
      ? {
          submit: (keys: string[]) => {
            h.calls.push(`submit:${keys.length}`);
            h.submitted.push(keys);
            submittedYet = true;
            return Promise.resolve(keys.map((key) => ({ key, state: 'pending' }) as CutsceneStatus));
          },
        }
      : {}),
    ...(o.handoff !== undefined
      ? { hasHandoff: (key: string) => (h.calls.push(`handoff:${key}`), Promise.resolve(o.handoff!.includes(key) || (o.handoffAfterSubmit === true && submittedYet && h.submitted.flat().includes(key)))) }
      : {}),
    clock: { now: () => now, sleep: (ms: number) => (h.sleeps.push(ms), (now += ms), Promise.resolve()) },
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

  it('an unknown subcommand is refused and a bare call prints the usage (plan, run, gate and ledger landed in M10a1)', async () => {
    const logs: string[] = [];
    expect(await main(['frobnicate'], {}, fetch, (l) => logs.push(l))).toBe(2);
    expect(logs[0]).toMatch(/unknown subcommand frobnicate/);
    const usage: string[] = [];
    expect(await main([], {}, fetch, (l) => usage.push(l))).toBe(2);
    expect(usage[0]).toMatch(/prewarm\|plan\|run\|gate\|ledger/);
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
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('staging --live is not guarded by it', async () => {
    const h = harness({ resign: false, submit: { after: 'pending' }, handoff: [] });
    const r = await runPrewarm({ ...base, env: 'staging', live: true }, h.ports);
    expect(r.code).toBe(0);
    expect(h.submitted).toHaveLength(1);
  });
});

describe('--live submits the plan and hands off (M05c4 AC-4)', () => {
  const allSheets = JSON.stringify({ schema: 'sheets-lock/1', sheets: Object.fromEntries(requests.flatMap((r) => r.characters.map((c) => [c.id, { approved: true, crops: ['a'.repeat(64)] }] as const))) });
  const live: PrewarmOptions = { ...base, live: true, sheetsFile: 'all-sheets.json', report: true };
  const keys = requests.map((r) => r.key);
  const withSheets = <T extends Harness>(h: T): T => (h.files.set('all-sheets.json', allSheets), h);

  it('one route 28 call carries exactly the planned keys; the key with a handoff.json is skip: pending at $0; no transcoder refusal', async () => {
    const h = withSheets(harness({ submit: { after: 'ready' }, handoff: [keys[0]!] }));
    const r = await runPrewarm(live, h.ports);
    expect(r.code).toBe(0);
    expect(r.plan!.rows[0]).toMatchObject({ key: keys[0], status: 'pending', estimateMicros: 0 });
    expect(r.plan!.rows[0]!.detail).toMatch(/handed off/);
    expect(h.submitted).toEqual([keys.slice(1)]);
    expect(h.logs.join('\n')).toContain('skip: pending');
    expect(h.logs.join('\n')).not.toMatch(/no transcoder/);
    expect(h.logs.join('\n')).toContain('live: ready 8, handed off 0, failed 0, still pending 0');
    // the run's ledger delta (fal, kind cutscene) is printed and lands in the report
    expect(h.logs.join('\n')).toContain('ledger delta (fal, kind cutscene): 14700000 micros');
    expect(h.files.get('docs/releases/fixture-act1/cutscenes.md')).toContain('Ledger delta of the live run (fal, kind cutscene): 14700000 micros');
    expect(h.files.get('docs/releases/fixture-act1/cutscenes.md')).toContain('Generated clips: 8 of 9');
  });

  it('keys that were handed off end the poll: handed off count, the --finish hint, a report note, exit 0', async () => {
    const h = withSheets(harness({ submit: { after: 'pending' }, handoff: [], handoffAfterSubmit: true }));
    const r = await runPrewarm(live, h.ports);
    expect(r.code).toBe(0);
    expect(h.submitted).toEqual([keys]);
    expect(h.logs.join('\n')).toContain('live: ready 0, handed off 9, failed 0, still pending 0');
    expect(h.logs.join('\n')).toMatch(/next: pnpm assets:gen prewarm -- --release fixture-act1 --env staging --finish/);
    expect(h.files.get('docs/releases/fixture-act1/cutscenes.md')).toContain('handed off, waits for --finish');
    expect(h.sleeps).toEqual([]); // the hand-off was there at the first look
  });

  it('without the private-bucket pair the poll stops after 30 minutes and prints the keys for --finish', async () => {
    const h = withSheets(harness({ submit: { after: 'pending' } })); // hasHandoff is not wired
    const r = await runPrewarm(live, h.ports);
    expect(r.code).toBe(0);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(30 * 60 * 1000);
    expect(h.logs.join('\n')).toContain('live: ready 0, handed off 0, failed 0, still pending 9');
    expect(h.logs.join('\n')).toContain('still pending after the poll limit');
  });

  it('a failed key makes the run exit 1', async () => {
    const h = withSheets(harness({ submit: { after: 'failed' }, handoff: [] }));
    expect((await runPrewarm(live, h.ports)).code).toBe(1);
    expect(h.logs.join('\n')).toContain('failed 9');
  });

  it('without OPS_TOKEN it prints a SKIP line and submits nothing', async () => {
    const h = withSheets(harness({ handoff: [] }));
    const r = await runPrewarm(live, h.ports);
    expect(r.code).toBe(0);
    expect(h.submitted).toEqual([]);
    expect(h.logs).toContain('SKIP live: OPS_TOKEN not set; nothing was submitted');
  });

  it('refuses when the plan costs more than the programme has left, and when every key is already done there is nothing to submit', async () => {
    const poor = withSheets(harness({ submit: { after: 'ready' }, ledger: { cap: 100_000_000, spent: 95_000_000 } }));
    const r = await runPrewarm(live, poor.ports);
    expect(r.code).toBe(1);
    expect(poor.submitted).toEqual([]);
    expect(poor.logs.join('\n')).toMatch(/refused: the plan costs \d+ micros, over the 5000000 micros left/);
    const done = withSheets(harness({ submit: { after: 'ready' }, ready: keys }));
    expect((await runPrewarm(live, done.ports)).code).toBe(0);
    expect(done.submitted).toEqual([]);
    expect(done.logs.join('\n')).toContain('live: nothing to submit');
  });

  it.each(['staging', 'prod'] as const)('%s through the CLI against a stub Worker: one POST with the planned keys, the handoff.json key skipped', async (env) => {
    const sheets = path.join(import.meta.dirname, 'fixtures', '.tmp-all-sheets.json');
    // the stub Worker: nothing is published, route 27 says absent until route 28 has been called, then ready
    const state = { posts: [] as { auth: string | null; keys: string[] }[], heads: 0 };
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'HEAD') {
        state.heads++;
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (url.includes('/api/v1/admin/cutscenes/prewarm')) {
        const body = JSON.parse(String(init?.body)) as { keys: string[] };
        state.posts.push({ auth: new Headers(init?.headers).get('Authorization'), keys: body.keys });
        return Promise.resolve(new Response(JSON.stringify({ keys: body.keys.map((key) => ({ key, state: 'pending' })) }), { status: 202 }));
      }
      const key = url.split('/api/v1/cutscenes/')[1]!;
      return Promise.resolve(new Response(JSON.stringify({ key, state: state.posts.length > 0 ? 'ready' : 'absent' }), { status: 200 }));
    });
    const rclone: Runner = (cmd, args) => {
      if (cmd !== 'rclone') return { status: 127, stdout: '', stderr: 'not rclone' };
      if (args[0] === 'version') return { status: 0, stdout: 'rclone v1.75.2', stderr: '' };
      // lsf of r2:<bucket>/cutscenes-orig/<key>/
      expect(args.slice(0, 3)).toEqual(['lsf', '-R', '--files-only']);
      const target = args[3]!;
      expect(target).toMatch(new RegExp(`^r2:tha-bay-private-${env === 'prod' ? 'prod' : 'staging'}/cutscenes-orig/[0-9a-f]{64}/$`));
      return target.includes(keys[0]!) ? { status: 0, stdout: 'handoff.json\norig.mp4\n', stderr: '' } : { status: 3, stdout: '', stderr: 'directory not found' };
    };
    writeFileSync(sheets, allSheets);
    try {
      const logs: string[] = [];
      const code = await main(
        ['prewarm', '--release', 'fixture-act1', '--requests', fx('act1-requests.json'), '--registry', fx('registry-cleared.json'), '--sheets', sheets, '--env', env, '--live'],
        { OPS_TOKEN: 'staff-token-for-test', FAL_KEY: 'must-never-be-read', R2_PRIVATE_ACCESS_KEY_ID: 'priv-id', R2_PRIVATE_SECRET_ACCESS_KEY: 'priv-secret', CLOUDFLARE_ACCOUNT_ID: 'acct' },
        fetchStub as unknown as typeof fetch,
        (l) => logs.push(l),
        { run: rclone, clock: { now: () => 0, sleep: () => Promise.resolve() } },
      );
      // staging runs with C2PA_RESIGN "0", which the guard ignores; prod has "1" in services/edge/wrangler.jsonc
      expect(code).toBe(0);
      expect(state.posts).toHaveLength(1);
      expect(state.posts[0]).toEqual({ auth: 'Bearer staff-token-for-test', keys: keys.slice(1) });
      expect(logs.join('\n')).toContain('skip: pending');
      expect(logs.join('\n')).not.toMatch(/no transcoder/);
      expect(logs.join('\n')).toContain('live: ready 8');
    } finally {
      rmSync(sheets, { force: true });
    }
  });
});

