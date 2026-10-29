import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { lineCapMicros } from '../../../packages/shared/src/genai/lines.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { readJson, toolsRoot } from '../../ci/lib/common.ts';
import { runQueued } from '../lib/fal-queue.ts';
import { cropPanels, parseFfprobe, probeGlb, proposeAliases, scanC2pa } from '../lib/media-probe.ts';
import { checkCallable, planFindings, planFit, planTotalMicros, resolveKey, SpikeLedger, type SpikePlan } from '../lib/spike-ledger.ts';
import { diffPrices } from '../genai-price.ts';
import { loadPlan, parseBriefs, pathsFor, renderPlan, runSpike, verifyResults, type SpikeResults } from '../genai-spike.ts';
import { scanText } from '../../ci/check-secrets.ts';

const fx = (n: string): unknown => JSON.parse(readFileSync(path.join(toolsRoot, 'tools/assets/test/fixtures/fal', n), 'utf8'));
const registry = readJson<GenAiRegistry>(path.join(toolsRoot, 'config/genai-endpoints.json'));
const plan = loadPlan(toolsRoot);
const briefs = parseBriefs(readFileSync(path.join(toolsRoot, 'tools/assets/spike/briefs.md'), 'utf8'));

const tmps: string[] = [];
function tmpRoot(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'dv-spike-test-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true });
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function tinyGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const mk = (name: string): ReturnType<Document['createNode']> => doc.createNode(name);
  const hips = mk('mixamorig:Hips');
  const spine = mk('mixamorig:Spine');
  const lh = mk('mixamorig:LeftHand');
  const thumb = mk('mixamorig:LeftHandThumb1');
  hips.addChild(spine);
  spine.addChild(lh);
  lh.addChild(thumb);
  const skin = doc.createSkin('skin').addJoint(hips).addJoint(spine).addJoint(lh).addJoint(thumb);
  const pos = doc.createAccessor('pos').setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos);
  const mesh = doc.createMesh('body').addPrimitive(prim);
  const meshNode = doc.createNode('body').setMesh(mesh).setSkin(skin);
  doc.createScene('s').addChild(hips).addChild(meshNode);
  const t = doc.createAccessor('t').setType('SCALAR').setArray(new Float32Array([0, 0.5, 1.25])).setBuffer(buf);
  const v = doc.createAccessor('v').setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 1, 0, 0, 2, 0])).setBuffer(buf);
  const sampler = doc.createAnimationSampler().setInput(t).setOutput(v);
  const channel = doc.createAnimationChannel().setTargetNode(hips).setTargetPath('translation').setSampler(sampler);
  doc.createAnimation('Idle').addSampler(sampler).addChannel(channel);
  return new NodeIO().writeBinary(doc);
}

