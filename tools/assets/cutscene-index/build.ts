/**
 * The cutscene index builder (spec/domains/03-story-cutscenes.md section D3 and D5, M05b2). From CutsceneRefs, compiled soul
 * facts, the registry, templates, seeds, places and plates it computes, per ref, the A-03 cache key, then:
 *   - the public `CutsceneIndex` (no prompts, no URLs),
 *   - the private `CutsceneRequest[]` (shot plans with filled prompts and budgets, for prewarm),
 *   - the key list for the Worker's `cutscene-catalog.json`,
 * applying the carry-over rule (./carry-over.ts). It fails (returns problems) when an entry references `previs/`, lacks a
 * fallback DirectorScript, or a filled prompt breaks the prompt lint. Pure over its inputs: the CLI does the IO.
 */
import type {
  CutsceneIndex, CutsceneIndexEntry, CutsceneKeyInput, CutsceneRef, CutsceneRequest, ShotPlan,
} from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { cutsceneKey, endpointPin } from '../../../packages/shared/src/genai/cutscene-key.ts';
import type { GenAiRegistry, VideoProviderEntry } from '../../../packages/shared/src/genai/registry.ts';
import { CLOSED_SLOT_SOURCES, slotBase, type PromptSlotSource } from '../../../packages/shared/src/genai/prompt-lint.ts';
import { lintPrompt } from '../../../packages/shared/src/genai/prompt-lint.ts';
import type { LintBase, Template } from '../../ci/prompt-lint.ts';
import { carryOver, delisted, type ReadyPort } from './carry-over.ts';
import type { SoulFacts, SoulFactsPort } from './soul-facts.ts';

export const INDEX_SCHEMA = 'cutscene-index/1';
export const REQUESTS_SCHEMA = 'cutscene-requests/1';
/** Sunburst 1920x1080 high, USD micros per keyframe (05-assets.md section 4.5). */
export const KEYFRAME_MICROS = 39_600;
/** Retakes allowance on video seconds (section D5). */
export const RETAKE_FACTOR = 1.5;

export const TIME_OF_DAY: Readonly<Record<string, string>> = {
  dawn: 'at dawn', morning: 'in the morning', afternoon: 'in the afternoon', dusk: 'at dusk', evening: 'in the evening', night: 'at night',
};
export const WEATHER: Readonly<Record<string, string>> = {
  clear: 'under a clear sky', overcast: 'under an overcast sky', fog: 'in light fog', rain: 'in light rain', wind: 'on a windy day',
};

export interface PlateInput {
  sha256: string;
  /** Where the file came from; a `previs/` reference fails the build. */
  ref?: string;
}

export interface IndexInputs {
  release: string;
  /** Epoch ms stamped on the index; the caller passes the same value for a byte-identical rerun. */
  builtAt: number;
  refs: readonly CutsceneRef[];
  /** Templates by `<id>@<version>`, with the raw file text hashed into each request. */
  templates: ReadonlyMap<string, Template & { raw: string }>;
  souls: SoulFactsPort;
  registry: Pick<GenAiRegistry, 'endpoints' | 'videoProviders' | 'defaults'>;
  seeds: Readonly<Record<string, number>>;
  places: Readonly<Record<string, string>>;
  styles: Readonly<Record<string, { tokens: string; sha256: string | null }>>;
  /** Stage plates by stage id without the `@rev` (`content/cutscenes/plates.lock.json`). */
  plates: Readonly<Record<string, PlateInput>>;
  /** DirectorScript ids that exist. */
  directors: ReadonlySet<string>;
  previous: CutsceneIndex | null;
  ready: ReadyPort;
  lint: LintBase;
}

export interface IndexResult {
  index: CutsceneIndex;
  requests: CutsceneRequest[];
  /** Desired keys plus carried keys, sorted: the Worker's catalog. */
  catalogKeys: string[];
  problems: string[];
  /** Refs whose entry carries the previous release's key. */
  staleRefs: string[];
  /** Refs left out of the index because a cast member is killed. */
  suppressed: string[];
}

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The provider the selection rule picks (A-08): the first of `[default, ...fallbackOrder]` that is cleared; else the first usable. */
export function selectProvider(reg: Pick<GenAiRegistry, 'videoProviders' | 'defaults'>): { key: string; entry: VideoProviderEntry; cleared: boolean } | null {
  const order = [reg.defaults.videoProvider, ...reg.defaults.videoFallbackOrder];
  const usable = order.flatMap((k) => {
    const e = reg.videoProviders[k];
    return e && !delisted(reg.videoProviders, k) ? [{ key: k, entry: e }] : [];
  });
  const cleared = usable.find((u) => u.entry.licence.status === 'cleared');
  const pick = cleared ?? usable[0];
  return pick ? { ...pick, cleared: cleared !== undefined } : null;
}

