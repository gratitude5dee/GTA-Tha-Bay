import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { compileSoul } from '../../src/npc/compile.ts';
import { parseSoul } from '../../src/npc/parse.ts';
import {
  validateBarkPool, validateDialogueRequest, validateNpcIntent, validateNpcSummary, validateNpcTurn, validateRoster, validateRosterBundle,
  validateSoul, validateVoiceCatalog,
} from '../../src/npc/validate.ts';
import { SHIPPED_IDS, fixtureSoul, repoRoot, rulesBlock, shippedSoul } from './helpers/souls.ts';

const schemaDir = path.join(repoRoot, 'packages/shared/schemas/npc');
const readSchema = (name: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(schemaDir, name), 'utf8')) as Record<string, unknown>;
const SCHEMA_FILES = [
  'soul-1.0.schema.json', 'soul-1.0.llm.schema.json', 'npc-roster-1.0.schema.json', 'npc-turn-1.0.schema.json', 'npc-intent-1.0.schema.json',
  'npc-summary-1.0.schema.json', 'dialogue-request-1.0.schema.json', 'voice-catalog-1.0.schema.json', 'bark-pool-1.0.schema.json',
];

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const front = (md: string): Obj => structuredClone(parseSoul(md).front) as unknown as Obj;

describe('schema files', () => {
  it('ships the nine files of C10 and each compiles under Ajv draft 2020-12', () => {
    for (const f of SCHEMA_FILES) {
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      expect(() => ajv.compile(readSchema(f)), f).not.toThrow();
    }
  });

  it('generated validators import nothing at runtime', () => {
    const gen = readFileSync(path.join(repoRoot, 'packages/shared/src/npc/validators.gen.ts'), 'utf8');
    expect(gen).not.toMatch(/\brequire\(/);
    expect(gen).not.toMatch(/^import /m);
    expect(gen).not.toMatch(/from\s+["']ajv/);
  });
});

describe('soul-1.0 conditionals', () => {
  const goods: [string, string][] = [
    ...SHIPPED_IDS.map((id) => [id, shippedSoul(id)] as [string, string]),
    ['fixture base', fixtureSoul('good/base')],
    ['fixture consented', fixtureSoul('good/consented')],
    ['fixture parody', fixtureSoul('good/parody')],
    ['fixture fighter', fixtureSoul('good/fighter')],
  ];
  it.each(goods)('accepts %s', (_name, md) => {
    expect(validateSoul(parseSoul(md).front)).toEqual([]);
  });

  const fails = (f: Obj, token: string): void => {
    const issues = validateSoul(f);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => `${i.path} ${i.schemaPath} ${i.message}`.includes(token)), JSON.stringify(issues.map((i) => i.path + i.schemaPath))).toBe(true);
  };

  it('rejects: parody without nameDistanceOk', () => {
    const f = front(fixtureSoul('good/parody'));
    f.likeness.nameDistanceOk = false;
    fails(f, 'nameDistanceOk');
  });
  it('rejects: parody marked deceased', () => {
    const f = front(fixtureSoul('good/parody'));
    f.likeness.deceased = true;
    fails(f, 'deceased');
  });
  it('rejects: consented without a consent record', () => {
    const f = front(fixtureSoul('good/consented'));
    f.likeness.consentRecordId = null;
    fails(f, 'consentRecordId');
  });
  it('rejects: original basis with tier parody', () => {
    const f = front(fixtureSoul('good/base'));
    f.tier = 'parody';
    fails(f, 'tier');
  });
  it('rejects: Sonnet on a non-hero', () => {
    const f = front(fixtureSoul('good/base'));
    f.dialogue.modelTier = 'sonnet';
    fails(f, 'hero');
  });
  it('rejects: t3 without the voice_clone scope', () => {
    const f = front(fixtureSoul('good/consented'));
    f.voice.tier = 't3';
    fails(f, 'consentScopes');
  });
  it('rejects: minor true', () => {
    const f = front(fixtureSoul('good/base'));
    f.minor = true;
    fails(f, 'minor');
  });
  it('rejects: a real person without standIn', () => {
    const f = front(fixtureSoul('good/parody'));
    f.standIn = null;
    fails(f, 'standIn');
  });
  it('rejects: a user soul with tier parody', () => {
    const f = front(fixtureSoul('good/parody'));
    f.origin = 'user';
    f.ownerProfileId = '0190f3a2-7b1c-7d2e-9a4b-3c5d6e7f8091';
    fails(f, 'tier');
  });
  it('rejects: a fighter without stats', () => {
    const f = front(fixtureSoul('good/fighter'));
    f.stats = {};
    fails(f, 'stats');
  });
  it('rejects: a tycoon actor without a tycoon block', () => {
    const f = front(shippedSoul('standin_founder'));
    delete f.tycoon;
    fails(f, 'tycoon');
  });
  it('rejects: active without review', () => {
    const f = front(shippedSoul('ro-batista'));
    f.provenance.reviewedBy = null;
    fails(f, 'reviewedBy');
  });
  it('rejects: unknown keys and bad ids', () => {
    const f = front(shippedSoul('ro-batista'));
    f.surprise = 1;
    f.id = 'Ro';
    expect(validateSoul(f).length).toBeGreaterThanOrEqual(2);
  });
});

describe('model-facing and request schemas', () => {
  const turn = { line: 'Engine don’t lie.', emotion: 'amused', gesture: 'nod', action: 'none', action_arg: null, affinity_delta: 1, memory_writes: [], end_conversation: false };
  it('npc-turn: requires every field in order and the closed enums', () => {
    expect(validateNpcTurn(turn)).toEqual([]);
    expect(readSchema('npc-turn-1.0.schema.json').required).toEqual(['line', 'emotion', 'gesture', 'action', 'action_arg', 'affinity_delta', 'memory_writes', 'end_conversation']);
    expect(validateNpcTurn({ ...turn, emotion: 'furious' }).length).toBeGreaterThan(0);
    expect(validateNpcTurn({ ...turn, memory_writes: [{ kind: 'reflection', text: 'x', importance: 3 }] }).length).toBeGreaterThan(0);
    const { line: _l, ...noLine } = turn;
    expect(validateNpcTurn(noLine).length).toBeGreaterThan(0);
  });
  it('npc-intent and npc-summary', () => {
    expect(validateNpcIntent({ goal: 'race', target: null, urgency: 'low', bark: 'idle', until: '30s' })).toEqual([]);
    expect(validateNpcIntent({ goal: 'race', target: null, urgency: 'low', bark: 'shout', until: '30s' }).length).toBeGreaterThan(0);
    const patch = { summaryUpdate: 'met twice', memories: [{ kind: 'promise', text: 'bring the part', importance: 6, gameTime: 120, source: 'dialogue' }], affinityDelta: 2, trustDelta: 1, flagsPatch: { met: true }, reflection: false };
    expect(validateNpcSummary(patch)).toEqual([]);
    expect(validateNpcSummary({ ...patch, memories: [{ ...patch.memories[0], source: 'telepathy' }] }).length).toBeGreaterThan(0);
  });
  const ctx = {
    schema: 1, clockT: 7200, chunkKey: '9/256/256', poiId: 'poi.mission.shop-batista', mode: 'story', missionId: null, missionStep: null,
    player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 10, techClout: 0 }, relation: { trust: 5, met: true }, events: ['rain_started'],
    offers: { missionIds: [], raceIds: [], dealIds: [] }, tycoon: null, voice: 'auto', locale: 'en-US',
  };
  it('dialogue-request', () => {
    const req = { npcId: 'ro-batista', soulVersion: 1, turn: { text: 'hello', intent: 'greet' }, context: ctx, maxTokens: 512 };
    expect(validateDialogueRequest(req)).toEqual([]);
    expect(validateDialogueRequest({ ...req, turn: { intent: 'ask_about_place:poi.mission.dolores-park' } })).toEqual([]);
    expect(validateDialogueRequest({ ...req, turn: {} }).length).toBeGreaterThan(0);
    expect(validateDialogueRequest({ ...req, turn: { text: 'x'.repeat(281) } }).length).toBeGreaterThan(0);
    expect(validateDialogueRequest({ ...req, turn: { intent: 'sing' } }).length).toBeGreaterThan(0);
    expect(validateDialogueRequest({ ...req, context: { ...ctx, history: [] } }).length).toBeGreaterThan(0); // no history[] in the request
  });
  it('voice-catalog and bark-pool', () => {
    expect(validateVoiceCatalog(JSON.parse(readFileSync(path.join(repoRoot, 'config/voice-catalog.json'), 'utf8')))).toEqual([]);
    const pool = { schema: 'bark-pool/1', owner: 'archetype:vendor', voiceRef: null, lines: [{ id: 'b1', tag: 'idle', text: 'Fresh bread.', audio: null, cues: null, weight: 1 }] };
    expect(validateBarkPool(pool)).toEqual([]);
    expect(validateBarkPool({ ...pool, lines: [{ ...pool.lines[0], text: 'x'.repeat(81) }] }).length).toBeGreaterThan(0);
  });
});