function sheetPng(): Buffer {
  const png = new PNG({ width: 64, height: 36 });
  for (let i = 0; i < 64 * 36; i++) {
    png.data[i * 4] = 200;
    png.data[i * 4 + 1] = 200;
    png.data[i * 4 + 2] = 200;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

interface MockOpts {
  /** endpoint -> number of submits to answer with HTTP 422 (seed rejected) before accepting. */
  reject422?: Record<string, number>;
  /** endpoints whose request completes with an error_type. */
  failWith?: Record<string, string>;
  glb: Uint8Array;
}

function mockFal(opts: MockOpts): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  const results = fx('results.json') as Record<string, unknown>;
  const submits: Record<string, number> = {};
  const polls = new Map<string, number>();
  const kindOf = (id: string): string =>
    /text-to-image|sunburst\/edit|nano-banana/.test(id) ? 'image' : /multi-image-to-3d/.test(id) ? 'mesh' : /rigging/.test(id) ? 'rig' : /speech/.test(id) ? 'audio' : 'video';
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const q = url.match(/^https:\/\/queue\.fal\.run\/(.+?)(?:\/requests\/([^/]+)(?:\/(status))?)?$/);
    if (q && method === 'POST') {
      const id = q[1] as string;
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      submits[id] = (submits[id] ?? 0) + 1;
      if ((opts.reject422?.[id] ?? 0) >= submits[id] && 'seed' in body) return json(fx('error-422.json'), 422);
      const sub = JSON.parse(JSON.stringify(fx('submit.json')).replaceAll('ENDPOINT', id).replaceAll('REQ', `req-${id.replace(/\W/g, '')}-${submits[id]}`)) as Record<string, unknown>;
      return json(sub);
    }
    if (q && method === 'GET' && q[3] === 'status') {
      const key = url;
      const n = polls.get(key) ?? 0;
      polls.set(key, n + 1);
      const id = q[1] as string;
      if (n === 0) return json(fx('status-in-queue.json'));
      if (n === 1) return json(fx('status-in-progress.json'));
      return json(opts.failWith?.[id] ? fx('status-completed-error.json') : fx('status-completed.json'));
    }
    if (q && method === 'GET' && q[2]) {
      const id = q[1] as string;
      if (opts.failWith?.[id]) return json(fx('result-error.json'), 422);
      return json(results[kindOf(id)]);
    }
    if (url.startsWith('https://v3.fal.media/')) {
      if (url.endsWith('.png')) return new Response(new Uint8Array(sheetPng()), { headers: { 'content-type': 'image/png', 'content-length': String(sheetPng().length) } });
      if (url.endsWith('.glb')) return new Response(new Uint8Array(opts.glb), { headers: { 'content-type': 'model/gltf-binary' } });
      if (url.endsWith('.mp4')) return new Response(new Uint8Array(64), { headers: { 'content-type': 'video/mp4' } });
      return new Response(new Uint8Array(32), { headers: { 'content-type': 'audio/mpeg' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch: fetchFn, calls };
}

const instant = { sleep: async (): Promise<void> => undefined, pollMs: 0 };
let clock = 1_000;
const now = (): number => (clock += 50);

describe('plan (AC-1)', () => {
  it('has 13 steps that all resolve, a total estimate <= $6 and the cap of the spike line (M10d0)', () => {
    expect(plan.steps).toHaveLength(13);
    expect(planFindings(plan, registry)).toEqual([]);
    expect(planTotalMicros(plan)).toBeLessThanOrEqual(6_000_000);
    expect(plan.capMicros).toBe(lineCapMicros('spike'));
    expect(plan.capMicros).toBe(4_000_000);
    const lines = renderPlan(plan, registry);
    expect(lines).toHaveLength(plan.steps.length + 4);
    expect(lines.join('\n')).toContain('the spike line is $4.00');
  });

  it('lists the steps that fit under the line, with and without --skip-blocked (M10d0 AC-10)', () => {
    const run = planFit(plan, registry);
    expect(run.reservableMicros).toBeLessThanOrEqual(plan.capMicros);
    expect(run.steps.filter((s) => s.verdict === 'over-cap').map((s) => s.id)).toEqual(['V5']);
    const skip = planFit(plan, registry, { skipBlocked: true });
    expect(skip.reservableMicros).toBe(3_760_000);
    expect(skip.steps.filter((s) => s.verdict === 'skipped').map((s) => s.id)).toEqual(['V2', 'V4']);
    expect(skip.steps.some((s) => s.verdict === 'over-cap')).toBe(false);
    expect(renderPlan(plan, registry).join('\n')).toContain('--run --skip-blocked: reserves at most $3.76');
  });

  it('plan.json holds no cap of its own; the line is the one source', () => {
    const raw = JSON.parse(readFileSync(path.join(toolsRoot, 'tools/assets/spike/plan.json'), 'utf8')) as Record<string, unknown>;
    expect('capMicros' in raw).toBe(false);
    expect('plannedMaxMicros' in raw).toBe(false);
  });

  it('every id is an integer micros estimate and every U-item need is a plan step', () => {
    for (const s of plan.steps) expect(Number.isInteger(s.estimateMicros)).toBe(true);
    expect(planFindings({ ...plan, steps: plan.steps.map((s) => (s.id === 'V1' ? { ...s, registryKey: 'h3.partner#nope' } : s)) }, registry)).toHaveLength(1);
  });

  it('briefs have a section for every @brief token', () => {
    const tokens = JSON.stringify(plan).match(/@brief:[a-z_]+/g) ?? [];
    for (const t of tokens) expect(briefs[t.slice(7)]).toBeTruthy();
  });
});

describe('skip without FAL_KEY (AC-2)', () => {
  it('writes the skip record, makes zero network calls, and verifies', async () => {
    const root = tmpRoot();
    const calls: string[] = [];
    const results = await runSpike({
      root, plan, registry, briefs, env: {}, now, sleep: instant.sleep,
      fetch: async (u) => {
        calls.push(u);
        throw new Error('network must not be used');
      },
    });
    expect(calls).toEqual([]);
    expect(results.status).toBe('skipped');
    expect(results.reason).toBe('FAL_KEY not set');
    const onDisk = JSON.parse(readFileSync(pathsFor(root).resultsJson, 'utf8')) as SpikeResults;
    expect(onDisk.reason).toBe('FAL_KEY not set');
    expect(onDisk.uItems.every((u) => u.outcome === 'skipped' && u.detail === 'FAL_KEY not set')).toBe(true);
    expect(verifyResults(root, plan)).toEqual([]);
  });
});

describe('guards (AC-4)', () => {
  it('refuses banned ids and pending endpoints in production; allows blocked in previs', () => {
    const banned = checkCallable(registry, 'minimax/h3-max/recast', 'active', 'previs');
    expect(banned).toMatchObject({ ok: false, code: 'ENDPOINT_BANNED' });
    expect(checkCallable(registry, 'x/face-swap/y', 'active', 'previs')).toMatchObject({ ok: false, code: 'ENDPOINT_BANNED' });
    const pending = resolveKey(registry, 'openai/gpt-image-2.5/sunburst/text-to-image');
    expect(pending?.status).toBe('pending');
    expect(checkCallable(registry, pending!.endpointId, pending!.status, 'production')).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
    const blocked = resolveKey(registry, 'h3.maxTurbo#i2v');
    expect(blocked?.status).toBe('blocked');
    expect(checkCallable(registry, blocked!.endpointId, blocked!.status, 'previs')).toEqual({ ok: true });
    expect(checkCallable(registry, blocked!.endpointId, blocked!.status, 'production')).toMatchObject({ ok: false, code: 'ENDPOINT_NOT_CLEARED' });
    const active = resolveKey(registry, 'meshy/v7.1/multi-image-to-3d');
    expect(checkCallable(registry, active!.endpointId, active!.status, 'production')).toEqual({ ok: true });
  });

  it('a banned id in a run is refused without a submit', async () => {
    const root = tmpRoot();
    const bannedPlan: SpikePlan = {
      ...plan,
      steps: [{ id: 'X1', title: 'banned', kind: 'fal', registryKey: 'bad', estimateMicros: 1, params: {}, dependsOn: [], uItems: [] }],
      uItems: [],
    };
    const reg = structuredClone(registry);
    reg.endpoints.bad = { ...reg.endpoints['meshy/v7.1/multi-image-to-3d']!, id: 'minimax/h3-max/recast' };
    const m = mockFal({ glb: new Uint8Array() });
    const r = await runSpike({ root, plan: bannedPlan, registry: reg, briefs, env: { FAL_KEY: 'test' }, fetch: m.fetch, now, ...instant });
    expect(r.steps[0]).toMatchObject({ status: 'refused', errorType: 'ENDPOINT_BANNED' });
    expect(m.calls).toEqual([]);
  });
});

describe('budget (AC-3)', () => {
  it('refuses a step that would pass the cap and ends the run with the refusal recorded', async () => {
    const ledger = new SpikeLedger(10_000_000);
    expect(ledger.reserve('A', 9_500_000)).toEqual({ ok: true });
    expect(ledger.reserve('B', 1_000_000)).toMatchObject({ ok: false, code: 'BUDGET' });
    expect(ledger.totalMicros).toBe(9_500_000);

    const root = tmpRoot();
    const p = pathsFor(root);
    mkdirSync(p.researchDir, { recursive: true });
    writeFileSync(p.ledgerJson, JSON.stringify({ schema: 'spike-ledger/1', capMicros: 10_000_000, totalMicros: 9_500_000, entries: [{ stepId: 'old', estimateMicros: 9_500_000, outcome: 'submitted' }] }));
    const bigPlan: SpikePlan = { ...plan, steps: plan.steps.filter((s) => ['C1', 'A1'].includes(s.id)).map((s) => (s.id === 'C1' ? { ...s, estimateMicros: 1_000_000 } : s)), uItems: [] };
    const m = mockFal({ glb: new Uint8Array() });
    const r = await runSpike({ root, plan: bigPlan, registry, briefs, env: { FAL_KEY: 'test' }, fetch: m.fetch, now, ...instant });
    expect(m.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(r.steps.find((s) => s.id === 'C1')).toMatchObject({ status: 'refused', errorType: 'BUDGET' });
    expect(r.steps.find((s) => s.id === 'A1')?.status).toBe('not_run');
    expect(r.reason).toMatch(/BUDGET/);
    expect(r.ledgerTotalMicros).toBe(9_500_000);
  });
});

describe('queue lifecycle (AC-5)', () => {
  it('walks IN_QUEUE, IN_PROGRESS, COMPLETED and sends the headers', async () => {
    const m = mockFal({ glb: new Uint8Array() });
    const sleeps: number[] = [];
    const run = await runQueued(
      { key: 'test', fetch: m.fetch, sleep: async (ms) => void sleeps.push(ms), now, lifecycleHeader: plan.lifecycleHeader, pollMs: 7 },
      'fal-ai/minimax/speech-2.8-turbo', { text: 'hi' }, { storeIo0: true },
    );
    expect(run.errorType).toBeNull();
    expect(run.retrievable).toBe(true);
    expect(run.inferenceTimeS).toBe(1.54);
    expect(run.runMs).toBe(1540);
    expect(run.queueWaitMs).not.toBeNull();
    expect(sleeps).toEqual([7, 7]);
    const post = m.calls[0] as Call;
    expect(post.headers['x-fal-object-lifecycle-preference']).toBe('{"expiration_duration_seconds": 86400}');
    expect(post.headers['x-fal-store-io']).toBe('0');
    expect(post.headers.authorization).toBe('Key test');
  });

  it('retries a 429 after the backoff and records an error_type', async () => {
    let n = 0;
    const m = mockFal({ glb: new Uint8Array(), failWith: { 'x/y': 'content_policy_violation' } });
    const wrapped = async (u: string, i?: RequestInit): Promise<Response> => (u.endsWith('/x/y') && i?.method === 'POST' && n++ === 0 ? json({}, 429, { 'x-fal-needs-retry': '1' }) : m.fetch(u, i));
    const slept: number[] = [];
    const run = await runQueued({ key: 'k', fetch: wrapped, sleep: async (ms) => void slept.push(ms), now, lifecycleHeader: '{}', pollMs: 1 }, 'x/y', {});
    expect(run.retries429).toBe(1);
    expect(slept[0]).toBe(2000);
    expect(run.errorType).toBe('content_policy_violation');
    expect(run.httpStatus).toBe(422);
    expect(run.retrievable).toBe(false);
  });

  it('a mocked full run honours headers, measurement fields, output paths, 422 param drop and error rows', async () => {
    const root = tmpRoot();
    const glb = await tinyGlb();
    const m = mockFal({ glb, reject422: { 'minimax/h3/image-to-video': 1 }, failWith: { 'minimax/h3-max-turbo/image-to-video': 'content_policy_violation' } });
    const notes = { 'U-AST-7': 'invoice line seen: no extra cost', 'U-S03-1': 'identity held', 'U-AST-17': '25 minutes' };
    const p = pathsFor(root);
    mkdirSync(p.researchDir, { recursive: true });
    writeFileSync(p.notesJson, JSON.stringify(notes));
    // A wider cap than the $4 spike line, so this test still exercises every step of the plan (the line itself is tested above).
    const results = await runSpike({ root, plan: { ...plan, capMicros: 10_000_000, plannedMaxMicros: 10_000_000 }, registry, briefs, env: { FAL_KEY: 'test' }, fetch: m.fetch, now, ...instant });

    const posts = m.calls.filter((c) => c.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(10);
    for (const c of posts) expect(c.headers['x-fal-object-lifecycle-preference']).toBe(plan.lifecycleHeader);
    const storeIo = posts.filter((c) => c.headers['x-fal-store-io'] === '0');
    expect(storeIo.map((c) => c.url)).toEqual(['https://queue.fal.run/fal-ai/minimax/speech-2.8-turbo']);
    expect(m.calls.every((c) => !c.url.startsWith('https://v3.fal.media/') || !('authorization' in c.headers))).toBe(true);

    const by = Object.fromEntries(results.steps.map((s) => [s.id, s]));
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'K1', 'V1', 'V2', 'V3', 'V5', 'A1']) expect(by[id]?.status, id).toBe('ok');
    expect(by.V4).toMatchObject({ status: 'failed', errorType: 'content_policy_violation' });
    expect(by.R1).toMatchObject({ status: 'skipped' });
    expect(by.V1?.omittedParams).toEqual(['seed', 'prompt_expansion_mode']);
    expect(by.V3?.acceptedParams).toEqual(['seed', 'resolution']);
    expect(by.A1?.retrievable).toBe(true);
    expect(by.A1?.storeIo0).toBe(true);
    expect(by.C1?.outputs[0]).toMatchObject({ contentType: 'image/png', contentLengthHeader: true });
    expect(by.C1?.outputs[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(by.C5?.outputs.length).toBeGreaterThan(0);
    for (const s of results.steps) {
      for (const f of ['requestId', 'queueWaitMs', 'runMs', 'httpStatus', 'errorType', 'retrievable', 'omittedParams', 'outputs'] as const) expect(s, `${s.id}.${f}`).toHaveProperty(f);
      if (s.kind === 'fal' && s.status === 'ok') {
        expect(s.requestId).toBeTruthy();
        expect(s.runMs).toBeGreaterThan(0);
        expect(s.httpStatus).toBe(200);
      }
    }
    // Blocked V2 output removed after probing; ledger within the cap.
    expect(readdirSync(path.join(p.outDir, 'V2'))).toEqual([]);
    expect(results.ledgerTotalMicros).toBeLessThanOrEqual(planTotalMicros(plan));
    expect(results.status).toBe('partial');
    expect(results.uItems.find((u) => u.id === 'U-S03-3')?.detail).toContain('V1: accepted []');

    // Bones file from the probe.
    const bones = JSON.parse(readFileSync(p.bonesJson, 'utf8')) as { files: Record<string, { hasFingerBones: boolean; proposal: { aliases: Record<string, string> } }> };
    const first = Object.values(bones.files)[0]!;
    expect(first.hasFingerBones).toBe(true);
    expect(first.proposal.aliases['mixamorig:Hips']).toBe('hips');

    // Writes only under research/ and .spike/ ; no URLs or keys in the written metadata.
    const written: string[] = [];
    const walk = (d: string, rel = ''): void => {
      for (const n of readdirSync(path.join(d, rel))) {
        const r = rel ? `${rel}/${n}` : n;
        if (statSync(path.join(d, r)).isDirectory()) walk(d, r);
        else written.push(r);
      }
    };
    walk(root);
    expect(written.every((f) => f.startsWith('research/') || f.startsWith('.spike/'))).toBe(true);
    for (const f of written.filter((w) => w.startsWith('research/'))) {
      const text = readFileSync(path.join(root, f), 'utf8');
      expect(text).not.toMatch(/fal\.media|https?:\/\//);
      expect(scanText(text, f)).toEqual([]);
    }
    // The wide cap of this test is what --verify refuses: only the spike line is valid (M10d0).
    expect(verifyResults(root, plan).map((x) => x.replace(/\d[\d,]*/g, 'N'))).toEqual([
      'ledger total N micros passes N (the spike line)',
      'ledger cap N is not the spike line N',
      'results cap N is not the spike line N',
    ]);
    expect(readFileSync(p.resultsMd, 'utf8')).toContain('| U-AST-3 |');
  });

  it('a dependent step is skipped with the reason when its source failed', async () => {
    const root = tmpRoot();
    const m = mockFal({ glb: new Uint8Array(), failWith: { 'openai/gpt-image-2.5/sunburst/text-to-image': 'internal_server_error' } });
    const r = await runSpike({ root, plan, registry, briefs, env: { FAL_KEY: 'test' }, fetch: m.fetch, now, ...instant, only: ['C1', 'C2', 'C3'] });
    expect(r.steps.find((s) => s.id === 'C1')?.status).toBe('failed');
    expect(r.steps.find((s) => s.id === 'C2')).toMatchObject({ status: 'skipped', reason: 'dependency C1 did not complete' });
    expect(r.steps.find((s) => s.id === 'C3')).toMatchObject({ status: 'skipped' });
  });

  it('--skip-blocked skips the blocked endpoints without a submit', async () => {
    const root = tmpRoot();
    const m = mockFal({ glb: new Uint8Array() });
    const p2: SpikePlan = { ...plan, steps: plan.steps.filter((s) => ['V2', 'V4'].includes(s.id)).map((s) => ({ ...s, dependsOn: [], params: { prompt: 'x' } })), uItems: [] };
    const r = await runSpike({ root, plan: p2, registry, briefs, env: { FAL_KEY: 'test' }, fetch: m.fetch, now, ...instant, skipBlocked: true });
    expect(r.steps.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(m.calls).toEqual([]);
  });
});

describe('verify (AC-7)', () => {
  it('fails when the ledger passes the cap or a U-item has no outcome', async () => {
    const root = tmpRoot();
    await runSpike({ root, plan, registry, briefs, env: {}, now, sleep: instant.sleep, fetch: async () => { throw new Error('no'); } });
    const p = pathsFor(root);
    writeFileSync(p.ledgerJson, JSON.stringify({ schema: 'spike-ledger/1', capMicros: 10_000_000, totalMicros: 4_000_001, entries: [{ stepId: 'x', estimateMicros: 4_000_001, outcome: 'submitted' }] }));
    const res = JSON.parse(readFileSync(p.resultsJson, 'utf8')) as SpikeResults;
    res.uItems = res.uItems.filter((u) => u.id !== 'U-AST-1');
    writeFileSync(p.resultsJson, JSON.stringify(res));
    const problems = verifyResults(root, plan);
    expect(problems.some((x) => x.includes('passes 4,000,000'))).toBe(true);
    expect(problems.some((x) => x.includes('ledger cap 10000000 is not the spike line 4,000,000'))).toBe(true);
    expect(problems.some((x) => x.includes('U-item U-AST-1 has no outcome'))).toBe(true);
  });
});

describe('genai:price (AC-6)', () => {
  it('reports exactly the endpoint whose price is 6 % above the registry', () => {
    const report = diffPrices(registry, fx('pricing.json'));
    expect(report.unparsed).toBe(false);
    expect(report.diffs.map((d) => d.id)).toEqual(['meshy/v7.1/multi-image-to-3d']);
    expect(report.diffs[0]?.pct).toBeCloseTo(0.06, 5);
    expect(report.compared).toBe(3);
  });

  it('reports an unknown shape as unparsed', () => {
    expect(diffPrices(registry, { hello: 'world' }).unparsed).toBe(true);
  });
});

describe('probes', () => {
  it('probes a GLB: bones, clips, triangles, aliases', async () => {
    const probe = await probeGlb(await tinyGlb());
    expect(probe.jointCount).toBe(4);
    expect(probe.triangleCount).toBe(1);
    expect(probe.hasFingerBones).toBe(true);
    expect(probe.hasJawBone).toBe(false);
    expect(probe.clips).toEqual([{ name: 'Idle', durationS: 1.25 }]);
    expect(probe.bones.find((b) => b.name === 'mixamorig:Spine')?.parent).toBe('mixamorig:Hips');
    expect(probe.proposal.aliases['mixamorig:LeftHand']).toBe('l_hand');
    expect(probe.proposal.unmapped).toEqual(['mixamorig:LeftHandThumb1']);
    expect(proposeAliases(['Hips', 'Spine1']).aliases).toEqual({ Hips: 'hips', Spine1: 'chest' });
  });

  it('crops a 4-panel sheet into four equal squares in the fixed order', () => {
    const crops = cropPanels(new Uint8Array(sheetPng()), 4);
    expect(crops.map((c) => c.name)).toEqual(['front', 'left', 'back', 'right']);
    for (const c of crops) expect([c.width, c.height]).toEqual([36, 36]);
  });

  it('scans C2PA by labels (heuristic) and parses ffprobe output', () => {
    expect(scanC2pa(new TextEncoder().encode('xxjumb....c2pa.manifest')).present).toBe(true);
    expect(scanC2pa(new TextEncoder().encode('plain bytes')).present).toBe(false);
    const info = parseFfprobe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.2' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1344, height: 768, avg_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }],
    });
    expect(info.video).toEqual({ codec: 'h264', width: 1344, height: 768, fps: 24 });
    expect(info.audio?.codec).toBe('aac');
  });
});