const stageBase = (stage: string | null): string => (stage ?? '').replace(/@\d+$/, '');

interface Filled {
  text: string;
  slots: { slot: string; source: PromptSlotSource }[];
  problems: string[];
}

/** Fills the template for one shot: the lines that name another shot's `action_n`/`camera_n` are dropped. */
function fillTemplate(t: Template, ref: CutsceneRef, souls: readonly SoulFacts[], i: IndexInputs, shot: number): Filled {
  const problems: string[] = [];
  const used: Filled['slots'] = [];
  const style = i.styles[t.front.style ?? '']?.tokens;
  const place = i.places[stageBase(ref.stage)];
  const lines = t.body.split('\n').filter((line) => {
    for (const m of line.matchAll(/\{(?:action|camera)_(\d+)\}/g)) if (Number(m[1]) !== shot) return false;
    return true;
  });
  const text = lines.join('\n').replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, name: string) => {
    const base = slotBase(name);
    const source = CLOSED_SLOT_SOURCES[base];
    if (source === undefined) {
      problems.push(`slot ${name} is not a closed slot`);
      return '';
    }
    let value: string | undefined;
    if (base === 'style_tokens') value = style;
    else if (base === 'place_desc') value = place;
    else if (base === 'subject_brief') {
      const n = Number(/_(\d+)$/.exec(name)?.[1] ?? '1');
      const s = souls[n - 1];
      if (s === undefined) return '';
      value = s.visualBrief;
    } else if (base === 'time_of_day') value = TIME_OF_DAY[ref.slots['time_of_day'] ?? ''];
    else if (base === 'weather') value = WEATHER[ref.slots['weather'] ?? ''];
    else value = ref.slots[name];
    if (value === undefined || value === '') {
      problems.push(`slot ${name} has no value`);
      return '';
    }
    used.push({ slot: name, source });
    return value.replace(/[.\s]+$/, '');
  });
  // Empty optional subjects leave stray full stops behind.
  return { text: text.replace(/(?:\s*\.){2,}/g, '.').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' '), slots: used, problems };
}