describe('roster schema', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'content/npcs/roster.json'), 'utf8')) as unknown;
  it('accepts the shipped manifest and rejects unknown pipelines', () => {
    expect(validateRoster(manifest)).toEqual([]);
    const bad = structuredClone(manifest) as Obj;
    bad.entries[0].pipeline = 'ultra';
    expect(validateRoster(bad).length).toBeGreaterThan(0);
  });
  it('accepts a bundle of compiled public souls and rejects extra fields such as rails', () => {
    const rules = rulesBlock();
    const souls = SHIPPED_IDS.map((id) => compileSoul(shippedSoul(id), rules).publicSoul);
    const bundle = { schema: 'npc-roster-bundle/1', rosterVersion: 1, souls };
    expect(validateRosterBundle(bundle)).toEqual([]);
    const leaked = structuredClone(bundle) as Obj;
    leaked.souls[0].rails = { rating: 'M' };
    expect(validateRosterBundle(leaked).length).toBeGreaterThan(0);
    const leakedBrief = structuredClone(bundle) as Obj;
    leakedBrief.souls[0].visual_brief = 'x';
    expect(validateRosterBundle(leakedBrief).length).toBeGreaterThan(0);
  });
});

describe('soul-1.0.llm.schema.json (AC-3)', () => {
  const schema = readSchema('soul-1.0.llm.schema.json');
  const NUMERIC_LENGTH_FORMAT = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format'];
  const count = (): { optional: number; unions: number; forbidden: string[]; conditionals: number } => {
    let optional = 0;
    let unions = 0;
    let conditionals = 0;
    const forbidden: string[] = [];
    const walk = (n: unknown, at: string, inProperties: boolean): void => {
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${at}/${i}`, false));
      if (n === null || typeof n !== 'object') return;
      const o = n as Obj;
      if (!inProperties) {
        if (o.properties && typeof o.properties === 'object') {
          const req = new Set<string>(o.required ?? []);
          optional += Object.keys(o.properties).filter((k) => !req.has(k)).length;
        }
        if (o.anyOf || o.oneOf) unions++;
        if (Array.isArray(o.type)) unions++;
        for (const k of ['if', 'then', 'else', 'allOf']) if (k in o) conditionals++;
        for (const k of NUMERIC_LENGTH_FORMAT) if (k in o) forbidden.push(`${at}/${k}`);
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${at}/${k}`, !inProperties && k === 'properties');
    };
    walk(schema, '', false);
    return { optional, unions, forbidden, conditionals };
  };
  it('has no numeric, length or format keyword and no conditionals', () => {
    const c = count();
    expect(c.forbidden).toEqual([]);
    expect(c.conditionals).toBe(0);
  });
  it('has at most 24 optional and 16 union-typed parameters', () => {
    const c = count();
    expect(c.optional).toBeLessThanOrEqual(24);
    expect(c.unions).toBeLessThanOrEqual(16);
  });
  it('covers exactly the fields the generator writes and leaves server-owned ones out', () => {
    expect(Object.keys(schema.properties as object).sort()).toEqual(
      ['goals', 'knowledge', 'locations', 'namedPeople', 'personality', 'rails', 'realPersonSuspected', 'schedule', 'sections', 'shortBio', 'speech', 'visual_brief'].sort(),
    );
    const k = (schema.properties as Obj).knowledge.properties as Obj;
    expect(k.realWorldRefs).toBeUndefined();
    expect(Object.keys(schema.properties as object)).not.toContain('tier');
  });
});
