/**
 * Harness of the character pipeline tests (M10a1): the executor over `MockFalPort` with recorded fixture answers (`test/fixtures/fal/character/*.json`),
 * in-memory work files, a counting FalPort, a ledger-less budget, and a publisher that keeps what it is asked to write. Nothing leaves memory.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rigJson from '../../../../packages/shared/src/rig/bay_rig_v1.json';
import type { RigFamily } from '../../../../packages/shared/src/assets/gates/index.ts';
import { runCharacter, recordDecision, type ExecutorConfig, type ExecutorPorts, type RunOutcome, type RunUntil } from '../../../../tools/assets/gen/executor.ts';
import { memoryBlob } from '../../../../tools/assets/gen/ports.ts';
import type { PublishPort } from '../../../../tools/assets/gen/stages/publish.ts';
import { squarePng, sheetPng } from '../../../../tools/assets/test/helpers/images.ts';
import { buildMannequin } from '../../../../tools/assets/test/helpers/mannequin.ts';
import { GENAI_REGISTRY, PROMPT_LINT_CONFIG } from '../../src/registry.ts';
import { MemoryRecorder, MockFalPort, type MockCharacterAnswer } from '../../src/mock/MockFalPort.ts';
import type { CharacterFalPort, CharacterSubject, HumanGateId, PipelineTier, ReviewEntry } from '../../src/steps/character.ts';
import { stageSeed } from '../../src/steps/character.ts';
import type { RosterEntry } from '../../src/ports.ts';
import { heldVision, type VisionPort } from '../../src/steps/gates.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(here, '../fixtures/fal/character', `${name}.json`), 'utf8'));

export const BAY_RIG = rigJson as unknown as RigFamily;
const STANDARD_CLIPS = ['Idle', 'Walk', 'Run', 'Jump', 'Hit'];

/** Bytes of every file the recorded answers point at. Built once: the mannequins are async, the sheets are large. */
let assets: Map<string, Uint8Array> | null = null;
export async function loadAssets(): Promise<Map<string, Uint8Array>> {
  if (assets !== null) return assets;
  const m = new Map<string, Uint8Array>();
  for (const n of [1, 2, 3]) m.set(`sheet-${n}.png`, sheetPng(2560, 1440, 40 * n));
  m.set('sheet-4.png', sheetPng(1600, 900, 200));
  m.set('lean-sheet-1.png', sheetPng(1600, 900, 40));
  for (const n of [1, 2]) {
    m.set(`portrait-${n}.png`, squarePng(1024, 30 * n));
    m.set(`atlas-${n}.png`, squarePng(1024, 70 * n));
    m.set(`model-${n}.glb`, await buildMannequin({ skin: false, repeat: n, texturePx: 64 }));
  }
  m.set('rigged.glb', await buildMannequin({ clips: STANDARD_CLIPS.map((name) => ({ name })) }));
  m.set('rigged-lean.glb', await buildMannequin({}));
  m.set('walking.glb', await buildMannequin({ clipsOnly: true, clips: [{ name: 'Walk' }] }));
  m.set('running.glb', await buildMannequin({ clipsOnly: true, clips: [{ name: 'Run' }] }));
  m.set('thumb.png', squarePng(64, 9));
  m.set('rigged.fbx', new Uint8Array([70, 66, 88, 0]));
  assets = m;
  return m;
}

export const subjectOf = (over: Partial<CharacterSubject> = {}): CharacterSubject => ({
  slug: 'fixture-mc', tier: 'original', soulVersion: 1, visualBrief: 'Lean performer in a yellow jacket over a black hoodie, round glasses and white sneakers.',
  heightM: 1.7, moves: [], standIn: null, pipeline: 'standard', hero: false, killed: [], ...over,
});

export interface HarnessOptions {
  subject?: Partial<CharacterSubject>;
  /** Mesh model files (`model-1.glb`, `model-2.glb`) the rigger refuses with HTTP 422. */
  rigRefuses?: readonly string[];
  vision?: VisionPort;
  withStyleBible?: boolean;
  mode?: 'mock' | 'live';
}

export interface Harness {
  subject: CharacterSubject;
  ports: ExecutorPorts;
  cfg: ExecutorConfig;
  blob: ReturnType<typeof memoryBlob>;
  recorder: MemoryRecorder;
  /** `FalPort.submit` calls so far, by endpoint. */
  submits: string[];
  settled: { jobId: string; micros: number }[];
  published: Map<string, Uint8Array>;
  setKilled(scopes: string[]): void;
  run(until: RunUntil): Promise<RunOutcome>;
  decide(gate: HumanGateId, entry?: Partial<Omit<ReviewEntry, 'gate' | 'at'>>): Promise<void>;
}