export async function buildCutsceneIndex(i: IndexInputs): Promise<IndexResult> {
  const problems: string[] = [];
  const entries: CutsceneIndexEntry[] = [];
  const requests: CutsceneRequest[] = [];
  const staleRefs: string[] = [];
  const suppressed: string[] = [];
  const catalog = new Set<string>();
  const prev = new Map((i.previous?.entries ?? []).map((e) => [e.ref, e]));
  const provider = selectProvider(i.registry);
  if (provider === null) problems.push('no usable video provider in the registry');

  for (const ref of [...i.refs].sort((a, b) => byStr(a.id, b.id))) {
    const fail = (m: string): void => void problems.push(`${ref.id}: ${m}`);
    if (!i.directors.has(ref.fallback)) fail(`no fallback DirectorScript (${ref.fallback || 'none'})`);
    const template = i.templates.get(ref.template);
    if (!template) {
      fail(`unknown template ${ref.template}`);
      continue;
    }
    if (template.front.hook !== undefined && template.front.hook !== ref.hook) fail(`template ${ref.template} is for hook ${template.front.hook}, not ${ref.hook}`);
    const souls: SoulFacts[] = [];
    for (const id of [...ref.cast].sort(byStr)) {
      const s = i.souls.lookup(id);
      if (s) souls.push(s);
      else fail(`cast member ${id} has no soul facts`);
    }
    if (souls.length !== ref.cast.length) continue;
    const killed = souls.some((s) => s.killed.includes('all') || s.killed.includes('cutscene'));
    if (killed) {
      suppressed.push(ref.id);
      continue;
    }
    if (provider === null) continue;

    // inputs: style bible, stage plate (sheet crops and authored keyframes join them when those assets exist)
    const inputs: ShotPlan['inputs'] = [];
    const style = i.styles[template.front.style ?? ''];
    if (style?.sha256) inputs.push({ role: 'style', sha256: style.sha256 });
    const plate = i.plates[stageBase(ref.stage)];
    if (plate) {
      if (plate.ref?.startsWith('previs/')) fail(`input references ${plate.ref}`);
      inputs.push({ role: 'plate', sha256: plate.sha256 });
    }

    const recipe = template.front.recipe === 'R' ? 'ref2v' : 'i2v';
    const endpointId = provider.entry.endpoints[recipe] ?? provider.entry.endpoints.i2v;
    if (endpointId === undefined) {
      fail(`provider ${provider.key} has no ${recipe} endpoint`);
      continue;
    }
    const endpoint = endpointPin({ id: endpointId, pinnedUpdatedAt: i.registry.endpoints[endpointId]?.pinnedUpdatedAt ?? null });
    const seed = i.seeds[ref.id] ?? parseInt(sha256Hex(ref.id).slice(0, 8), 16);
    const characters = souls.map((s) => ({ id: s.id, soulVersion: s.soulVersion, tier: s.tier }));
    const keyInput: CutsceneKeyInput = {
      template: ref.template,
      characters: characters.map((c) => ({ id: c.id, soulVersion: c.soulVersion, likenessTier: c.tier })),
      move: ref.move,
      stage: ref.stage,
      style: (template.front.style ?? '') as CutsceneKeyInput['style'],
      endpoint: endpoint as CutsceneKeyInput['endpoint'],
      seed,
      inputHashes: inputs.map((x) => x.sha256),
    };
    let key: string;
    try {
      key = cutsceneKey(keyInput);
    } catch (e) {
      fail((e as Error).message);
      continue;
    }

    // shot plans and the prompt lint of every filled prompt
    const shotsDef = template.front.shots ?? [];
    const shots: ShotPlan[] = [];
    shotsDef.forEach((sd, n) => {
      const f = fillTemplate(template, ref, souls, i, n + 1);
      for (const p of f.problems) fail(p);
      const keyframePrompt = `Still image, the first frame of the shot. ${f.text}`;
      for (const [what, text] of [['prompt', f.text], ['keyframe prompt', keyframePrompt]] as const) {
        const r = lintPrompt(text, {
          names: i.lint.names, denylist: i.lint.denylist, banned: i.lint.banned,
          cast: souls.map((s) => ({ id: s.id, tier: s.tier })), slots: f.slots,
        });
        if (!r.ok) fail(`shot ${n + 1} ${what} fails the prompt lint (rule ${r.rules.join(', ')})`);
      }
      shots.push({ shotId: `s${n + 1}`, durationS: sd.durationS, prompt: f.text, keyframePrompt, inputs, camera: sd.camera, subjects: souls.map((s) => s.id) });
    });
    const durationS = shots.reduce((n, s) => n + s.durationS, 0);
    const usdPerSMicros = Math.round(provider.entry.price.usdPerS * 1_000_000);
    const budgetUsdMicros = Math.round(durationS * usdPerSMicros * RETAKE_FACTOR) + shots.length * KEYFRAME_MICROS;

    const desired: CutsceneIndexEntry = {
      ref: ref.id, key, keyInput, provider: provider.key, characters, durationMs: durationS * 1000,
      fallback: ref.fallback, cues: ref.cues, audio: ref.audio,
    };
    const res = await carryOver(desired, prev.get(ref.id), i.ready, { killed: false, providers: i.registry.videoProviders });
    entries.push(res.entry);
    if (res.carried) staleRefs.push(ref.id);
    catalog.add(key);
    catalog.add(res.entry.key);
    requests.push({
      schema: 'cutscene-request/1', key, keyInput, ref: ref.id, hook: ref.hook, templateSha256: sha256Hex(template.raw), shots, cues: ref.cues, audio: ref.audio,
      characters, priority: ref.priority, budgetUsdMicros,
    });
  }

  const index: CutsceneIndex = { schema: INDEX_SCHEMA, release: i.release, builtAt: i.builtAt, entries };
  return { index, requests, catalogKeys: [...catalog].sort(byStr), problems, staleRefs, suppressed };
}