export async function makeHarness(o: HarnessOptions = {}): Promise<Harness> {
  const bytes = await loadAssets();
  const subject = subjectOf(o.subject);
  const lean = subject.pipeline === 'lean';
  const blob = memoryBlob();
  const recorder = new MemoryRecorder();
  const submits: string[] = [];
  const settled: { jobId: string; micros: number }[] = [];
  const published = new Map<string, Uint8Array>();
  let killed: string[] = subject.killed as string[];
  let tick = 0;
  const clock = { now: (): number => Date.parse('2026-10-27T12:00:00Z') + tick++ * 1000 };

  const respond = (endpointId: string, input: Record<string, unknown>, _jobKey: string): MockCharacterAnswer => {
    const prompt = String(input['prompt'] ?? '');
    if (endpointId === 'openai/gpt-image-2.5/sunburst/edit') return { result: fixture(prompt.includes('mouth shapes') ? 'mouth_atlas' : (input['image_size'] as { width: number }).width === 1024 ? 'portrait' : 'sheet') };
    if (endpointId === 'google/nano-banana-2.1/edit') return { result: fixture('sheet-lean') };
    if (endpointId === 'meshy/v7.1/multi-image-to-3d' || endpointId === 'tripo3d/h3.1/multiview-to-3d') {
      const candidate = input['seed'] === stageSeed(subject.slug, 'mesh', 1) ? 2 : 1;
      const doc = structuredClone(fixture('mesh')) as { model_glb: { url: string; file_name: string } };
      doc.model_glb.url = `mock://fal/recorded/model-${candidate}.glb`;
      doc.model_glb.file_name = `model-${candidate}.glb`;
      return { result: doc };
    }
    if (endpointId === 'fal-ai/meshy/rigging/multi-animation' || endpointId === 'fal-ai/meshy/rigging') {
      const model = String(input['model_url'] ?? '').split('/').pop() ?? '';
      if (o.rigRefuses?.includes(model)) return { result: {}, error: (fixture('rig-422') as { error: { type: string; message: string } }).error };
      return { result: fixture(endpointId === 'fal-ai/meshy/rigging' ? 'rig-lean' : 'rig') };
    }
    throw new Error(`no recorded answer for ${endpointId}`);
  };
  const fileBytes = (url: string): Uint8Array | null => {
    const name = url.split('/').pop() ?? '';
    if (name === 'rigged.glb') return bytes.get(lean ? 'rigged-lean.glb' : 'rigged.glb') ?? null;
    if (name === 'sheet-1.png' && lean) return bytes.get('lean-sheet-1.png') ?? null;
    if (lean && /^sheet-[234]\.png$/.test(name)) return bytes.get('sheet-4.png') ?? null;
    return bytes.get(name) ?? null;
  };
  const inner = new MockFalPort({ recorder, now: () => clock.now(), deliver: () => Promise.resolve(), character: { respond, bytes: fileBytes } });
  const fal: CharacterFalPort = {
    submit: (e, i, opts) => {
      submits.push(e);
      return inner.submit(e, i, opts);
    },
    status: (s) => inner.status(s),
    result: (s) => inner.result(s),
    cancel: (s) => inner.cancel(s),
    fetchFile: (u) => inner.fetchFile(u),
    fetchStream: (u) => inner.fetchStream(u),
    keyframe: (j) => inner.keyframe(j),
    outputs: (s) => inner.outputs(s),
  };
  const roster = { lookup: (): Promise<RosterEntry | null> => Promise.resolve({ id: subject.slug, tier: subject.tier, soulVersion: subject.soulVersion, killed }) };
  const ports: ExecutorPorts = {
    fal, blob, roster, flags: { killSwitches: () => Promise.resolve(new Set<string>()) }, clock,
    budget: {
      reserve: () => Promise.resolve({ ok: true, level: 0 }),
      settle: (jobId, micros) => Promise.resolve(void settled.push({ jobId, micros })),
      level: () => Promise.resolve(0),
    },
    vision: o.vision ?? heldVision('test run: no vision model'),
    log: () => undefined,
  };
  const budgets = JSON.parse(readFileSync(path.join(here, '../../../../config/asset-budgets.json'), 'utf8')) as { rows: { id: string; fidelity: unknown }[] };
  const row = budgets.rows.find((r) => r.id === (subject.hero ? 'character-hero' : 'character-npc'));
  const publisher: PublishPort = { write: (rel, b) => void published.set(rel, b), exists: (rel) => published.has(rel) };
  const cfg: ExecutorConfig = {
    registry: GENAI_REGISTRY, gate: { falMode: 'mock', environment: 'dev', registry: GENAI_REGISTRY, lint: PROMPT_LINT_CONFIG }, mode: o.mode ?? 'mock', requestedBy: 'art-lead',
    styleBible: o.withStyleBible === false ? null : { id: 'bay-cel@1', bytes: squarePng(256, 5) }, refs: [],
    rig: BAY_RIG, limits: row?.fidelity as ExecutorConfig['limits'], textLint: () => true, ktx: null,
    consent: { schema: 'consent-index/1', entries: [] }, recordLicenses: ['LicenseRef-DeeVerse-Owned'],
    termsSnapshot: { path: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md', sha256: 'e'.repeat(64), checked_at: '2026-10-18' }, publisher,
  };
  return {
    subject, ports, cfg, blob, recorder, submits, settled, published,
    setKilled: (s) => {
      killed = s;
    },
    run: (until) => runCharacter(ports, cfg, subject, until),
    decide: async (gate, entry = {}) => {
      await recordDecision(blob, subject, { gate, by: 'art-lead', decision: 'approve', choose: 1, ...entry }, '2026-10-27T12:30:00Z');
    },
  };
}

export type { PipelineTier };
